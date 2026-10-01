import { tagMeta, type SkillTag } from "@/lib/taxonomy";

const PILL: Record<"positive" | "negative", string> = {
  positive: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  negative: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100",
};

/** Skill tags as pills; positives first (taxonomy order), hover shows the criterion. */
export function TagChips({ tags }: { tags: SkillTag[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((id) => {
        const t = tagMeta(id);
        return (
          <li
            key={id}
            title={t.criterion}
            className={`cursor-help rounded-full px-2.5 py-0.5 text-xs font-medium ${PILL[t.polarity]}`}
          >
            {t.label}
          </li>
        );
      })}
    </ul>
  );
}
