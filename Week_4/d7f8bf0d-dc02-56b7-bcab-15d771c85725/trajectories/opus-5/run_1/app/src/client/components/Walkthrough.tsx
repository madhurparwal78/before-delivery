import { useEffect, useRef, useState } from 'react';
import { WALKTHROUGH_STEPS } from '../lib/copy.js';
import { useStore } from '../store.js';
import { PointerArt, TouchArt } from './Art.js';

export function Walkthrough(): JSX.Element {
  const { actions } = useStore();
  const [step, setStep] = useState(0);
  const [coarse] = useState(() => window.matchMedia('(any-pointer: coarse)').matches);
  const card = useRef<HTMLDivElement | null>(null);
  const skip = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    skip.current?.focus();
  }, []);

  const finish = (): void => {
    void actions.finishWalkthrough();
  };

  const current = WALKTHROUGH_STEPS[step];
  const last = step === WALKTHROUGH_STEPS.length - 1;

  return (
    <div className="modal-centre">
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label="First layout walkthrough"
        data-testid="walkthrough-card"
        className="walkthrough-card"
        onKeyDown={(event) => {
          if (event.key !== 'Tab' || !card.current) return;
          const focusable = [...card.current.querySelectorAll<HTMLElement>('button')];
          const index = focusable.indexOf(document.activeElement as HTMLElement);
          const next = event.shiftKey ? index - 1 : index + 1;
          if (next < 0 || next >= focusable.length) {
            event.preventDefault();
            focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus();
          }
        }}
      >
        <button ref={skip} className="walkthrough-skip" onClick={finish}>
          Skip
        </button>
        {coarse ? <TouchArt /> : <PointerArt />}
        <div className="walkthrough-step" key={step}>
          <h2 data-testid="walkthrough-title">{current.title}</h2>
          <p>{current.line}</p>
        </div>
        <button
          className="lipped"
          onClick={() => (last ? finish() : setStep((value) => value + 1))}
        >
          {last ? 'Start building' : 'Next'}
        </button>
        <div
          className="walkthrough-dots"
          role="group"
          aria-label={`Step ${step + 1} of ${WALKTHROUGH_STEPS.length}`}
        >
          {WALKTHROUGH_STEPS.map((entry, index) => (
            <span
              key={entry.title}
              className={index === step ? 'walkthrough-dot active' : 'walkthrough-dot'}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
