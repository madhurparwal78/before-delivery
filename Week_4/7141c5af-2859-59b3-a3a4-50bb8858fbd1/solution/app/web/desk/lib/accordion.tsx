import type { ComponentChildren, JSX } from "preact";
import { useId, useState } from "preact/hooks";
import { glyph } from "../../shared/dots.ts";

/** An accordion row: its state is its own, so a refresh leaves it as it was (SR1), and a closed panel is hidden and inert (SR9). */
export function Accordion({ title, children }: { title: string; children: ComponentChildren }): JSX.Element {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div class="accordion">
      <h2>
        <button type="button" class="accordion-head" aria-expanded={open ? "true" : "false"} aria-controls={panel} onClick={() => setOpen((was) => !was)}>
          {title}
          <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: glyph(open ? "up" : "down") }} />
        </button>
      </h2>
      <div id={panel} class="accordion-panel" hidden={!open} inert={!open}>
        {children}
      </div>
    </div>
  );
}
