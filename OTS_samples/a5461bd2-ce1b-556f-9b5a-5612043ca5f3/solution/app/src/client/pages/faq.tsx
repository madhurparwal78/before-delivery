import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { catalog } from "../boot";
import { focusClear } from "../focus";
import { useLocation } from "../router";

export function FaqPage() {
  const location = useLocation();
  const requested = new URLSearchParams(location.search).get("open");
  const [open, setOpen] = useState<string[]>(() => (catalog.questions.some((question) => question.id === requested) && requested ? [requested] : []));
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  useLayoutEffect(() => {
    const at = catalog.questions.findIndex((question) => question.id === requested);
    if (at >= 0) focusClear(buttons.current[at]);
  }, [requested]);

  const toggle = (id: string) => setOpen((ids) => (ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id]));

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, at: number) => {
    const last = catalog.questions.length - 1;
    const target = { ArrowDown: at === last ? 0 : at + 1, ArrowUp: at === 0 ? last : at - 1, Home: 0, End: last }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    focusClear(buttons.current[target]);
  };

  return (
    <section className="page" data-section="faq">
      <h1 tabIndex={-1}>Questions and answers</h1>
      <div className="accordion">
        {catalog.questions.map((question, at) => (
          <div key={question.id} className="accordion-item">
            <h2>
              <button
                ref={(element) => { buttons.current[at] = element; }}
                type="button"
                id={`question-${question.id}`}
                aria-expanded={open.includes(question.id)}
                aria-controls={`answer-${question.id}`}
                onClick={() => toggle(question.id)}
                onKeyDown={(event) => onKeyDown(event, at)}
              >
                {question.question}
              </button>
            </h2>
            <div id={`answer-${question.id}`} role="region" aria-labelledby={`question-${question.id}`} hidden={!open.includes(question.id)} className="answer">
              {question.answer.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
