/** Must stay aligned with `src/domain/statuses.ts` calculateLaunchCount. */
export function calculateLaunchCount(input: {
  concurrencyLimit: number;
  persistedActiveCount: number;
  locallyAvailablePermits: number;
}): number {
  const databaseCapacity = Math.max(0, input.concurrencyLimit - input.persistedActiveCount);
  return Math.min(databaseCapacity, input.locallyAvailablePermits);
}

export const TERMINAL_CALL_ATTEMPT_STATUSES = [
  "completed",
  "busy",
  "failed",
  "no_answer",
  "canceled",
] as const;

export type CallAttemptStatusLike = string;

export function isTerminalCallAttemptStatus(status: CallAttemptStatusLike): boolean {
  return (TERMINAL_CALL_ATTEMPT_STATUSES as readonly string[]).includes(status);
}
