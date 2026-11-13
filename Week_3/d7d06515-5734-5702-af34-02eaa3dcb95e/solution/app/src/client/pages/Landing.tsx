// /: the landing page (brief: Landing page). A run of sections over full-bleed line art, and a sticky account header
// that hands off from the hero buttons.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CommandIcon, MarkupIcon, SheetIcon } from '../art/CapabilityIcons.tsx';
import { DevicePreview } from '../art/DevicePreview.tsx';
import { DocumentGlyph } from '../art/DocumentGlyph.tsx';
import { DraftingDemo } from '../art/DraftingDemo.tsx';
import { DrawnLines } from '../art/DrawnLines.tsx';
import { EditorPreview } from '../art/EditorPreview.tsx';
import { Lockup, Logo } from '../art/Logo.tsx';
import { CALLOUT_VIEW, HERO_VIEW, calloutShell, constellation, heroShell } from '../art/wireframes.ts';
import { Link } from '../router.tsx';
import { CommandReferenceDialog } from '../ui/CommandReference.tsx';
import { HEADER_IN_MS, HEADER_OUT_MS, reducedMotion, token } from '../ui/motion.ts';

type HeaderPhase = 'hidden' | 'shown' | 'leaving';

const SLIDE = '-8px';

/** The sticky header enters when the hero buttons' bottom edge crosses the top of the viewport and leaves when it returns. */
function useHeaderHandoff() {
  const [phase, setPhase] = useState<HeaderPhase>('hidden');
  const header = useRef<HTMLElement>(null);
  const actions = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = actions.current;
    if (!target) return;
    const check = (): void => {
      const past = target.getBoundingClientRect().bottom < 0;
      setPhase((current) => {
        if (past) return 'shown';
        if (current === 'shown') return reducedMotion() ? 'hidden' : 'leaving';
        return current;
      });
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, []);

  useEffect(() => {
    const node = header.current;
    if (!node || reducedMotion() || phase === 'hidden') return;
    const visible = { opacity: 1, transform: 'translateY(0)' };
    const away = { opacity: 0, transform: `translateY(${SLIDE})` };
    const entering = phase === 'shown';
    const animation = node.animate(entering ? [away, visible] : [visible, away], {
      duration: entering ? HEADER_IN_MS : HEADER_OUT_MS,
      easing: token(entering ? '--ease-draw' : '--ease-out-quick'),
      fill: 'both',
      iterations: 1,
    });
    if (!entering) animation.onfinish = () => setPhase((current) => (current === 'leaving' ? 'hidden' : current));
    return () => animation.cancel();
  }, [phase]);

  return { phase, header, actions };
}

const CAPABILITIES = [
  {
    title: 'Command line first',
    body: 'Type an alias, a coordinate or a handle and the sheet answers. Every prompt is spelled out, and Escape always backs out cleanly.',
    icon: <CommandIcon />,
  },
  {
    title: 'Markup that can\'t move a wall',
    body: 'Reviewers draw clouds and comments on a trace laid over the drawing. The base geometry never changes under their pen.',
    icon: <MarkupIcon />,
  },
  {
    title: 'The same sheet everywhere',
    body: 'A laptop, a tablet and a phone read one live drawing, so everyone is looking at the same revision.',
    icon: <SheetIcon />,
  },
] as const;

export function Landing() {
  const { phase, header, actions } = useHeaderHandoff();
  const [referenceOpen, setReferenceOpen] = useState(false);
  const referenceLink = useRef<HTMLAnchorElement>(null);
  const hero = useMemo(() => heroShell(), []);
  const callout = useMemo(() => calloutShell(), []);
  const demoFan = useMemo(() => constellation({ seed: 3, width: 110, height: 360, hub: [0, 180], from: -76, to: 76, nodes: 7, reach: [60, 260] }), []);
  const previewFan = useMemo(() => constellation({ seed: 8, width: 460, height: 340, hub: [0, 0], from: 8, to: 82, nodes: 7 }), []);
  const footerFan = useMemo(() => constellation({ seed: 14, width: 720, height: 260, hub: [720, 130], from: 135, to: 225, nodes: 8 }), []);

  return (
    <div className="landing">
      <header ref={header} className="site-header" data-phase={phase} inert={phase === 'hidden'}>
        <Link to="/" className="logo-link"><Logo /></Link>
        <nav className="site-header-actions">
          <Link to="/signup" className="btn btn-outline">Create account</Link>
          <Link to="/signin" className="btn btn-primary">Sign in</Link>
        </nav>
      </header>

      <main>
        <section className="hero">
          <DrawnLines
            strokes={hero}
            mode="mount"
            viewBox={`0 0 ${HERO_VIEW.width} ${HERO_VIEW.height}`}
            preserveAspectRatio="xMaxYMax slice"
            className="wireframe hero-wireframe"
          />
          <div className="container hero-grid">
            <div className="hero-copy">
              <Lockup />
              <h1>
                <span>Draw the plan.</span>
                <span>Review the live sheet.</span>
              </h1>
              <p className="hero-sub">Command-line drafting and safe client markup in one browser tab.</p>
              <div ref={actions} className="hero-actions">
                <Link to="/signup" className="btn btn-primary">Start drafting</Link>
                <Link to="/open" className="btn btn-outline">Open a shared drawing</Link>
              </div>
              <p className="fine-print">Free trial, no card needed. Already drafting with us? <Link to="/signin">Sign in</Link></p>
            </div>
            <DevicePreview />
          </div>
        </section>

        <section className="band-section">
          <div className="container">
            <section className="band" aria-label="Drafting capability band">
              {CAPABILITIES.map((capability) => (
                <div key={capability.title} className="capability">
                  {capability.icon}
                  <div className="capability-text">
                    <h2>{capability.title}</h2>
                    <p>{capability.body}</p>
                  </div>
                </div>
              ))}
            </section>
          </div>
        </section>

        <section className="demo" aria-label="Drafting demo">
          <div className="container split">
            <DrawnLines strokes={demoFan.strokes} mode="visible" viewBox={`0 0 ${demoFan.width} ${demoFan.height}`} className="constellation constellation-demo" />
            <DraftingDemo />
            <div className="split-text">
              <h2 className="demo-heading">
                <span>Every</span>{' '}
                <span>stroke lands</span>{' '}
                <span>where you</span>{' '}
                <span>typed it.</span>
              </h2>
              <p>Watch a plan outline go down line by line, then an offset and a trim close the corners. Coordinates in, exact geometry out.</p>
            </div>
          </div>
        </section>

        <section className="preview">
          <div className="slab-backdrop" aria-hidden="true">
            <span className="slab slab-a"><span className="streak" /></span>
            <span className="slab slab-b" />
            <span className="slab slab-c" />
          </div>
          <DrawnLines strokes={previewFan.strokes} mode="visible" viewBox={`0 0 ${previewFan.width} ${previewFan.height}`} className="constellation constellation-preview" />
          <div className="container split split-reverse">
            <div className="split-text">
              <h2>A full command set, in the browser you already have.</h2>
              <p>Layers, blocks, dimensions and snaps share one window: properties on the left, the command line below, and a canvas that keeps up with your hand.</p>
              <p>Nothing to install. Open a tab and draft.</p>
            </div>
            <EditorPreview />
          </div>
        </section>

        <section className="callout-section" aria-label="Sheet sets">
          <DrawnLines strokes={callout} mode="static" viewBox={`0 0 ${CALLOUT_VIEW.width} ${CALLOUT_VIEW.height}`} preserveAspectRatio="xMidYMid slice" className="wireframe callout-wireframe" />
          <div className="callout-card">
            <h2>Issue the sheet set. Keep every markup on the right revision.</h2>
            <DocumentGlyph />
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <DrawnLines strokes={footerFan.strokes} mode="visible" viewBox={`0 0 ${footerFan.width} ${footerFan.height}`} preserveAspectRatio="xMaxYMid meet" className="constellation constellation-footer" />
        <div className="container footer-grid">
          <ul className="footer-links">
            <li>
              <a
                ref={referenceLink}
                href="#command-reference"
                onClick={(event) => { event.preventDefault(); setReferenceOpen(true); }}
              >
                Command reference
              </a>
            </li>
            <li><Link to="/open">Open a shared drawing</Link></li>
          </ul>
          <p className="copyright">© 2026 Corbel Works</p>
        </div>
      </footer>

      {referenceOpen ? <CommandReferenceDialog onClose={() => setReferenceOpen(false)} returnFocus={() => referenceLink.current} /> : null}
    </div>
  );
}
