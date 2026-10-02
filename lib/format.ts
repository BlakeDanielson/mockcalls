/** One app-wide zone for displayed dates and the "this week" rule. */
export const APP_TIMEZONE = process.env.APP_TIMEZONE ?? "America/New_York";

/**
 * Remove expressive-TTS delivery tags such as "[sighs]" or "[slow]" that the
 * prospect model may put in its text. They shape the audio, not the words,
 * so transcripts, metrics and the judge should never see them.
 */
export function stripDeliveryTags(text: string): string {
  return text.replace(/\[[a-z][a-z ,'-]{0,30}\]/gi, " ").replace(/\s+/g, " ").trim();
}

export function formatClock(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatDate(d: Date): string {
  return d.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: APP_TIMEZONE,
  });
}
