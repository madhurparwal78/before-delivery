import { encodeText, firstUnencodable } from "../../shared/bytes";
import { followSpan } from "../../shared/span";
import type { ByteRange, SpanView } from "../../shared/span";
import { inputBytes, stepsKey } from "./state";
import type { BakeView, InputTab, StepItem } from "./state";

/** The selected characters of typed input as the byte range they occupy under the tab's encoding. */
function selectedBytes(tab: InputTab): ByteRange | null {
  const { start, end } = tab.selection;
  if (tab.file || start === end || firstUnencodable(tab.text, tab.encoding) !== null) return null;
  return {
    start: encodeText(tab.text.slice(0, start), tab.encoding).length,
    end: encodeText(tab.text.slice(0, end), tab.encoding).length,
  };
}

/** Where the selected bytes went through the latest bake, or null when there is nothing to show. */
export function spanOf(steps: readonly StepItem[], bake: BakeView, tab: InputTab): SpanView | null {
  const selected = selectedBytes(tab);
  if (!selected || bake.phase === "idle" || bake.phase === "running" || bake.stepsKey !== stepsKey(steps)) return null;
  if (bake.inputLength !== inputBytes(tab)?.length) return null;
  return followSpan(selected, steps, bake.lengths, bake.reached);
}
