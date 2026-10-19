import { setTimeout as delay } from 'node:timers/promises';

// Await IPC predicates before checking their result. A Promise is not readiness.
export async function waitForCondition(read, { timeout = 30000, interval = 100, message = 'Condition timed out' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(Math.min(interval, Math.max(0, deadline - Date.now())));
  }
  throw new Error(message);
}
