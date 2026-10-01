import { auth, currentUser } from "@clerk/nextjs/server";
import type { Call } from "@/db/schema";

export type Viewer = { userId: string; isManager: boolean };

function toViewer(a: Awaited<ReturnType<typeof auth>>): Viewer | null {
  if (!a.userId) return null;
  // `metadata` is on the session token via the instance's session.claims config.
  return {
    userId: a.userId,
    isManager: a.sessionClaims?.metadata?.role === "manager",
  };
}

/** Pages and server actions: sends signed-out visitors to sign-in and back again afterwards. */
export async function requireUser(): Promise<Viewer> {
  const a = await auth();
  const viewer = toViewer(a);
  if (!viewer) a.redirectToSignIn(); // throws; preserves the requested URL
  return viewer as Viewer;
}

/** Route handlers: null when signed out; the caller answers 401. */
export async function apiUser(): Promise<Viewer | null> {
  return toViewer(await auth());
}

/** Managers see every call; reps see their own. */
export function canSeeCall(call: Pick<Call, "userId">, viewer: Viewer): boolean {
  return viewer.isManager || call.userId === viewer.userId;
}

/** Display name snapshot stored on each call as `repName`. */
export async function displayName(): Promise<string> {
  const u = await currentUser();
  const name = [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();
  return name || u?.primaryEmailAddress?.emailAddress || "Unknown rep";
}
