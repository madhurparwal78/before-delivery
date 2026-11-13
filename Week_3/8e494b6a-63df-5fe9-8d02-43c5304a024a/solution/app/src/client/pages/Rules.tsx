// The published rules accordion: fourteen numbered rows, one per rule.
import { useState } from "react";
import { PUBLISHED_RULES } from "./rulesContent";

export function RulesPage() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="stack">
      <h1>Published rules</h1>
      <p className="muted narrow">Every rule and formula the product uses, with a worked example, so any number on screen can be checked.</p>
      <div className="accordion">
        {PUBLISHED_RULES.map((rule) => {
          const expanded = open === rule.index;
          return (
            <section key={rule.index} className="accordion-row">
              <h2>
                <button type="button" className="accordion-button" aria-expanded={expanded} aria-controls={`rule-${rule.index}`} onClick={() => setOpen(expanded ? null : rule.index)}>
                  <span className="accordion-index mono">{rule.index}</span>{" "}
                  <span>{rule.title}</span>
                  <span className="accordion-chevron" aria-hidden="true">{expanded ? "▴" : "▾"}</span>
                </button>
              </h2>
              <div id={`rule-${rule.index}`} role="region" aria-label={`Rule ${rule.index}`} hidden={!expanded} className="accordion-panel">
                {rule.blocks.map((block, k) =>
                  block.kind === "text" ? <p key={k}>{block.text}</p> : <pre key={k} className={block.kind} tabIndex={0}>{block.text}</pre>,
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
