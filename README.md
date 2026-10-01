# mockcalls

Cold-call practice for SDRs. Sign in, pick a prospect persona, talk to it over your headset, hang up, get a coaching scorecard. Reps see their own calls; managers see the whole team's.

- **Voice:** one ElevenLabs agent; each persona overrides its prompt, opening line, and voice per call (`lib/personas.ts`).
- **Scoring:** Claude reads the transcript and returns a structured scorecard (`lib/scoring.ts`).
- **Auth:** Clerk. Sign-ups are allow-listed to `@outsorcy.com`. A user whose Clerk `publicMetadata.role` is `"manager"` sees everyone's calls; everyone else is a rep.
- **Storage:** Neon Postgres, one `calls` table (`db/schema.ts`).
- **Stack:** Next.js App Router, TypeScript, Tailwind, Drizzle. Deploys to Render (`render.yaml`).

## Setup

Everything below is already provisioned for the Outsorcy workspace; the commands are here so it can be recreated.

### 1. ElevenLabs agent

Agent **mockcalls prospect** exists with: LLM `claude-haiku-4-5`, TTS `eleven_flash_v2` (English agents require v2), temperature 0.7, authentication on, overrides enabled for system prompt / first message / voice id, client events `audio`, `interruption`, `user_transcript`, `agent_response`, `agent_response_correction`, and the `end_call` system tool. Its id goes in `ELEVENLABS_AGENT_ID`. ElevenLabs rejects a call that sends an override the agent hasn't enabled.

Persona voices are premade voice ids; swap any of them in `lib/personas.ts`.

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

Make someone a manager (after they've signed up):

```bash
clerk users list
clerk api -X PATCH /users/<user_id>/metadata -d '{"public_metadata":{"role":"manager"}}' --yes
```

They'll see the **Team** link and everyone's history on their next sign-in. The role travels in the session token (`sessionClaims.metadata.role`), so there's no per-request lookup.

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
```

Run `pnpm drizzle-kit push` against production before deploying schema changes — the Render build never runs it.

## Authorization model

`lib/auth.ts` is the only place identity is read. Pages and server actions call `requireUser()` (redirects to `/sign-in`); route handlers call `apiUser()` (401). A rep can only open, start, or end their own call; a manager can open any call's results and the team history but never drives another rep's call. `proxy.ts` only establishes the session — every check happens at the resource.

## Deploy

Push to a repo, create a Render Blueprint from `render.yaml`, and set the env vars from `.env.example` (use `clerk env pull --instance prod` for production Clerk keys).

The Clerk instance config is per instance, so repeat the three `clerk config patch` / allowlist commands from step 3 with `--instance prod` before going live — without them production sign-up is open to anyone and the manager role claim is missing from tokens.

## Editing personas

Everything about a prospect — who they are, how they talk, their objections, what a win looks like, their voice — is one object in `lib/personas.ts`.
