import { parentPort, workerData } from "node:worker_threads";
import { measure, shrinkJpeg, type MeasureRequest } from "./pixels.js";

const port = parentPort;
if (!port) throw new Error("imageWorker runs only as a worker thread");
const request = workerData as MeasureRequest | { shrink: { bytes: Uint8Array; width: number } };

try {
  const result = "shrink" in request ? shrinkJpeg(request.shrink.bytes, request.shrink.width) : measure(request);
  port.postMessage({ result });
} catch (error) {
  port.postMessage({ failure: error instanceof Error ? error.message : "undecodable" });
}
