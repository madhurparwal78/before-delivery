import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ChevronDown } from 'lucide-react';
import type { FlavourSlug } from '../../../shared/catalogue.js';
import { FAQ_ITEMS, HOME_SCENES } from '../../../shared/copy.js';
import { Link } from '../router.js';
import { useReducedMotion } from '../state/useReducedMotion.js';
import { BotanicalBorder } from '../components/BotanicalBorder.js';
import { CanTurntable } from '../components/CanTurntable.js';

const SCENE_BACKGROUNDS = [
  'radial-gradient(120% 90% at 18% 10%, #16301f 0%, #050f0a 62%)',
  'radial-gradient(120% 90% at 82% 18%, #10303a 0%, #050f0a 60%)',
  'radial-gradient(120% 90% at 24% 82%, #2a2413 0%, #050f0a 62%)',
  'radial-gradient(130% 100% at 70% 6%, #161335 0%, #04060c 64%)',
];

function Faq(): ReactElement {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  return (
    <div className="faq">
      <h3 className="faq__heading">Questions, answered</h3>
      <ul className="faq__list">
        {FAQ_ITEMS.map((item, index) => {
          const expanded = open[index] === true;
          const panelId = `faq-panel-${index}`;
          return (
            <li key={item.question}>
              <button
                type="button"
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                aria-expanded={expanded}
                aria-controls={panelId}
                className="faq__question"
                onClick={() => setOpen((current) => ({ ...current, [index]: !expanded }))}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    buttons.current[(index + 1) % FAQ_ITEMS.length]?.focus();
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    buttons.current[(index - 1 + FAQ_ITEMS.length) % FAQ_ITEMS.length]?.focus();
                  }
                }}
              >
                <span>{item.question}</span>
                <ChevronDown aria-hidden="true" size={18} data-open={expanded} />
              </button>
              <section
                id={panelId}
                aria-label={item.question}
                className="faq__answer"
                hidden={!expanded}
              >
                <p>{item.answer}</p>
              </section>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Home(): ReactElement {
  const reduced = useReducedMotion();
  const [activeScene, setActiveScene] = useState(0);
  const [scrollDegrees, setScrollDegrees] = useState(0);
  const [entered, setEntered] = useState<Record<number, boolean>>({ 0: true });
  const sceneRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.scene);
          if (entry.intersectionRatio >= 0.33) {
            setEntered((current) => ({ ...current, [index]: true }));
          } else if (entry.intersectionRatio < 0.15) {
            setEntered((current) => ({ ...current, [index]: false }));
          }
        }
      },
      { threshold: [0, 0.15, 0.33, 0.6] },
    );
    for (const scene of sceneRefs.current) if (scene !== null) observer.observe(scene);
    return () => observer.disconnect();
  }, []);

  /** Scroll turns the can a quarter turn per scene, and back when scrolled back. */
  useEffect(() => {
    const onScroll = () => {
      const height = window.innerHeight || 1;
      const progress = window.scrollY / height;
      setScrollDegrees(progress * 90);
      const middleIndex = Math.min(
        HOME_SCENES.length - 1,
        Math.max(0, Math.round((window.scrollY + height / 2) / height - 0.5)),
      );
      setActiveScene(middleIndex);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scene = HOME_SCENES[activeScene]!;

  return (
    <div className="home">
      <div className="home__can" aria-hidden={false}>
        <CanTurntable
          flavour={scene.flavour as FlavourSlug}
          scrollDegrees={reduced ? 0 : scrollDegrees}
          label={scene.name}
        />
      </div>

      {HOME_SCENES.map((item, index) => (
        <section
          key={item.id}
          aria-label={item.name}
          data-scene={index}
          ref={(element) => {
            sceneRefs.current[index] = element;
          }}
          className="scene"
          style={{
            background: SCENE_BACKGROUNDS[index],
            transition: reduced ? 'none' : 'background 1s ease',
          }}
        >
          <div
            className="scene__message"
            data-entered={reduced ? true : entered[index] === true}
          >
            <p className="scene__eyebrow mono">
              Scene {index + 1} of {HOME_SCENES.length} &middot; {item.name}
            </p>
            <h2>{item.heading}</h2>
            <p className="scene__copy">{item.message}</p>
            {item.id === 'orchard' ? (
              <Link to="/box" className="button button--primary scene__cta">
                Build your crate
              </Link>
            ) : null}
            {item.id === 'night-sky' ? <Faq /> : null}
          </div>
          {index < HOME_SCENES.length - 1 ? (
            <BotanicalBorder seed={index + 1} flip={index % 2 === 1} />
          ) : null}
        </section>
      ))}
    </div>
  );
}
