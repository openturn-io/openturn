export interface DeadlineToken {
  /** Milliseconds remaining before the deadline expires. Negative when expired. */
  remainingMs(): number;
  /** True once the deadline has passed. */
  expired(): boolean;
}

export interface DeadlineClock {
  now(): number;
}

export const realClock: DeadlineClock = {
  now: () => Date.now(),
};

export function createDeadline(budgetMs: number, clock: DeadlineClock = realClock): DeadlineToken {
  const start = clock.now();
  const target = start + budgetMs;
  return {
    remainingMs: () => target - clock.now(),
    expired: () => clock.now() >= target,
  };
}
