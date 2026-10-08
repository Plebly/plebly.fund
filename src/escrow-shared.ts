/**
 * Shared-escrow check for display only. The client only controls what the
 * page says; the server is the gate (the Worker decides refund binding and
 * credit, whatever this returns).
 *
 * Fails toward shared: an address counts as shared unless its row says
 * `escrow_shared === false` AND no more than one loaded catalog row uses the
 * same (trimmed) address. A null or missing flag is shared, whatever the
 * catalog holds, so a direct link with no catalog loaded, a partial catalog
 * or a failed catalog load all read as shared. Computed at read time from
 * the catalog field names (`escrow_address`, `escrow_shared`); nothing stored.
 */
export type EscrowRow = {
  escrow_address?: unknown;
  escrow_shared?: unknown;
};

function trimmedAddress(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function isSharedEscrow(row: EscrowRow, catalog: ReadonlyArray<EscrowRow> = []): boolean {
  if (row.escrow_shared !== false) return true;
  const address = trimmedAddress(row.escrow_address);
  if (!address) return false;
  let rowsOnAddress = 0;
  for (const r of catalog) {
    if (trimmedAddress(r.escrow_address) !== address) continue;
    if (r.escrow_shared === true) return true;
    rowsOnAddress += 1;
    if (rowsOnAddress > 1) return true;
  }
  return false;
}
