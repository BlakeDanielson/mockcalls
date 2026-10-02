import { ClerkProvider, UserButton } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import { apiUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "mockcalls",
  description: "Cold-call practice against an AI prospect",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const viewer = await apiUser(); // null while signed out (sign-in/up pages)

  return (
    <html lang="en" className="h-full scroll-smooth antialiased">
      <body className="flex min-h-full flex-col">
        <ClerkProvider>
          <header className="border-b border-zinc-200 dark:border-zinc-800">
            <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
              <Link href="/" className="font-semibold tracking-tight">
                mockcalls
              </Link>
              {viewer && (
                <nav className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
                  <Link
                    href="/history"
                    className="hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    {viewer.isManager ? "Team history" : "History"}
                  </Link>
                  <Link
                    href="/analytics"
                    className="hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    {viewer.isManager ? "Team" : "Trends"}
                  </Link>
                  {viewer.isAdmin && (
                    <Link
                      href="/admin"
                      className="hover:text-zinc-900 dark:hover:text-zinc-100"
                    >
                      People
                    </Link>
                  )}
                  <UserButton />
                </nav>
              )}
            </div>
          </header>
          <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8">
            {children}
          </main>
        </ClerkProvider>
      </body>
    </html>
  );
}
