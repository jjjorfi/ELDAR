/**
 * Resolves a promise with `null` when it does not settle before timeout.
 *
 * @param promise Source promise.
 * @param timeoutMs Timeout in milliseconds.
 * @returns Source value or null on timeout/error.
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(null);
      });
  });
}

/**
 * Resolves a promise with a caller-provided fallback when timeout or error occurs.
 *
 * @param promise Source promise.
 * @param timeoutMs Timeout in milliseconds.
 * @param fallback Fallback value returned on timeout/error.
 * @returns Source value or fallback.
 */
export async function withTimeoutFallback<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T
): Promise<T> {
  const result = await withTimeout(promise, timeoutMs);
  return result ?? fallback;
}

