export function normalizeDelayRange(min: number, max: number): [number, number] {
  const safeMin = Math.max(0, Math.floor(Number.isFinite(min) ? min : 0));
  const safeMax = Math.max(0, Math.floor(Number.isFinite(max) ? max : safeMin));
  return safeMin <= safeMax ? [safeMin, safeMax] : [safeMax, safeMin];
}

export function randomDelayMs(min: number, max: number): number {
  const [from, to] = normalizeDelayRange(min, max);
  return Math.floor(Math.random() * (to - from + 1)) + from;
}

export function sleepRandom(min: number, max: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, randomDelayMs(min, max)));
}
