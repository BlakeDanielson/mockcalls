import { clerkClient } from "@clerk/nextjs/server";
import { setRole } from "./actions";
import { isRole, ROLES, requireAdmin, type Role } from "@/lib/auth";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const ROLE_HELP: Record<Role, string> = {
  rep: "Own calls only.",
  manager: "Every rep's calls, team history and team analytics.",
  admin: "Manager access plus this page.",
};

export default async function AdminPage(props: PageProps<"/admin">) {
  const viewer = await requireAdmin();
  const sp = await props.searchParams;

  const client = await clerkClient();
  const { data: users } = await client.users.getUserList({ limit: 200, orderBy: "-last_sign_in_at" });

  const rows = users
    .map((u) => {
      const email =
        u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ??
        u.emailAddresses[0]?.emailAddress ??
        "";
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || email;
      const stored = u.publicMetadata?.role;
      return {
        id: u.id,
        name,
        email,
        role: (isRole(stored) ? stored : "rep") as Role,
        lastSignInAt: u.lastSignInAt ? new Date(u.lastSignInAt) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const notice =
    sp.error === "self"
      ? "You can't change your own role. Ask another admin."
      : sp.error === "bad"
        ? "That change didn't make sense; nothing was saved."
        : typeof sp.saved === "string"
          ? `Saved. ${rows.find((r) => r.id === sp.saved)?.name ?? "They"} will see the change on their next page load.`
          : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">People and roles</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Everyone who has signed in. Roles are stored on the Clerk user.
        </p>
      </div>

      {notice && (
        <p
          className={`rounded-lg border p-3 text-sm ${
            sp.error
              ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
              : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
          }`}
        >
          {notice}
        </p>
      )}

      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <dt className="font-medium capitalize">{r}</dt>
            <dd className="text-zinc-600 dark:text-zinc-400">{ROLE_HELP[r]}</dd>
          </div>
        ))}
      </dl>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Last sign-in</th>
              <th className="px-3 py-2">Role</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const self = r.id === viewer.userId;
              return (
                <tr key={r.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-3 py-2 font-medium">
                    {r.name}
                    {self && <span className="ml-2 text-xs text-zinc-500">(you)</span>}
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.email}</td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                    {r.lastSignInAt ? formatDate(r.lastSignInAt) : "never"}
                  </td>
                  <td className="px-3 py-2">
                    {self ? (
                      <span className="capitalize">{r.role}</span>
                    ) : (
                      <form action={setRole} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={r.id} />
                        <select
                          name="role"
                          defaultValue={r.role}
                          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          {ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          Save
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500">
        New people sign in with their work Google account and start as a rep. Role changes take effect
        on their next page load.
      </p>
    </div>
  );
}
