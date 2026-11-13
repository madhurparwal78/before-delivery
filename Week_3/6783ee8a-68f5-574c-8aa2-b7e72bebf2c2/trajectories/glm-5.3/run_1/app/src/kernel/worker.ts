import { clearSharedInterrupt, raiseSharedInterrupt, restartKernel, runCell, sharedInterruptBuffer } from "./kernel.ts";
import type { FromWorkerMessage, ToWorkerMessage } from "./protocol.ts";

const post = (message: FromWorkerMessage): void => {
  (self as unknown as Worker).postMessage(message);
};

// The shared interrupt flag travels only to an isolated page; otherwise the harness
// falls back to an interrupt message, which still stops any yielding loop.
const isolated = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
const interruptBuffer = isolated ? sharedInterruptBuffer() : null;
if (isolated && interruptBuffer !== null) {
  post({ type: "started", interruptBuffer });
} else {
  post({ type: "started", interruptBuffer: null });
}

self.onmessage = (event: MessageEvent) => {
  const data = event.data as ToWorkerMessage;
  if (data.type === "restart") {
    restartKernel();
    return;
  }
  if (data.type === "interrupt") {
    raiseSharedInterrupt();
    return;
  }
  if (data.type === "run") {
    clearSharedInterrupt();
    void runCell(data.code, data.execLimitMs, data.quiet === true).then((outcome) => {
      post({ type: "run_done", outcome });
    });
  }
};
