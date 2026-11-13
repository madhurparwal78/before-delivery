import type { Output } from "../shared/api";
import { isOverCap, removedOutput } from "../shared/outputs";
import { limits } from "./config";

/** A run's outputs as the server stores them: over-cap outputs replaced by the notice, counts stamped on results. */
export function storedOutputs(outputs: Output[], count: number | null): Output[] {
  return outputs.map((output) => {
    if (isOverCap(output, limits.output_byte_cap)) return removedOutput(limits.output_byte_cap);
    return output.output_type === "execute_result" ? { ...output, execution_count: count } : output;
  });
}
