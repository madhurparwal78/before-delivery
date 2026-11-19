import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './apiClient';
import { PointerArt, TouchArt } from './Glyphs';

const STEPS: { title: string; instruction: string }[] = [
  { title: 'Pick an open end', instruction: 'Select the end of a module where track should continue.' },
  { title: 'Add track', instruction: 'Press a tile to add a piece to that end.' },
  { title: 'Check the standard', instruction: 'Check layout shows every rule your layout breaks.' },
  { title: 'Switch to Operate', instruction: 'Use the switch to open a session and watch the blocks.' },
  { title: 'Give the road', instruction: 'Select a train, choose a destination and press Highball.' },
];

export function WalkthroughCard({ announce }: { announce: (message: string) => void }): React.ReactElement {
  const [step, setStep] = useState(0);
  const touchPrimary = useRef(window.matchMedia('(pointer: coarse)').matches);

  const finish = useCallback(async () => {
    try {
      await api('POST', '/api/me/walkthrough', { done: true });
    } catch {
      // The card is closed locally; the flag syncs on the next sign-in.
    }
    window.localStorage.setItem('walkthrough_done', 'true');
    announce('Walkthrough finished.');
  }, [announce]);

  const onNext = useCallback(() => {
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }, []);

  const current = STEPS[step] ?? STEPS[0];
  if (!current) return <></>;

  return (
    <>
      <div className="stage-scrim" aria-hidden="true" />
      <div className="dialog-backdrop" style={{ zIndex: 85 }}>
        <div
          className="walkthrough-card"
          role="dialog"
          aria-label="First layout walkthrough"
          data-testid="walkthrough-card"
        >
          <button className="skip" onClick={finish}>Skip</button>
          {touchPrimary.current ? <TouchArt /> : <PointerArt />}
          <h2 data-testid="walkthrough-title">{current.title}</h2>
          <p>{current.instruction}</p>
          <div className="actions" style={{ justifyContent: 'center' }}>
            {step < STEPS.length - 1 ? (
              <button className="lipped" onClick={onNext}>Next</button>
            ) : (
              <button className="lipped" onClick={finish}>Start building</button>
            )}
          </div>
          <div className="step-dots" role="group" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
            {STEPS.map((_, i) => (
              <span key={i} className={i === step ? 'active' : ''} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
