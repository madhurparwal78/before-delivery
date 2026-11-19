/// <reference lib="webworker" />
import { runBake, type RunnerRequest } from './runner.js';

self.onmessage = (ev: MessageEvent) => {
  const data = ev.data as RunnerRequest | { runId: number; kill: true };
  if (!data || typeof data !== 'object' || !('runId' in data)) return;
  if ('kill' in data) {
    self.close();
    return;
  }
  void runBake(data as RunnerRequest).then((result) => {
    if (result.kind === 'badMessage') {
      self.postMessage({ type: 'badMessage' });
      return;
    }
    const transfer: ArrayBuffer[] = [result.output];
    const intermediates: Record<string, ArrayBuffer> = {};
    for (const [k, v] of result.intermediates) {
      const copy = v.slice().buffer as ArrayBuffer;
      intermediates[String(k)] = copy;
      transfer.push(copy);
    }
    self.postMessage(
      {
        type: 'done',
        runId: result.runId,
        output: result.output,
        ms: result.ms,
        lastStep: result.lastStep,
        pausedBefore: result.pausedBefore,
        errorStep: result.errorStep,
        errorMessage: result.errorMessage,
        intermediates,
      },
      transfer,
    );
  });
};
