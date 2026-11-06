import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Link } from '../router.js';
import { SceneModel, SceneView, StillStack, STORY_CAPTIONS, useReducedMotion } from '../scene/index.js';

const SNAP = 0.004;

/** The teardown story: the moped is pinned while its six stages play, and progress is a pure function of scroll. */
export function Story(): ReactNode {
  const reduced = useReducedMotion();
  const model = useMemo(() => new SceneModel({ reducedMotion: reduced, units: 'metric' }), []);
  const region = useRef<HTMLElement>(null);
  const [stage, setStage] = useState(1);

  useEffect(() => { document.title = 'Story · Ommezwaai Feeler'; }, []);
  useEffect(() => { model.setReducedMotion(reduced); }, [model, reduced]);

  useEffect(() => {
    const node = region.current;
    if (reduced || !node) {
      model.setStoryProgress(null);
      return undefined;
    }
    let last = -1;
    const update = (): void => {
      const rect = node.getBoundingClientRect();
      const span = Math.max(1, rect.height - window.innerHeight);
      let p = Math.min(1, Math.max(0, -rect.top / span));
      if (p < SNAP) p = 0;
      else if (p > 1 - SNAP) p = 1;
      if (p === last) return;
      last = p;
      node.setAttribute('data-story-progress', p.toFixed(3));
      const current = p >= 1 ? 6 : Math.floor(p * 6) + 1;
      node.setAttribute('data-story-stage', String(current));
      model.setStoryProgress(p);
      flushSync(() => setStage(current));
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      node.removeAttribute('data-story-progress');
      node.removeAttribute('data-story-stage');
      model.setStoryProgress(null);
    };
  }, [model, reduced]);

  const intro = (
    <header className="story-intro">
      <h1>Prove it fits before you pay.</h1>
      <p>A bolt-in retrofit kit has to pass through your own frame. Scroll to take a step-through scooter apart.</p>
    </header>
  );
  return (
    <div className="page story-page">
      {reduced ? (
        <>
          {intro}
          <section className="story-stack" aria-label="Teardown story">
            <StillStack />
          </section>
        </>
      ) : (
        <section className="story" aria-label="Teardown story" ref={region}>
          <div className="story-pin">
            {intro}
            <SceneView model={model} mode="story" />
            <p className="story-caption"><span className="num">{stage}/6</span> {STORY_CAPTIONS[stage - 1]}</p>
          </div>
        </section>
      )}
      <section className="story-outro">
        <h2>Now try it on your own scooter.</h2>
        <p>Enter a plate and the shop reads the registry, then you drive the pack and hub along their rails until they seat or touch.</p>
        <p><Link to="/configure" className="btn primary">Prove a fit</Link></p>
        <h3>What the sheet proves</h3>
        <div className="sheet-notes">
          <section>
            <h4>On the rails</h4>
            <p>Each station is checked in stored tenths of a millimetre, on the frame revision your first-admission year selects.</p>
            <h5>Clearance</h5>
            <p>The smaller of the width and height gaps is the gap, and the minimum is 3.0 mm.</p>
          </section>
          <section>
            <h4>Against the limits</h4>
            <p>A build must also keep its road class, its registered mass and its overall dimensions.</p>
            <h5>Axle split</h5>
            <p>The front axle share may move by up to 10.0 points from the donor&apos;s.</p>
          </section>
        </div>
      </section>
    </div>
  );
}
