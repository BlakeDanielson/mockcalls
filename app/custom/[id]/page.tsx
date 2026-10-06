import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createCall } from "@/app/actions";
import { DifficultyBadge } from "@/components/DifficultyBadge";
import { ResearchPoller } from "@/components/ResearchPoller";
import { SubmitButton } from "@/components/SubmitButton";
import { getDb } from "@/db";
import { customPersonas } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { CUSTOM_VOICES, formatSignals } from "@/lib/custom-persona";
import { isStuck } from "@/lib/run-custom-persona";
import { isUuid } from "@/lib/uuid";
import { retryCustomPersona } from "../actions";

export const dynamic = "force-dynamic";

const primary =
  "rounded-lg bg-zinc-900 px-5 py-2.5 font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
const section = "text-sm font-semibold uppercase tracking-wide text-zinc-500";

export default async function CustomPersonaPage(props: PageProps<"/custom/[id]">) {
  const viewer = await requireUser();
  const { id } = await props.params;
  if (!isUuid(id)) notFound();

  const row = await getDb().query.customPersonas.findFirst({ where: eq(customPersonas.id, id) });
  // Owners use it; managers can look at what their reps built.
  if (!row || (row.userId !== viewer.userId && !viewer.isManager)) notFound();
  const isOwner = row.userId === viewer.userId;
  const { input } = row;
  const signals = formatSignals(input);
  const stuck = isStuck(row);

  const header = (
    <div>
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← Back to prospects
      </Link>
      <div className="mt-2 flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{input.prospectName}</h1>
        <DifficultyBadge level={input.difficulty} />
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {input.prospectTitle}, {input.company} · {CUSTOM_VOICES[input.voice].label.split(":")[0]} voice
      </p>
    </div>
  );

  if (row.status === "researching" && !stuck) {
    return (
      <div className="space-y-6">
        {header}
        <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <p className="font-medium">
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
            Researching {input.prospectName.split(" ")[0]} and {input.company}…
          </p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Searching the web for their role, the company, hiring and funding news, then building
            the prospect. Usually one to three minutes. This page updates on its own.
          </p>
        </div>
        {signals.length > 0 && <SignalList signals={signals} />}
        <ResearchPoller id={row.id} />
      </div>
    );
  }

  if (row.status === "failed" || stuck || !row.persona) {
    return (
      <div className="space-y-6">
        {header}
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm dark:border-red-900 dark:bg-red-950">
          <p className="font-medium text-red-800 dark:text-red-200">
            {stuck ? "Research stopped responding." : "Research didn't finish."}
          </p>
          {row.error && <p className="mt-1 text-red-700 dark:text-red-300">{row.error}</p>}
        </div>
        {isOwner && (
          <form action={retryCustomPersona}>
            <input type="hidden" name="id" value={row.id} />
            <SubmitButton pendingLabel="Retrying…" className={primary}>
              Try the research again
            </SubmitButton>
          </form>
        )}
      </div>
    );
  }

  const persona = row.persona;
  return (
    <div className="space-y-8">
      {header}

      <p className="text-zinc-700 dark:text-zinc-300">{persona.tagline}</p>

      {isOwner && (
        <form action={createCall} className="flex flex-wrap items-center gap-4">
          <input type="hidden" name="personaId" value={persona.id} />
          <SubmitButton pendingLabel="Starting…" className={primary}>
            Call {persona.name.split(" ")[0]} →
          </SubmitButton>
          <span className="text-sm text-zinc-500">
            {persona.name.split(" ")[0]} picks up with &ldquo;{persona.firstMessage}&rdquo;
          </span>
        </form>
      )}

      <section className="space-y-2">
        <h2 className={section}>What your research turned up</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {persona.name.split(" ")[0]} confirms these if you bring them up, and corrects anything
          you claim that isn&apos;t here. Leading with one of them is your hook.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {persona.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>

      {row.dossier && (
        <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium">Full research notes</summary>
          <div className="mt-3 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{row.dossier}</div>
          {row.sources && row.sources.length > 0 && (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">Sources</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {row.sources.map((s) => (
                  <li key={s.url} className="truncate">
                    <a href={s.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}

      <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <summary className="cursor-pointer text-sm font-medium">
          Peek at the hidden script <span className="font-normal text-zinc-500">(spoils the call)</span>
        </summary>
        <div className="mt-3 space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
          <p>
            <span className="font-medium">Personality:</span> {persona.personality}
          </p>
          <p>
            <span className="font-medium">Warms up when:</span> {persona.warmsUpWhen}.
          </p>
          <ScriptList title="Private pains" items={persona.painPoints} />
          <ScriptList title="Objections" items={persona.objections} />
          <ScriptList title="Reactions" items={persona.reactions} />
          <p>
            <span className="font-medium">A win:</span> {persona.winCondition}
          </p>
        </div>
      </details>

      <p className="text-sm text-zinc-500">
        <Link href="/custom/new" className="underline-offset-2 hover:underline">
          Build another prospect
        </Link>
      </p>
    </div>
  );
}

function SignalList({ signals }: { signals: string[] }) {
  return (
    <section className="space-y-2">
      <h2 className={section}>Signals you gave us</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {signals.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </section>
  );
}

function ScriptList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="font-medium">{title}</div>
      <ul className="list-disc space-y-1 pl-5">
        {items.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
