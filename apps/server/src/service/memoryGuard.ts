const MB = 1024 * 1024;

export interface MemorySample {
  heapUsed: number;
  external: number;
}

/** Heap + external, not RSS: RSS drops when the kernel swaps pages out, which hides a leak on a swapping host. */
export function usedMb(sample: MemorySample): number {
  return (sample.heapUsed + sample.external) / MB;
}

export function isOverLimit(sample: MemorySample, limitMb: number): boolean {
  return limitMb > 0 && usedMb(sample) > limitMb;
}

/**
 * Polls the process's own memory and calls `onExceeded` once it passes `limitMb`. The caller is
 * expected to exit so the container restart policy replaces a bloated process with a fresh one
 * *before* the host starts swapping and every other container on it degrades.
 */
export function startMemoryGuard(opts: {
  limitMb: number;
  intervalMs?: number;
  sample?: () => MemorySample;
  onExceeded: (usedMb: number) => void;
}): NodeJS.Timeout | undefined {
  if (opts.limitMb <= 0) return undefined;
  const sample = opts.sample ?? (() => process.memoryUsage());
  let fired = false;
  const timer = setInterval(() => {
    const current = sample();
    if (!fired && isOverLimit(current, opts.limitMb)) {
      fired = true;
      opts.onExceeded(usedMb(current));
    }
  }, opts.intervalMs ?? 30_000);
  timer.unref();
  return timer;
}
