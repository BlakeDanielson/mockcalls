# mockcalls

Cold-call practice for SDRs. Pick a prospect persona, talk to it over your headset, hang up, get a coaching scorecard. Calls are saved to a history page. No login.

- **Voice:** one ElevenLabs agent; each persona overrides its prompt, opening line, and voice per call (`lib/personas.ts`).
- **Scoring:** Claude reads the transcript and returns a structured scorecard (`lib/scoring.ts`).
- **Storage:** Neon Postgres, one `calls` table (`db/schema.ts`).
- **Stack:** Next.js App Router, TypeScript, Tailwind, Drizzle. Deploys to Render (`render.yaml`).

## One-time setup

### 1. ElevenLabs agent (~15 min in the dashboard)

An agent named **mockcalls prospect** already exists in the Outsorcy workspace with everything below configured; its id is in `.env.local`. If you ever need to recreate it:

| Tab | Setting |
|---|---|
| Agent | LLM `claude-haiku-4-5` (fast turn-taking; try `claude-sonnet-5` if the prospect feels shallow). System prompt: anything — it is overridden per call. First message: `Hello?` |
| Voice | TTS model `eleven_flash_v2` |
| Security | **Enable authentication.** Under overrides, enable **System prompt**, **First message**, and **Voice ID**. ElevenLabs rejects a call that sends an override you haven't enabled. |
| Advanced | Client events `user_transcript`, `agent_response`, `interruption`, `audio` on. Enable the **End call** system tool so the prospect can hang up on you. |

Persona voices use ids from ElevenLabs' default voice library. If one errors, pick any voice under *Voices* and paste its id into `lib/personas.ts`.

### 2. Database

Create a Neon project, copy the pooled connection string, then:

```bash
cp .env.example .env.local   # fill in the four values
pnpm drizzle-kit push
```

### 3. Run

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. The mic needs `localhost` or HTTPS.

## Deploy

Push to a repo, create a Render Blueprint from `render.yaml`, and set the four env vars. HTTPS is automatic.

## Editing personas

Everything about a prospect — who they are, how they talk, their objections, what a win looks like, their voice — is one object in `lib/personas.ts`. Add or edit entries there; nothing else changes.
