const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Guard route params before they hit a uuid column (Postgres errors on bad input). */
export const isUuid = (s: string) => UUID_RE.test(s);
