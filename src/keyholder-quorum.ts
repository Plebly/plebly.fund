/**
 * Signing threshold from active keyholder count.
 * Must match workers/src/lib/keyholder-quorum.ts.
 */
export const KEYHOLDER_MIN_SEATS = 2;
export const KEYHOLDER_TARGET_SEATS = 5;

export function keyholderSigningThreshold(seats: number): number {
  const n = Math.max(0, Math.floor(seats));
  if (n <= 0) return 0;
  if (n === 1) return 1;
  return Math.max(KEYHOLDER_MIN_SEATS, Math.ceil((3 * n) / 5));
}

export function keyholderQuorumLabel(seats: number): string {
  const n = Math.max(0, Math.floor(seats));
  return `${keyholderSigningThreshold(n)}-of-${n}`;
}

export function releaseSigningThreshold(
  escrowMode: string,
  activeSeats: number,
): number {
  if (escrowMode === "single-key-test") return 1;
  const n = Math.max(0, Math.floor(activeSeats));
  if (n < KEYHOLDER_MIN_SEATS) return KEYHOLDER_MIN_SEATS;
  return keyholderSigningThreshold(n);
}
