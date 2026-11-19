import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { copy } from "../../../../server/domain/copy.ts";
import { EASE, MOVE_MS, reducedMotion } from "../../lib/motion.ts";

/** The used amount prints large inside the published sentence, which stays one text. */
function figureLine(used: string, text: string): JSX.Element {
  const amount = `${used} sq ft`;
  const at = text.indexOf(amount);
  return (
    <>
      {text.slice(0, at)}
      <span class="hide-figure-used">{amount}</span>
      {text.slice(at + amount.length)}
    </>
  );
}

/** The used-leather figure: on a change the old line rolls up and out and the new one rolls up into place. */
export function HideFigure({ used, percent }: { used: string; percent: string }): JSX.Element {
  const text = copy("F-52", { used, percent });
  const [leaving, setLeaving] = useState<JSX.Element | null>(null);
  const shown = useRef(text);
  const shownLine = useRef(figureLine(used, text));
  const incoming = useRef<HTMLSpanElement>(null);
  const outgoing = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (shown.current === text) return;
    const previous = shownLine.current;
    shown.current = text;
    shownLine.current = figureLine(used, text);
    if (!reducedMotion()) setLeaving(previous);
  }, [text, used]);

  useLayoutEffect(() => {
    if (leaving === null) return;
    const timing = { duration: MOVE_MS, easing: EASE };
    outgoing.current?.animate([{ translate: "0 0", opacity: 1 }, { translate: "0 -100%", opacity: 0 }], timing);
    const rise = incoming.current?.animate([{ translate: "0 100%", opacity: 0 }, { translate: "0 0", opacity: 1 }], timing);
    if (rise) rise.onfinish = rise.oncancel = () => setLeaving(null);
  }, [leaving]);

  return (
    <span class="hide-figure" data-part="hide-figure">
      {leaving === null ? null : (
        <span ref={outgoing} class="hide-figure-old" aria-hidden="true">
          {leaving}
        </span>
      )}
      <span ref={incoming} class="hide-figure-new">
        {figureLine(used, text)}
      </span>
    </span>
  );
}
