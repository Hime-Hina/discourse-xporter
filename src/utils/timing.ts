export function normalizeDelayRange(
  min: number,
  max: number,
): [number, number] {
  const safeMin = Math.max(0, Math.floor(Number.isFinite(min) ? min : 0));
  const safeMax = Math.max(0, Math.floor(Number.isFinite(max) ? max : safeMin));
  return safeMin <= safeMax ? [safeMin, safeMax] : [safeMax, safeMin];
}

export function randomDelayMs(min: number, max: number): number {
  const [from, to] = normalizeDelayRange(min, max);
  return Math.floor(Math.random() * (to - from + 1)) + from;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function sleepRandom(
  min: number,
  max: number,
  signal?: AbortSignal,
): Promise<void> {
  return sleep(randomDelayMs(min, max), signal);
}

/** Retry-After is bounded so a malformed server value cannot stall a task indefinitely. */
export function retryDelayMs(retryAfter: string | null, attempt = 1): number {
  if (retryAfter?.trim()) {
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(delay)) return Math.min(60_000, Math.max(0, delay));
  }
  return Math.min(60_000, 500 * 2 ** (attempt - 1));
}
