import { MOVE_REFUSAL_COPY, tooDeep } from "../shared/copy.js";
import type { MoveRefusal } from "../shared/moves.js";
import { config } from "./config.js";
import { ApiError, conflict, invalid } from "./http.js";

/** Every move refusal leaves through here, so the code and copy match everywhere. */
export function refusalError(code: MoveRefusal): ApiError {
  if (code === "index") return invalid({ index: "Choose a place inside the list." });
  if (code === "too_deep") return conflict("too_deep", tooDeep(config.maxDepth));
  return conflict(code, MOVE_REFUSAL_COPY[code]);
}
