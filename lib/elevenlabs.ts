import type { TranscriptEntry } from "@/db/schema";
import { stripDeliveryTags } from "./format";

const BASE = "https://api.elevenlabs.io/v1/convai";

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  return key;
}

function agentId(): string {
  const id = process.env.ELEVENLABS_AGENT_ID;
  if (!id) throw new Error("ELEVENLABS_AGENT_ID is not set");
  return id;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "xi-api-key": apiKey() },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs ${path} → ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

/** Short-lived WebRTC token for a private agent. Also returns the conversation id up front. */
export async function getWebrtcToken(): Promise<{
  token: string;
  conversationId: string;
}> {
  const data = await get<{ token: string; conversation_id: string }>(
    `/conversation/token?agent_id=${encodeURIComponent(agentId())}`,
  );
  return { token: data.token, conversationId: data.conversation_id };
}

export type ElevenLabsConversation = {
  status: "initiated" | "in-progress" | "processing" | "done" | "failed";
  transcript: {
    role: "user" | "agent";
    message?: string | null;
    /** Start of the turn in seconds; there is no end time. */
    time_in_call_secs: number;
    /** Agent turn was cut off by the user. */
    interrupted?: boolean;
  }[];
  metadata?: {
    call_duration_secs?: number;
    termination_reason?: string;
  };
};

export function getConversation(conversationId: string) {
  return get<ElevenLabsConversation>(
    `/conversations/${encodeURIComponent(conversationId)}`,
  );
}

/**
 * ElevenLabs transcript → stored shape. Empty turns (tool calls, cut off before
 * the first word) are dropped. `interrupted` is an explicit boolean on every
 * prospect turn and absent on SDR turns, so the in-memory object and the jsonb
 * round-trip are structurally identical.
 */
export function toTranscript(convo: ElevenLabsConversation): TranscriptEntry[] {
  return convo.transcript
    .map((t) => ({ ...t, message: stripDeliveryTags(t.message ?? "") }))
    .filter((t) => t.message)
    .map((t) =>
      t.role === "agent"
        ? {
            role: t.role,
            message: t.message,
            timeInCallSecs: t.time_in_call_secs,
            interrupted: t.interrupted === true,
          }
        : {
            role: t.role,
            message: t.message,
            timeInCallSecs: t.time_in_call_secs,
          },
    );
}

/**
 * The call recording as a raw fetch Response so a route handler can stream it
 * through. 404 while ElevenLabs is still processing the call.
 */
export function fetchConversationAudio(conversationId: string) {
  return fetch(
    `${BASE}/conversations/${encodeURIComponent(conversationId)}/audio`,
    { headers: { "xi-api-key": apiKey() }, cache: "no-store" },
  );
}

/**
 * Right after hang-up the conversation sits in `processing` with an empty
 * transcript. Poll briefly; return null if it doesn't finish in time so the
 * caller can fall back to the client-side transcript.
 */
export async function waitForDone(
  conversationId: string,
  { attempts = 6, delayMs = 2500 } = {},
): Promise<ElevenLabsConversation | null> {
  for (let i = 0; i < attempts; i++) {
    // One transient 5xx or a 404 while the record is being written must not
    // abandon the remaining attempts.
    const convo = await getConversation(conversationId).catch((err) => {
      console.warn(`[elevenlabs] attempt ${i + 1}/${attempts} for ${conversationId}:`, err);
      return null;
    });
    if (convo?.status === "done") return convo;
    if (convo?.status === "failed") return null;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}
