import { useEffect, useRef, useState } from 'react';
import { landingCopy } from '../../shared/copy.js';
import { compose, identity, rotationZ, type Vec3 } from '../gl/math.js';
import { Stage, type Camera, type DrawItem } from '../gl/renderer.js';
import { Toolbar, ToolbarDivider, Wordmark } from '../components/Toolbar.jsx';

const SCROLL_SPAN = 3000;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/** The progress a visitor with reduced motion sees: one still per section. */
function reducedProgress(scroll: number): number {
  if (scroll < 1000) return 0;
  if (scroll < 2000) return 1 / 3;
  if (scroll < 3000) return 2 / 3;
  return 1;
}

interface LandingState {
  camera: Camera;
  items: DrawItem[];
  toolbar: number;
}

/** The landing scene and camera are a pure function of scroll progress. */
function landingState(progress: number): LandingState {
  const first = clamp01(progress / (1 / 3));
  const second = clamp01((progress - 1 / 3) / (1 / 3));
  const third = clamp01((progress - 2 / 3) / (1 / 3));

  const angle = Math.PI / 6;
  const length = 4.2;
  const run = length * Math.cos(angle);
  const rise = length * Math.sin(angle);
  const cart: Vec3 = [mix(run, 0.1, first), mix(rise, 0.1, first) + 0.22, 0];

  const pivot: Vec3 = [-3.4, 2.6, 0.4];
  const swing = mix(0.45, -0.45, second);
  const rod = 1.9;
  const bob: Vec3 = [
    pivot[0] + rod * Math.sin(swing),
    pivot[1] - rod * Math.cos(swing),
    pivot[2],
  ];

  const target: Vec3 = [0.4, 1.2, 0];
  const camera: Camera =
    progress <= 1 / 3
      ? {
          target,
          yaw: mix(0.85, 1.5708, first),
          pitch: mix(0.52, 0.12, first),
          distance: mix(13.5, 8.5, first),
        }
      : progress <= 2 / 3
        ? { target, yaw: mix(1.5708, 3.1416, second), pitch: 0.12, distance: 8.5 }
        : {
            target,
            yaw: mix(3.1416, 2.45, third),
            pitch: mix(0.12, 0.95, third),
            distance: mix(8.5, 16, third),
          };

  const items: DrawItem[] = [
    { mesh: 'wedge', model: compose([0, 0, 0], identity(), [run, rise, 1.4]), colour: [0.58, 0.44, 0.3] },
    {
      mesh: 'capsule',
      model: compose(cart, rotationZ(-angle), [0.62, 0.36, 0.36]),
      colour: [0.92, 0.56, 0.4],
    },
    {
      mesh: 'cylinder',
      model: compose([cart[0], cart[1] - 0.14, cart[2] + 0.2], identity(), [0.22, 0.08, 0.22]),
      colour: [0.3, 0.32, 0.4],
    },
    {
      mesh: 'cube',
      model: compose([pivot[0], pivot[1] / 2, pivot[2]], identity(), [0.08, pivot[1], 0.08]),
      colour: [0.48, 0.5, 0.62],
    },
    {
      mesh: 'cube',
      model: compose([pivot[0], pivot[1], pivot[2]], identity(), [0.8, 0.08, 0.08]),
      colour: [0.48, 0.5, 0.62],
    },
    {
      mesh: 'cylinder',
      model: compose(
        [(pivot[0] + bob[0]) / 2, (pivot[1] + bob[1]) / 2, pivot[2]],
        rotationZ(swing),
        [0.04, rod, 0.04],
      ),
      colour: [0.72, 0.74, 0.84],
    },
    {
      mesh: 'sphere',
      model: compose(bob, identity(), [0.34, 0.34, 0.34]),
      colour: [0.78, 0.72, 0.96],
    },
  ];

  return { camera, items, toolbar: clamp01((progress - 2 / 3) / (0.9 - 2 / 3)) };
}

export function Landing(): JSX.Element {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [toolbar, setToolbar] = useState(0);
  const [webgl, setWebgl] = useState(true);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stage = canvas.current ? Stage.create(canvas.current) : null;
    if (!stage) setWebgl(false);

    const draw = (): void => {
      const scroll = window.scrollY;
      const value = reduced.matches
        ? reducedProgress(scroll)
        : clamp01(scroll / SCROLL_SPAN);
      const state = landingState(value);
      setProgress(value);
      setToolbar(state.toolbar);
      stage?.render(state.items, state.camera, true);
    };

    draw();
    window.addEventListener('scroll', draw, { passive: true });
    window.addEventListener('resize', draw);
    return () => {
      window.removeEventListener('scroll', draw);
      window.removeEventListener('resize', draw);
    };
  }, []);

  const progressText = progress.toFixed(3);

  return (
    <div className="landing">
      {webgl ? (
        <canvas
          ref={canvas}
          className="landing-stage"
          role="img"
          aria-label="Bench preview"
          data-progress={progressText}
        />
      ) : (
        <div
          className="landing-stage"
          role="img"
          aria-label="Bench preview"
          data-progress={progressText}
          style={{
            background:
              'linear-gradient(#6cb8e0 0 62%, #6bbf77 62% 100%)',
          }}
        >
          <svg viewBox="0 0 400 240" width="100%" height="100%" aria-hidden="true">
            <polygon points="60,190 230,190 230,80" fill="#94744d" />
            <circle cx="200" cy="110" r="12" fill="#e8926a" />
            <line x1="310" y1="40" x2="340" y2="140" stroke="#b9bbcd" strokeWidth="4" />
            <circle cx="340" cy="150" r="14" fill="#c7b7f5" />
          </svg>
        </div>
      )}

      <h1 className="landing-name">{landingCopy.title}</h1>

      <div className="landing-toolbar" style={{ opacity: toolbar }} aria-hidden={toolbar < 0.5}>
        <Toolbar>
          <span className="chip" data-chip>
            Run
          </span>
          <span className="chip" data-chip>
            Pause
          </span>
          <span className="chip" data-chip>
            Step
          </span>
          <ToolbarDivider />
          <span className="chip" data-chip>
            Move
          </span>
          <span className="chip" data-chip>
            Snap
          </span>
          <Wordmark />
        </Toolbar>
      </div>

      <div className="landing-sections">
        <section className="landing-section">
          <div className="panel">
            <div className="panel-body">
              <p className="panel-title">The bench for physics tutors</p>
              <p>
                Build ramps, pendulums and launchers in metres, kilograms and seconds. Run them on a
                deterministic bench and publish them as labs your students open without an account.
              </p>
              <p className="row">
                <a className="chip on" href="/sign-up">
                  Start a bench
                </a>
                <a className="chip" href="/sign-in">
                  Sign in
                </a>
              </p>
            </div>
          </div>
        </section>
        {landingCopy.sections.map((heading, index) => (
          <section className="landing-section" key={heading}>
            <div className="panel">
              <div className="panel-body">
                <h2>{heading}</h2>
                <p className="muted">
                  {index === 0
                    ? 'Every field takes a unit. Type 1 lb into a mass and the bench stores 0.453592 kg.'
                    : index === 1
                      ? 'A fixed step of 1/120 second and a state hash that the server agrees with, frame rate or not.'
                      : 'Stop puts every object back where it stood, panels included, and nothing is saved.'}
                </p>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
