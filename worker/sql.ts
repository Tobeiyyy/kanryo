/** D1 rejects a statement with more than 100 bound parameters ("too many SQL variables"). */
export const D1_MAX_PARAMS = 100;

/** Splits ids into slices that each fit one `IN (?, ...)` list. */
export function chunks<T>(items: T[], size = D1_MAX_PARAMS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs `SELECT ... WHERE col IN (...)` once per slice and concatenates the rows. */
export async function selectIn<R>(
  db: D1Database, sqlWithList: (placeholders: string) => string, ids: unknown[],
): Promise<R[]> {
  const rows: R[] = [];
  for (const slice of chunks(ids)) {
    const { results } = await db.prepare(sqlWithList(slice.map(() => "?").join(",")))
      .bind(...slice).all<R>();
    rows.push(...results);
  }
  return rows;
}
