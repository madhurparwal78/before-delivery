import type { BakeMessage, BakeRequest } from "../shared/bake-protocol";
import { Bake } from "./executor";

let bake: Bake | null = null;

function post(message: BakeMessage, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

self.onmessage = (event: MessageEvent<BakeRequest>) => {
  const request = event.data;
  const id = request.id;
  if (request.kind === "start") {
    bake = new Bake(request, (step, branch) => post({ kind: "regex", id, step, branch }));
  }
  const running = bake as Bake;
  const outcome = running.advance(request.mode, request.kind === "continue");
  if (outcome.status !== "paused") bake = null;
  post({ kind: "result", id, outcome }, [outcome.output.buffer]);
};
