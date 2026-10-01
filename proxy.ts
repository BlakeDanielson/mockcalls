import { clerkMiddleware } from "@clerk/nextjs/server";

// Session handling only. Authorization happens at each page/route via lib/auth.ts,
// per Clerk's current guidance (createRouteMatcher is deprecated).
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
