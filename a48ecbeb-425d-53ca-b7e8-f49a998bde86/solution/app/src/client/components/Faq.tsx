import { ChevronDown } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";

const ITEMS: [string, string][] = [
  [
    "How does the can deposit work?",
    "Provinces that run a container deposit add it per can. It shows as its own Deposit line, it is never discounted or taxed, and it doesn't count towards free shipping. Return the empties through your provincial program.",
  ],
  [
    "When is my card charged for a subscription?",
    "Your first box is charged when you check out. Each renewal is charged on its renewal date, and the subscription page always shows the next one. If a renewal payment fails, we retry on days 1, 3 and 7 and email you each time.",
  ],
  [
    "How long are limited-drop cans held?",
    "Every can in your crate is held for 15 minutes from the first can you add. Adding more doesn't extend the hold. You can hold up to 6 cans of a limited drop at once.",
  ],
  [
    "Can I change my box before it ships?",
    "Yes. Pause, skip, swap flavours or cancel from your subscription page. Changes made at least two days before a renewal apply to that box; later changes apply to the one after.",
  ],
];

/** Four questions; a collapsed answer is unmounted, so it is out of view, focus and the tree. */
export function Faq() {
  const id = useId();
  const [open, setOpen] = useState<Set<number>>(new Set());
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const toggle = (i: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const onKey = (i: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      buttons.current[(i + step + ITEMS.length) % ITEMS.length]?.focus();
    }
  };
  return (
    <div className="faq">
      <h3 className="faq-title">Questions, answered</h3>
      {ITEMS.map(([question, answer], i) => {
        const expanded = open.has(i);
        return (
          <div className={`faq-item ${expanded ? "is-open" : ""}`} key={question}>
            <h4>
              <button
                type="button"
                ref={(el) => {
                  buttons.current[i] = el;
                }}
                aria-expanded={expanded}
                aria-controls={expanded ? `${id}-answer-${i}` : undefined}
                onClick={() => toggle(i)}
                onKeyDown={onKey(i)}
              >
                <span>{question}</span>
                <ChevronDown size={20} aria-hidden="true" />
              </button>
            </h4>
            {expanded && (
              <div className="faq-answer" id={`${id}-answer-${i}`} role="region" aria-label={question}>
                <p>{answer}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
