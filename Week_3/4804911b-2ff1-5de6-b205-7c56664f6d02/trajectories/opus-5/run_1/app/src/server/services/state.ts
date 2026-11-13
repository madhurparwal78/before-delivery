/** Whether the latest contact with a provider failed, which every outage sentence derives from. */
export class ServiceState {
  private failed = false;
  private contacted = false;

  record(reachable: boolean): void {
    this.failed = !reachable;
    this.contacted = true;
  }

  get down(): boolean {
    return this.contacted && this.failed;
  }
}

export const serviceStates = {
  svix: new ServiceState(),
  storage: new ServiceState(),
  search: new ServiceState(),
  broker: new ServiceState(),
};

export async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export class DeadlinePassed extends Error {}

/** Bounds a whole action, so a provider that hangs never hangs an answer. */
export async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DeadlinePassed('deadline passed')), ms);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export function deadline(ms: number): { passed: () => boolean } {
  const at = Date.now() + ms;
  return { passed: () => Date.now() > at };
}
