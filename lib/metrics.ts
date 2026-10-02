import type { TranscriptEntry } from "@/db/schema";

// Deterministic, pure analysis of a call transcript. SDR = role "user",
// prospect = role "agent". Entries are never re-sorted: the array index is the
// turnIndex used by the judge, the #turn-N anchors and the moments.

export type EndedBy = "sdr" | "prospect" | "timeout" | "unknown";
export type TranscriptSource = "elevenlabs" | "client";

/** Target band on the talk-ratio bar: the SDR should talk ≤ this share. */
export const SDR_TALK_TARGET = 0.45;
/** Calls shown in the trend sparklines. */
export const TREND_N = 20;

export type CallMetrics = {
  turns: { sdr: number; prospect: number };
  sdrWords: number;
  prospectWords: number;
  /** sdrWords / all words; null iff no words at all. */
  sdrWordShare: number | null;
  /** Estimated; null for client-source rows (their SDR stamps are turn ends). */
  sdrTalkSecs: number | null;
  prospectTalkSecs: number | null;
  sdrTalkShare: number | null;
  /** Longest run of consecutive SDR turns; null iff no SDR turn. */
  longestMonologue: { turnIndex: number; words: number; secs: number | null } | null;
  questions: { total: number; open: number; closed: number };
  firstQuestionAtSecs: number | null;
  firstOpenQuestionAtSecs: number | null;
  /** Prospect turns the SDR talked over; null iff no prospect turn carries a flag. */
  interruptions: number | null;
  /** Estimated; null when talk time is unknown. */
  sdrWpm: number | null;
  endedBy: EndedBy;
};

export function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Sentences incl. a final unterminated fragment. No lookbehind (ES2017 target). */
export function splitSentences(message: string): string[] {
  return (
    message
      .match(/[^.!?]+(?:[.!?]+|$)/g)
      ?.map((s) => s.trim())
      .filter(Boolean) ?? []
  );
}

const FILLERS = new Set([
  "so", "and", "but", "well", "okay", "ok", "um", "uh", "yeah", "just", "like",
  "also", "now", "then", "actually", "honestly", "hey", "right",
]);
const OPENERS = new Set([
  "what", "what's", "how", "how's", "why", "tell", "walk", "describe", "explain", "help",
]);
// Fallback for ASR-dropped punctuation on the trailing fragment.
const INTERROGATIVE = new Set([
  ...OPENERS,
  "who", "when", "where", "which", "do", "does", "did", "is", "are", "can",
  "could", "would", "will", "should", "have", "has", "any",
]);

function firstToken(sentence: string): string {
  let s = sentence.toLowerCase().trim();
  for (;;) {
    const m = s.match(/^([a-z']+)[,\s]*/);
    if (m && FILLERS.has(m[1])) {
      s = s.slice(m[0].length);
      continue;
    }
    break;
  }
  return s.match(/^[a-z']+/)?.[0] ?? "";
}

/**
 * "open" iff the sentence is a question that starts (after fillers) with
 * what/how/why/tell/walk/describe/explain/help; other questions are "closed".
 * Known limits: "what time works?" counts as open; an unpunctuated question
 * buried mid-message is missed (only the trailing fragment gets the fallback);
 * a trailing statement starting with "what" is over-counted.
 */
export function classifyQuestion(
  sentence: string,
  isFinalUnterminated: boolean,
): "open" | "closed" | null {
  const t = sentence.trim();
  const tok = firstToken(t);
  if (!t.endsWith("?")) {
    if (!isFinalUnterminated || !INTERROGATIVE.has(tok)) return null;
  }
  return OPENERS.has(tok) ? "open" : "closed";
}

function questionsIn(message: string): { open: number; closed: number } {
  const sentences = splitSentences(message);
  let open = 0;
  let closed = 0;
  sentences.forEach((s, i) => {
    const isFinalUnterminated = i === sentences.length - 1 && !/[.!?]$/.test(s);
    const kind = classifyQuestion(s, isFinalUnterminated);
    if (kind === "open") open++;
    else if (kind === "closed") closed++;
  });
  return { open, closed };
}

/**
 * Estimated turn durations (ElevenLabs transcripts only).
 * gap_i = start_{i+1} − start_i; last turn: max(durationSecs, start_last) − start_last.
 * secs_i = clamp(gap_i, words_i / 4, words_i / 1.5 + 3): at least the words at
 * 240 wpm, at most the words at 90 wpm plus 3 s of pause. The upper bound keeps
 * the prospect's LLM+TTS latency from being credited to whoever spoke last; the
 * lower bound keeps same-second or backwards stamps from yielding 0-second turns.
 */
function estimateSecs(entries: TranscriptEntry[], durationSecs: number | null): number[] {
  const n = entries.length;
  return entries.map((e, i) => {
    const words = countWords(e.message);
    if (words === 0) return 0;
    const start = e.timeInCallSecs;
    const gap =
      i < n - 1
        ? entries[i + 1].timeInCallSecs - start
        : Math.max(durationSecs ?? 0, start) - start;
    const lo = words / 4;
    const hi = words / 1.5 + 3;
    return Math.min(hi, Math.max(lo, gap));
  });
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const EXACT: Record<string, EndedBy> = {
  // hints written by the end route from the browser's disconnect reason
  "client:user": "sdr",
  "client:agent": "prospect",
  "client:error": "unknown",
  // Real ElevenLabs strings (lowercased), pinned from `pnpm rescore --reasons`.
  // The SDR pressing End closes the WebRTC session with a normal close code.
  "client disconnected: 1000": "sdr",
};
const PATTERNS: [RegExp, EndedBy][] = [
  [/timeout|time.?limit|max.?duration|inactiv|silence/i, "timeout"],
  [/end_call|agent|tool/i, "prospect"],
  [/client|user|hang|disconnect|remote/i, "sdr"],
];

export function mapTerminationReason(raw: string | null | undefined): EndedBy {
  if (!raw) return "unknown";
  const exact = EXACT[raw.toLowerCase()];
  if (exact) return exact;
  return PATTERNS.find(([re]) => re.test(raw))?.[1] ?? "unknown";
}

export function computeMetrics(input: {
  transcript: TranscriptEntry[];
  durationSecs: number | null;
  terminationReason: string | null;
  source: TranscriptSource;
}): CallMetrics {
  const { transcript, durationSecs, terminationReason, source } = input;
  const timed = source === "elevenlabs";
  const words = transcript.map((e) => countWords(e.message));
  const secs = timed ? estimateSecs(transcript, durationSecs) : null;

  let sdrTurns = 0;
  let prospectTurns = 0;
  let sdrWords = 0;
  let prospectWords = 0;
  let sdrSecs = 0;
  let prospectSecs = 0;
  transcript.forEach((e, i) => {
    if (e.role === "user") {
      sdrTurns++;
      sdrWords += words[i];
      if (secs) sdrSecs += secs[i];
    } else {
      prospectTurns++;
      prospectWords += words[i];
      if (secs) prospectSecs += secs[i];
    }
  });

  // Longest SDR monologue: a run of consecutive SDR entries (ElevenLabs sometimes
  // splits one breath into two user turns); most words wins, earliest on ties.
  let best: CallMetrics["longestMonologue"] = null;
  for (let i = 0; i < transcript.length; ) {
    if (transcript[i].role !== "user") {
      i++;
      continue;
    }
    let j = i;
    let runWords = 0;
    let runSecs = 0;
    while (j < transcript.length && transcript[j].role === "user") {
      runWords += words[j];
      if (secs) runSecs += secs[j];
      j++;
    }
    if (!best || runWords > best.words) {
      best = { turnIndex: i, words: runWords, secs: secs ? round1(runSecs) : null };
    }
    i = j;
  }

  let open = 0;
  let closed = 0;
  let firstQuestionAtSecs: number | null = null;
  let firstOpenQuestionAtSecs: number | null = null;
  for (const e of transcript) {
    if (e.role !== "user") continue;
    const q = questionsIn(e.message);
    open += q.open;
    closed += q.closed;
    if (q.open + q.closed > 0 && firstQuestionAtSecs === null) {
      firstQuestionAtSecs = e.timeInCallSecs;
    }
    if (q.open > 0 && firstOpenQuestionAtSecs === null) {
      firstOpenQuestionAtSecs = e.timeInCallSecs;
    }
  }

  // Defined on real booleans so in-memory and jsonb-round-tripped entries agree
  // (JSON drops undefined-valued keys).
  const hasFlags = transcript.some(
    (e) => e.role === "agent" && typeof e.interrupted === "boolean",
  );
  const interruptions = hasFlags
    ? transcript.filter((e) => e.role === "agent" && e.interrupted === true).length
    : null;

  const totalWords = sdrWords + prospectWords;
  const sdrTalkSecs = secs ? round1(sdrSecs) : null;
  const prospectTalkSecs = secs ? round1(prospectSecs) : null;
  const talkTotal = (sdrTalkSecs ?? 0) + (prospectTalkSecs ?? 0);

  return {
    turns: { sdr: sdrTurns, prospect: prospectTurns },
    sdrWords,
    prospectWords,
    sdrWordShare: totalWords > 0 ? sdrWords / totalWords : null,
    sdrTalkSecs,
    prospectTalkSecs,
    sdrTalkShare: secs && talkTotal > 0 ? (sdrTalkSecs ?? 0) / talkTotal : null,
    longestMonologue: best,
    questions: { total: open + closed, open, closed },
    firstQuestionAtSecs,
    firstOpenQuestionAtSecs,
    interruptions,
    sdrWpm:
      sdrTalkSecs && sdrTalkSecs > 0 ? Math.round(sdrWords / (sdrTalkSecs / 60)) : null,
    endedBy: mapTerminationReason(terminationReason),
  };
}
