import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { requireUser } from "@/lib/auth";
import { SIGNAL_KINDS } from "@/lib/custom-persona";
import { createCustomPersona } from "../actions";

const ERRORS: Record<string, string> = {
  prospectName: "Enter the prospect's full name.",
  prospectTitle: "Enter the prospect's job title.",
  company: "Enter the company name.",
  website: "That website doesn't look like a URL.",
  linkedin: "That LinkedIn link doesn't look like a URL.",
  voice: "Pick a voice.",
  difficulty: "Pick a difficulty.",
};

const input =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const label = "block text-sm font-medium";
const hint = "text-xs text-zinc-500 dark:text-zinc-400";
const pill =
  "cursor-pointer rounded-lg border border-zinc-200 px-3 py-2 text-sm transition peer-checked:border-zinc-900 peer-checked:ring-2 peer-checked:ring-zinc-900 dark:border-zinc-800 dark:peer-checked:border-zinc-100 dark:peer-checked:ring-zinc-100";

export default async function NewCustomPersonaPage(props: PageProps<"/custom/new">) {
  await requireUser();
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? (ERRORS[sp.error] ?? "Check the form and try again.") : null;

  return (
    <form action={createCustomPersona} className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← Back to prospects
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Practice on a real prospect</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Tell us who you&apos;re about to call. We research the person and the company, fold in
          what you already know, and build a prospect you can rehearse against before you dial
          for real. Research takes a minute or two.
        </p>
      </div>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Who are you calling?
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>
            Prospect name
            <input name="prospectName" required minLength={2} maxLength={120} className={input} placeholder="Jordan Lee" />
          </label>
          <label className={label}>
            Job title
            <input name="prospectTitle" required minLength={2} maxLength={120} className={input} placeholder="VP of Sales" />
          </label>
          <label className={label}>
            Company
            <input name="company" required minLength={2} maxLength={120} className={input} placeholder="Acme Robotics" />
          </label>
          <label className={label}>
            Company website <span className={hint}>(optional)</span>
            <input name="website" maxLength={300} className={input} placeholder="acmerobotics.com" />
          </label>
          <label className={`${label} sm:col-span-2`}>
            LinkedIn profile <span className={hint}>(optional, helps us find the right person)</span>
            <input name="linkedin" maxLength={300} className={input} placeholder="linkedin.com/in/jordanlee" />
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Any signals?
        </legend>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          What made you pick this account? Anything you put here is treated as true, and the
          prospect will confirm it if you bring it up on the call. Leave blank what you don&apos;t
          know; the research will look for it.
        </p>
        {SIGNAL_KINDS.map((k) => (
          <label key={k.id} className={label}>
            {k.label}
            <span className={`ml-2 font-normal ${hint}`}>{k.hint}</span>
            <textarea name={`signal_${k.id}`} rows={2} maxLength={1000} className={input} />
          </label>
        ))}
        <label className={label}>
          Other notes for the role-play <span className={hint}>(optional)</span>
          <textarea
            name="notes"
            rows={2}
            maxLength={2000}
            className={input}
            placeholder="e.g. I emailed her last week and got no reply; she's known for being blunt"
          />
        </label>
      </fieldset>

      <div className="grid gap-6 sm:grid-cols-2">
        <fieldset>
          <legend className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Voice</legend>
          <div className="mt-2 flex gap-2">
            {(["female", "male"] as const).map((v, i) => (
              <label key={v}>
                <input type="radio" name="voice" value={v} defaultChecked={i === 0} className="peer sr-only" />
                <div className={`${pill} capitalize`}>{v}</div>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Difficulty</legend>
          <div className="mt-2 flex gap-2">
            {(["easy", "medium", "hard"] as const).map((d) => (
              <label key={d}>
                <input type="radio" name="difficulty" value={d} defaultChecked={d === "medium"} className="peer sr-only" />
                <div className={`${pill} capitalize`}>{d}</div>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <SubmitButton
        pendingLabel="Starting research…"
        className="rounded-lg bg-zinc-900 px-5 py-2.5 font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Research and build the prospect →
      </SubmitButton>
    </form>
  );
}
