// `region "Merge checks"`: the API's check list, in the API's order and with the API's names and texts. A check whose state changes
// plays `check-flip` (opacity 0.4 -> 1, 180 ms) on its list item; reduced motion skips it.
import type { Ref } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { prefersReducedMotion } from "../../hooks.ts";
import { StatusBadge } from "../../ui/index.ts";
import type { MrCheck } from "./data.ts";
import { PanelSection } from "./parts.tsx";

const FLIP_MS = 180;

function CheckItem({ check }: { check: MrCheck }) {
  const item = useRef<HTMLLIElement>(null);
  const shown = useRef(check.state);
  useLayoutEffect(() => {
    if (shown.current === check.state) return;
    shown.current = check.state;
    if (!prefersReducedMotion()) item.current?.animate({ opacity: [0.4, 1] }, { duration: FLIP_MS, easing: "ease-out", id: "check-flip" });
  }, [check.state]);
  return (
    <li ref={item} aria-label={`Merge check ${check.name}, ${check.state}`} class={`sp-check-row sp-check-row--${check.state}`} data-state={check.state}>
      <span class="sp-check-row__head">
        <span class="sp-check-row__name">{check.name}</span>
        <StatusBadge status={check.state} />
      </span>
      {check.text ? <span class="sp-check-row__text">{check.text}</span> : null}
    </li>
  );
}

export function MergeChecks({ checks, innerRef }: { checks: readonly MrCheck[] | null; innerRef?: Ref<HTMLElement> }) {
  return (
    <PanelSection title="Merge checks" innerRef={innerRef} focusable>
      {checks === null ? (
        <p class="sp-muted">Loading</p>
      ) : (
        <ul class="sp-check-list">
          {checks.map((check) => (
            <CheckItem key={check.name} check={check} />
          ))}
        </ul>
      )}
    </PanelSection>
  );
}
