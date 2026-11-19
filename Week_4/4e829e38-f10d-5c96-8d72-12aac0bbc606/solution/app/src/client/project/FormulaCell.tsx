import { useRef } from "preact/hooks";
import { useMount } from "../hooks";
import { reducedMotion, tween } from "../motion";
import type { Field, FieldValue } from "../types";

const FADE_MS = 240;

const show = (value: FieldValue): string => (value === null || value === "" ? "" : Array.isArray(value) ? value.join(", ") : String(value));

/** A formula value: the accessible value changes at once, the text cross-fades over 240 ms. */
export function FormulaCell({ field, value, navProps }: { field: Field; value: FieldValue; navProps: Record<string, unknown> }) {
  const cell = useRef<HTMLDivElement>(null);
  const shown = useRef(show(value));
  useMount(() => {
    const text = show(value);
    const el = cell.current;
    if (!el || text === shown.current) return;
    shown.current = text;
    if (reducedMotion()) {
      el.dataset.motion = "settled";
      return;
    }
    el.dataset.motion = "fading";
    const run = tween(FADE_MS, (x) => { el.style.setProperty("--fade", String(x)); }, () => { el.dataset.motion = "settled"; });
    return () => run.cancel();
  }, [show(value)]);
  const text = show(value);
  return (
    <div role="gridcell" ref={cell} class="g-cell g-value g-formula" data-motion="settled" aria-readonly="true"
      aria-label={`${field.name}, ${text === "" ? "blank" : text}`} {...navProps}>
      <span class="num formula-text">{text}</span>
    </div>
  );
}
