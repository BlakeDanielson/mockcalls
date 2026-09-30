const STYLES = {
  easy: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
  hard: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
} as const;

export function DifficultyBadge({ level }: { level: keyof typeof STYLES }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STYLES[level]}`}
    >
      {level}
    </span>
  );
}
