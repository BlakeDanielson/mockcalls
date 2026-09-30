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
    time_in_call_secs: number;
  }[];
  metadata?: { call_duration_secs?: number };
};

export function getConversation(conversationId: string) {
  return get<ElevenLabsConversation>(
    `/conversations/${encodeURIComponent(conversationId)}`,
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
    const convo = await getConversation(conversationId);
    if (convo.status === "done") return convo;
    if (convo.status === "failed") return null;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}
