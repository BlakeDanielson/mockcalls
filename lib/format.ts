export function formatClock(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatDate(d: Date): string {
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
