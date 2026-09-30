import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(neon(url), { schema });
}

type Db = ReturnType<typeof create>;
let cached: Db | undefined;

/** Lazy so `next build` can import route modules without a database. */
export function getDb(): Db {
  return (cached ??= create());
}
