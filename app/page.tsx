import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { DifficultyBadge } from "@/components/DifficultyBadge";
import { SubmitButton } from "@/components/SubmitButton";
import { getDb } from "@/db";
import { customPersonas } from "@/db/schema";
import { displayName, requireUser } from "@/lib/auth";
import { PERSONAS, type Persona } from "@/lib/personas";
import { createCall } from "./actions";

export const dynamic = "force-dynamic";

const card =
  "h-full rounded-xl border border-zinc-200 p-4 transition peer-checked:border-zinc-900 peer-checked:ring-2 peer-checked:ring-zinc-900 dark:border-zinc-800 dark:peer-checked:border-zinc-100 dark:peer-checked:ring-zinc-100";

function PersonaCard({ p, checked }: { p: Persona; checked: boolean }) {
  return (
    <label className="cursor-pointer">
      <input
        type="radio"
        name="personaId"
        value={p.id}
        defaultChecked={checked}
        className="peer sr-only"
      />
      <div className={card}>
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
        {p.custom && (
          <Link
            href={`/custom/${p.id.slice("custom:".length)}`}
            className="mt-2 inline-block text-sm font-medium underline-offset-2 hover:underline"
          >
            Review the research →
          </Link>
        )}
      </div>
    </label>
  );
}

export default async function HomePage(props: PageProps<"/">) {
  const viewer = await requireUser();
  const [sp, name, custom] = await Promise.all([
    props.searchParams,
    displayName(),
    getDb()
      .select({
        id: customPersonas.id,
        status: customPersonas.status,
        input: customPersonas.input,
        persona: customPersonas.persona,
      })
      .from(customPersonas)
      .where(eq(customPersonas.userId, viewer.userId))
      .orderBy(desc(customPersonas.createdAt))
      .limit(8),
  ]);
  const showError = sp.error === "missing";
  const ready = custom.flatMap((c) => (c.status === "ready" && c.persona ? [c.persona] : []));
  const pending = custom.filter((c) => c.status !== "ready");

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
            <PersonaCard key={p.id} p={p} checked={i === 0} />
          ))}
        </div>
      </fieldset>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium">Your real prospects</h2>
          <Link
            href="/custom/new"
            className="text-sm font-medium underline-offset-2 hover:underline"
          >
            + Build one from a real prospect
          </Link>
        </div>
        {ready.length === 0 && pending.length === 0 ? (
          <Link
            href="/custom/new"
            className="block rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-600 hover:border-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
          >
            About to call someone real? Enter the person and company, add any signals
            (job postings, leadership changes, funding), and we&apos;ll research them and
            build a prospect you can rehearse against first.
          </Link>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {ready.map((p) => (
              <PersonaCard key={p.id} p={p} checked={false} />
            ))}
            {pending.map((c) => (
              <Link
                key={c.id}
                href={`/custom/${c.id}`}
                className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm dark:border-zinc-700"
              >
                <div className="font-medium">{c.input.prospectName}</div>
                <div className="text-zinc-600 dark:text-zinc-400">
                  {c.input.prospectTitle}, {c.input.company}
                </div>
                <p className="mt-2 text-zinc-500">
                  {c.status === "researching" ? "Researching…" : "Research failed. Open to retry."}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

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
