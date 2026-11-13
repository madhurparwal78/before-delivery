import { useEffect, useRef, useState } from 'react';
import { copy } from '../../shared/copy';
import {
  BandIcon,
  CALLOUT_SHELL_PATHS,
  DraftingDemo,
  EditorWindowPreview,
  GraphiteSlabBackdrop,
  GripConstellation,
  HERO_SHELL_GRIPS,
  HERO_SHELL_PATHS,
  SheetGlyph,
  ThreeDevicePreview,
  WireArt,
} from '../art';
import { AppLink, useReducedMotion, Wordmark } from '../shell';

const BAND_BODY: Record<string, string[]> = {
  'Command line first': [
    'Type L, PL, O or TR and the stroke lands on the exact coordinate you entered.',
    'Aliases, object snaps and typed polar points, all from the keyboard.',
  ],
  "Markup that can't move a wall": [
    'Reviewers draw revision clouds and comments on a trace overlay.',
    'The base geometry and its version never change.',
  ],
  'The same sheet everywhere': [
    'Issue A3 PDF and DXF sheets with the title block revision in force.',
    'Every stored sheet keeps its bytes, long after the next revision lands.',
  ],
};

function StickyAccountHeader(props: { shown: boolean }): JSX.Element {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const previous = useRef(props.shown);

  useEffect(() => {
    const node = ref.current;
    if (node === null || previous.current === props.shown) return;
    previous.current = props.shown;
    if (reduced) return;
    const keyframes: Keyframe[] = props.shown
      ? [
          { opacity: 0, transform: 'translateY(-8px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ]
      : [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(-8px)' },
        ];
    node.animate(keyframes, {
      duration: props.shown ? 200 : 150,
      easing: props.shown ? 'cubic-bezier(0.2, 0.9, 0.1, 1)' : 'cubic-bezier(0.6, 0, 1, 0.4)',
      fill: 'both',
    });
  }, [props.shown, reduced]);

  return (
    <header
      ref={ref}
      className="sticky-header"
      hidden={!props.shown}
      {...(props.shown ? {} : { inert: '' })}
    >
      <span role="img" aria-label="Corbel Works">
        <Wordmark compact />
      </span>
      <div className="sticky-header-actions">
        <AppLink to="/signup" className="btn btn-outline btn-small">
          Create account
        </AppLink>
        <AppLink to="/signin" className="btn btn-small">
          Sign in
        </AppLink>
      </div>
    </header>
  );
}

export function LandingPage(): JSX.Element {
  const [headerShown, setHeaderShown] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = actionsRef.current;
    if (node === null) return;
    const onScroll = (): void => {
      const box = node.getBoundingClientRect();
      setHeaderShown(box.bottom <= 0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div className="landing">
      <StickyAccountHeader shown={headerShown} />

      <section className="landing-section hero">
        <div className="landing-art">
          <WireArt viewBox="0 0 1280 800" paths={HERO_SHELL_PATHS} grips={HERO_SHELL_GRIPS} animate />
        </div>
        <div className="landing-container">
          <div className="hero-grid">
            <div>
              <Wordmark />
              <h1>
                {copy.landing.headingLineOne}
                <br />
                {copy.landing.headingLineTwo}
              </h1>
              <p className="hero-subhead">{copy.landing.subhead}</p>
              <div className="hero-actions" ref={actionsRef}>
                <AppLink to="/signup" className="btn">
                  Start drafting
                </AppLink>
                <AppLink to="/open" className="btn btn-outline">
                  Open a shared drawing
                </AppLink>
              </div>
              <p className="hero-fine">
                {copy.landing.finePrint} <AppLink to="/signin">Sign in</AppLink>
              </p>
            </div>
            <ThreeDevicePreview />
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-container">
          <div className="band" role="region" aria-label="Drafting capability band">
            {copy.landing.bandTitles.map((title, index) => (
              <div className="band-column" key={title}>
                <BandIcon kind={index === 0 ? 'command' : index === 1 ? 'markup' : 'sheet'} />
                <div>
                  <h3>{title}</h3>
                  {(BAND_BODY[title] ?? []).map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-art" style={{ width: '22vw', right: 'auto' }}>
          <GripConstellation seed={5} />
        </div>
        <div className="landing-container">
          <div className="split" role="region" aria-label="Drafting demo">
            <DraftingDemo />
            <div>
              <h2>{copy.landing.demoHeading}</h2>
              <p>
                Pick a point with an object snap, or type it as absolute, relative or polar. The server
                computes every length, angle and area once.
              </p>
              <p>Offset a wall, trim the tail, and the API holds the exact outline you drew.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <GraphiteSlabBackdrop />
        <div className="landing-art" style={{ width: '18vw', height: '18vw', inset: 'auto auto 60% 2vw' }}>
          <GripConstellation seed={13} />
        </div>
        <div className="landing-container">
          <div className="split">
            <div>
              <h2>{copy.landing.previewHeading}</h2>
              <p>
                Layers, blocks, multiline text, dimensions, layouts and exports. Thirty commands with their
                classic aliases, a live command history and a version-checked save on every edit.
              </p>
              <p>Open the same drawing on a laptop and a phone and watch both stay in step.</p>
            </div>
            <div className="split-media">
              <EditorWindowPreview />
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-art">
          <WireArt viewBox="0 0 1440 900" paths={CALLOUT_SHELL_PATHS} />
        </div>
        <div className="landing-container">
          <div className="callout" role="region" aria-label="Sheet sets">
            <SheetGlyph />
            <h2>{copy.landing.sheetHeading}</h2>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="landing-art" style={{ left: '55%', width: '45%' }}>
          <GripConstellation seed={23} />
        </div>
        <div className="footer-grid">
          <div className="footer-links">
            <AppLink to="/signin">Command reference</AppLink>
            <AppLink to="/open">Open a shared drawing</AppLink>
            <p className="footer-copy">{copy.landing.copyright}</p>
          </div>
          <div />
        </div>
      </footer>
    </div>
  );
}
