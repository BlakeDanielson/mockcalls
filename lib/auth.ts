import { auth, currentUser } from "@clerk/nextjs/server";
import type { Call } from "@/db/schema";

export const ROLES = ["rep", "manager", "admin"] as const;
export type Role = (typeof ROLES)[number];

export type Viewer = {
  userId: string;
  role: Role;
  /** Managers and admins see every rep's calls and the team views. */
  isManager: boolean;
  /** Admins also assign roles. */
  isAdmin: boolean;
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

function viewerFor(userId: string, role: Role): Viewer {
  return {
    userId,
    role,
    isManager: role === "manager" || role === "admin",
    isAdmin: role === "admin",
  };
}

/**
 * The role lives in Clerk `publicMetadata.role`. When the instance's session
 * token is configured with `metadata = {{user.public_metadata}}` it arrives in
 * the session claims for free; otherwise fall back to one Clerk lookup per
 * request (Clerk dedupes `currentUser()` within a request).
 */
async function resolveViewer(a: Awaited<ReturnType<typeof auth>>): Promise<Viewer | null> {
  if (!a.userId) return null;
  const claimed = a.sessionClaims?.metadata?.role;
  if (isRole(claimed)) return viewerFor(a.userId, claimed);
  if (a.sessionClaims?.metadata !== undefined) return viewerFor(a.userId, "rep");
  const u = await currentUser();
  const stored = u?.publicMetadata?.role;
  return viewerFor(a.userId, isRole(stored) ? stored : "rep");
}

/** Pages and server actions: sends signed-out visitors to sign-in and back again afterwards. */
export async function requireUser(): Promise<Viewer> {
  const a = await auth();
  const viewer = await resolveViewer(a);
  if (!viewer) a.redirectToSignIn(); // throws; preserves the requested URL
  return viewer as Viewer;
}

/** Admin-only pages and actions. Non-admins get a 404 so the page's existence is never confirmed. */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireUser();
  if (!viewer.isAdmin) {
    const { notFound } = await import("next/navigation");
    notFound();
  }
  return viewer;
}

/** Route handlers: null when signed out; the caller answers 401. */
export async function apiUser(): Promise<Viewer | null> {
  return resolveViewer(await auth());
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
