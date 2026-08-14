export type CooperativeDelayEvent = "start" | "completed" | "cancelled";
export type CooperativeDelayResult = Exclude<CooperativeDelayEvent, "start">;

export interface CooperativeDelayTimer {
  schedule(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

interface CooperativeDelayOptions {
  delayMs: number;
  signal: AbortSignal;
  onEvent(event: CooperativeDelayEvent): void;
  timer?: CooperativeDelayTimer;
}

const SYSTEM_TIMER: CooperativeDelayTimer = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function runCooperativeDelay(options: CooperativeDelayOptions): Promise<CooperativeDelayResult> {
  const { delayMs, signal, onEvent, timer = SYSTEM_TIMER } = options;
  const noTimer = Symbol("no-timer");

  return new Promise((resolve, reject) => {
    let timerHandle: unknown | typeof noTimer = noTimer;
    let scheduling = false;
    let pendingResult: CooperativeDelayResult | undefined;
    let settled = false;

    const finish = (result: CooperativeDelayResult): void => {
      if (settled) return;

      if (scheduling) {
        pendingResult ??= result;
        return;
      }

      settled = true;

      let cleanupFailed = false;
      let cleanupError: unknown;
      if (timerHandle !== noTimer) {
        try {
          timer.clear(timerHandle);
        } catch (error) {
          cleanupFailed = true;
          cleanupError = error;
        }
        timerHandle = noTimer;
      }
      signal.removeEventListener("abort", cancel);

      if (cleanupFailed) {
        reject(cleanupError);
        return;
      }

      try {
        onEvent(result);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };

    function cancel(): void {
      finish("cancelled");
    }

    try {
      onEvent("start");

      if (signal.aborted) {
        cancel();
        return;
      }

      signal.addEventListener("abort", cancel, { once: true });
      scheduling = true;
      timerHandle = timer.schedule(() => finish("completed"), delayMs);
      scheduling = false;

      if (pendingResult !== undefined) finish(pendingResult);
    } catch (error) {
      scheduling = false;
      settled = true;
      if (timerHandle !== noTimer) {
        try {
          timer.clear(timerHandle);
        } catch {
          // The scheduling error remains the primary failure.
        }
        timerHandle = noTimer;
      }
      signal.removeEventListener("abort", cancel);
      reject(error);
    }
  });
}
