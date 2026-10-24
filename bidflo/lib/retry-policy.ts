export function retryPolicy(attempt: number, options: { maxAttempts: number; maxDelayMinutes: number }) {
  const safeAttempt = Math.max(1, Math.min(Math.floor(attempt || 1), 30));
  return {
    exhausted: safeAttempt >= options.maxAttempts,
    delayMinutes: Math.min(2 ** safeAttempt, options.maxDelayMinutes),
  };
}
