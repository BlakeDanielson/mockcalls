"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { isRole, requireAdmin } from "@/lib/auth";

/** Admins assign roles. The role is stored on the Clerk user, so it follows them everywhere. */
export async function setRole(formData: FormData) {
  const viewer = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!userId.startsWith("user_") || !isRole(role)) redirect("/admin?error=bad");
  // Nobody can change their own role: it keeps at least one admin around.
  if (userId === viewer.userId) redirect("/admin?error=self");

  const client = await clerkClient();
  await client.users.updateUserMetadata(userId, { publicMetadata: { role } });
  redirect(`/admin?saved=${encodeURIComponent(userId)}`);
}
