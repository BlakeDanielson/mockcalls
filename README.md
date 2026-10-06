# mockcalls

Cold-call practice for SDRs. Sign in, pick a prospect persona, talk to it over your headset, hang up, get a coaching scorecard. Reps see their own calls; managers see the whole team's.

- **Voice:** one ElevenLabs agent; each persona overrides its prompt, opening line, voice, stability and speed per call (`lib/personas.ts`). The six active personas are Outsorcy's real buyers (a Head of Marketing, an EA gatekeeper, a Head of People, a founder on a freelancer budget, a CFO in a hiring freeze, a VP Sales burned by an SDR agency); the four original generic personas are retired but still resolve for old calls.
- **Phone sound:** the prospect's voice plays through a landline filter in the rep's browser (8 kHz, the 300 to 3,300 Hz phone band, mu-law codec grit, faint line hiss; `lib/phone-line.ts`). A "Phone sound" switch on the call screen turns it off, on by default and remembered per browser. It touches only what the rep hears: the recording, transcript and scoring are unchanged. If the filter hears nothing once the prospect starts talking, that call falls back to normal audio.
- **Scoring:** Claude reads the transcript against an Outsorcy offering brief and returns a structured scorecard (`lib/scoring.ts`). Scoring runs in the background after the call ends (`lib/run-scoring.ts` `finalizeCall`): the ElevenLabs transcript is swapped in once processed (up to about 150 s), then the judge runs once; the results page polls until it lands.
- **Auth:** Clerk. Sign-ups are allow-listed to `@outsorcy.com`. Roles live in Clerk `publicMetadata.role`: rep (default), manager (sees everyone's calls), admin (also assigns roles at `/admin`).
- **Storage:** Neon Postgres, one `calls` table (`db/schema.ts`).
- **Stack:** Next.js App Router, TypeScript, Tailwind, Drizzle. Deploys to Render (`render.yaml`).

## Setup

Everything below is already provisioned for the Outsorcy workspace; the commands are here so it can be recreated.

### 1. ElevenLabs agent

Agent **mockcalls prospect** exists with: LLM `claude-sonnet-5-5`, TTS `eleven_v4_turbo`, temperature 0.6, max call duration 480 s, ASR keyword boosting for Outsorcy vocabulary (company, Kosovo, Pristina, SDR, BDR, the persona company names), authentication on, overrides enabled for system prompt / first message / voice id / stability / speed, client events `audio`, `interruption`, `user_transcript`, `agent_response`, `agent_response_correction`, the `end_call` system tool, and Privacy → store call audio on. Its id goes in `ELEVENLABS_AGENT_ID`. ElevenLabs rejects a call that sends an override the agent hasn't enabled.

Persona voices are premade voice ids or designed voices saved in the workspace library (the plan's three custom-voice slots hold Priya, Tom and Marcus); swap any of them in `lib/personas.ts`.

### 2. Database

```bash
cp .env.example .env.local        # then fill in the values
pnpm drizzle-kit push             # creates/updates the calls table
```

### 3. Clerk

```bash
clerk apps create "mockcalls" --json && clerk link --app <app_id>
clerk env pull                                      # writes the publishable + secret keys
clerk config patch --json '{"session":{"claims":{"metadata":"{{user.public_metadata}}"}}}'
clerk config patch --json '{"auth_access_control":{"allowlist_enabled":true}}'
clerk api /allowlist_identifiers -d '{"identifier":"*@outsorcy.com","notify":false}' --yes
```

Roles. Everyone starts as a **rep** (own calls only). A **manager** sees every rep's calls, the team history and team analytics. An **admin** has manager access plus the **People** page (`/admin`), where they assign roles to anyone who has signed in. The role is stored in the Clerk user's `publicMetadata.role`.

Bootstrap the first admin once, after they have signed in:

```bash
clerk users list
clerk api -X PATCH /users/<user_id>/metadata -d '{"public_metadata":{"role":"admin"}}' --yes
```

After that, roles are managed in the app. Nobody can change their own role, so there is always at least one admin.

How the role reaches the app: with the session-claims patch above, `metadata.role` rides in the session token and costs nothing. Without it, `lib/auth.ts` falls back to one Clerk user lookup per request, so the app works either way; the claim is an optimisation. The patch needs a logged-in CLI (`clerk auth login`), or set it in the Clerk Dashboard under **Configure → Sessions → Customize session token** with `{"metadata": "{{user.public_metadata}}"}`. Role changes take effect on the user's next page load (next token refresh when the claim is on, about a minute).

### 4. Run

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. The mic needs `localhost` or HTTPS.

## Analytics

Every finished call gets two layers of analysis:

- **By the numbers** (`lib/metrics.ts`, deterministic, recomputable): talk ratio against a ≤45% SDR target, questions asked (open vs closed), interruptions, longest monologue, pace, who hung up. Talk time is *estimated* from turn start times (ElevenLabs gives no end times) with a two-sided clamp, and is only available for ElevenLabs-transcribed calls — browser-fallback transcripts show word share instead. Question detection relies on the ASR's punctuation; "open questions start with what, how, why or tell me".
- **The judge** (`lib/scoring.ts`): the scorecard plus **key moments** pinned to transcript turns (`#turn-N` links) and **skill tags** from the fixed taxonomy in `lib/taxonomy.ts`. Rubric band anchors and server-side normalization keep scores comparable across calls; dimensions that never had a chance to occur (prospect hung up before a close) are marked n/a rather than scored.
- **Recording** playback on the results page, proxied from ElevenLabs. Requires the agent's Privacy → *store call audio* setting to be on.

**Trends** (`/analytics`, reps) show the last 20 scored calls per dimension; **Team** (same page, managers) adds calls this week, averages, booked rate, hardest persona, the most common miss, and a per-rep table that doubles as the rep switcher. "This week" starts Monday in `APP_TIMEZONE` (default `America/New_York`).

Maintenance:

```bash
pnpm test                          # metrics, analytics and normalization unit tests
pnpm rescore                       # recompute metrics for recent calls (after a heuristic change)
pnpm rescore --refetch --missing   # upgrade browser-transcript rows once ElevenLabs has processed them
pnpm rescore --claude --id <uuid>  # re-run the judge for one call; add --dry-run to preview
pnpm rescore --reasons             # see raw termination_reason strings; pin them in lib/metrics.ts EXACT
pnpm judge fixtures/judge/*.json   # score the transcript fixtures and check expectations (needs ANTHROPIC_API_KEY)
pnpm judge --runs 3 fixtures/judge/cfo-overpromise.json   # repeat to gauge judge variance
```

Run the judge fixtures after any change to the coach prompt, the taxonomy or a persona: each fixture pins the expected outcome, tags, score floors or caps, and text the coaching must or must not contain.

Run `pnpm drizzle-kit push` against production before deploying schema changes — the Render build never runs it.

## Authorization model

`lib/auth.ts` is the only place identity is read. Pages and server actions call `requireUser()` (redirects to `/sign-in`); route handlers call `apiUser()` (401). A rep can only open, start, or end their own call; a manager can open any call's results and the team history but never drives another rep's call; an admin can additionally change roles (`requireAdmin()`), never their own. `proxy.ts` only establishes the session — every check happens at the resource.

## Deploy

Push to a repo, create a Render Blueprint from `render.yaml`, and set the env vars from `.env.example` (use `clerk env pull --instance prod` for production Clerk keys).

The Clerk instance config is per instance, so repeat the three `clerk config patch` / allowlist commands from step 3 with `--instance prod` before going live — without them production sign-up is open to anyone and the manager role claim is missing from tokens.

## Editing personas

Everything about a prospect (who they are, how they talk, the research facts they confirm, their objections, how they react to Outsorcy's moves, what a win looks like, their voice) is one object in `lib/personas.ts`. `facts` are what a rep could have found before calling and are confirmed only when the rep states or asks about them; `reactions` say how the persona answers the burdened-cost reframe, the profiles offer, pause-the-clock, the Kosovo question and a crossed hard limit; `drill` tells the judge what the persona is for. `PERSONAS` is the picker in order (the first is pre-selected); `RETIRED_PERSONAS` keeps old ids resolvable for history and rescoring. `pnpm test` runs an integrity check (unique ids, facts and reactions present, no em dashes, voice ranges) and `pnpm judge` scores the fixtures in `fixtures/judge/`. The judge's offering brief lives in `lib/scoring.ts` (`OFFERING_BRIEF`); update it when pricing, proof points or hard limits change.
