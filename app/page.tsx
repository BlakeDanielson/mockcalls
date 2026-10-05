import { DifficultyBadge } from "@/components/DifficultyBadge";
import { SubmitButton } from "@/components/SubmitButton";
import { displayName, requireUser } from "@/lib/auth";
import { PERSONAS } from "@/lib/personas";
import { createCall } from "./actions";

export default async function HomePage(props: PageProps<"/">) {
  await requireUser();
  const [sp, name] = await Promise.all([props.searchParams, displayName()]);
  const showError = sp.error === "missing";

  return (
    <form action={createCall} className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Practice a cold call
        </h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Pick a prospect, put your headset on, and hit Call. You&apos;ll get a
          scorecard when you hang up. Calling as{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {name}
          </span>
          .
        </p>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Who are you calling?</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {PERSONAS.map((p, i) => (
            <label key={p.id} className="cursor-pointer">
              <input
                type="radio"
                name="personaId"
                value={p.id}
                defaultChecked={i === 0}
                className="peer sr-only"
              />
              <div className="h-full rounded-xl border border-zinc-200 p-4 transition peer-checked:border-zinc-900 peer-checked:ring-2 peer-checked:ring-zinc-900 dark:border-zinc-800 dark:peer-checked:border-zinc-100 dark:peer-checked:ring-zinc-100">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">
                      {p.title}, {p.company}
                    </div>
                  </div>
                  <DifficultyBadge level={p.difficulty} />
                </div>
                <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                  {p.tagline}
                </p>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      {showError && (
        <p className="text-sm text-red-600">Pick a prospect to call.</p>
      )}

      <SubmitButton
        pendingLabel="Starting…"
        className="rounded-lg bg-zinc-900 px-5 py-2.5 font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Start the call →
      </SubmitButton>
    </form>
  );
}
