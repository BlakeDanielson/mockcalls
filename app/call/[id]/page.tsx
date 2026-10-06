import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { CallSession } from "@/components/CallSession";
import { getDb } from "@/db";
import { calls } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { buildOverrides, callPersona } from "@/lib/personas";
import { isUuid } from "@/lib/uuid";

export const dynamic = "force-dynamic";

export default async function CallPage(props: PageProps<"/call/[id]">) {
  const viewer = await requireUser();
  const { id } = await props.params;
  if (!isUuid(id)) notFound();

  const call = await getDb().query.calls.findFirst({ where: eq(calls.id, id) });
  // Only the rep who owns the call drives it; managers review results instead.
  if (!call || call.userId !== viewer.userId) notFound();
  if (
    call.status === "ended" ||
    call.status === "scored" ||
    call.status === "failed"
  ) {
    redirect(`/call/${id}/results`);
  }

  const persona = callPersona(call);
  if (!persona) notFound();

  return (
    <CallSession
      callId={call.id}
      repName={call.repName}
      persona={persona}
      overrides={buildOverrides(persona, call.repName)}
    />
  );
}
