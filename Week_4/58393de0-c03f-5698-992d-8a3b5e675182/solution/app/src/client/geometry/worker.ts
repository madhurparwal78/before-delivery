import Module from "../../../third_party/manifold/manifold.js";
import wasmUrl from "../../../third_party/manifold/manifold.wasm?url";
import { runJob } from "./build";
import type { WorkerRequest, WorkerResponse } from "./types";

const ready = Module({ locateFile: () => wasmUrl }).then((api) => {
  api.setup();
  return api;
});

/** The buffers of a result that can move to the page without copying. */
function transferables(output: unknown): Transferable[] {
  if (typeof output !== "object" || output === null) return [];
  if ("bytes" in output && output.bytes instanceof Uint8Array) return [output.bytes.buffer];
  if ("positions" in output && "indices" in output && output.positions instanceof Float32Array && output.indices instanceof Uint32Array) {
    return [output.positions.buffer, output.indices.buffer];
  }
  return [];
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  void ready.then((api) => {
    try {
      const output = runJob(api, request);
      const response: WorkerResponse = { id: request.id, ok: true, output };
      self.postMessage(response, { transfer: transferables(output) });
    } catch (error) {
      const response: WorkerResponse = { id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) };
      self.postMessage(response);
    }
  });
};
