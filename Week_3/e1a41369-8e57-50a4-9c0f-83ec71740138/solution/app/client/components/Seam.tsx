import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { STRIKE_CHIP } from "../actions";
import { strikeInFlight } from "../live";
import { MINUS } from "../../shared/api";
import { reducedMotion, tenths } from "../format";

const EASE = "cubic-bezier(.2,.8,.2,1)";
const CHIP_MS = 330;
const DROP_MS = 420;
const COUNT_MS = 540;
const TURN_MS = 480;

/** How each fixture boss's name breaks over two lines, so the letters fill the panel from edge to edge. */
const NAME_LINES: Record<string, [string, string]> = {
  Drowsewyrm: ["Drowse", "wyrm"],
  Clutterhound: ["Clutter", "hound"],
  "Gloamtide Moth": ["Gloamtide", "Moth"],
};

/** The boss name set across the whole panel, stretched to the panel's width and height. */
function BossName({ boss }: { boss: string }) {
  return (
    <svg className="seam-name" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true">
      {NAME_LINES[boss]!.map((line, index) => (
        <text key={line} x="0" y={index === 0 ? 146 : 296} fontSize="210" textLength="1000" lengthAdjust="spacingAndGlyphs">{line}</text>
      ))}
    </svg>
  );
}

interface Props {
  boss: string;
  health: number;
  max: number;
  label: string;
  /** Who landed the last blow, when the boss has fallen. */
  defeatedBy: string | null;
}

/** The Health Seam: blush remaining health below, aubergine damage above, the boss name cut through by the seam. */
export function Seam({ boss, health, max, label, defeatedBy }: Props) {
  const share = health / max;
  const remaining = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const defeat = useRef<HTMLDivElement>(null);
  const before = useRef({ health, defeated: defeatedBy !== null });
  const [shown, setShown] = useState(health);

  useLayoutEffect(() => {
    const previous = before.current;
    before.current = { health, defeated: defeatedBy !== null };
    if (reducedMotion()) {
      setShown(health);
      return;
    }
    const delay = strikeInFlight() ? CHIP_MS : 0;
    if (health >= previous.health) {
      setShown(health);
    } else {
      const from = (previous.health / max) * 100;
      remaining.current!.animate([{ height: `${from}%` }, { height: `${share * 100}%` }], { duration: DROP_MS, delay, easing: EASE, fill: "backwards" });
      const started = performance.now() + delay;
      const frame = (now: number): void => {
        const progress = Math.max(0, Math.min(1, (now - started) / COUNT_MS));
        setShown(previous.health - Math.round((previous.health - health) * 10 * progress) / 10);
        if (progress < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }
    if (defeatedBy !== null && !previous.defeated) {
      defeat.current?.animate([{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0 0)" }], { duration: TURN_MS, delay: delay + DROP_MS, easing: EASE, fill: "backwards" });
    }
  }, [health, max, share, defeatedBy]);

  useEffect(() => {
    const fly = (event: Event): void => {
      const { from, amount } = (event as CustomEvent<{ from: DOMRect; amount: number }>).detail;
      if (reducedMotion() || !panel.current) return;
      const to = panel.current.getBoundingClientRect();
      const chip = document.createElement("span");
      chip.className = "strike-chip";
      chip.textContent = `${MINUS}${tenths(amount)}`;
      chip.style.left = `${from.left + 16}px`;
      chip.style.top = `${from.top + from.height / 2 - 18}px`;
      document.body.append(chip);
      const dx = to.left + to.width / 2 - (from.left + 16);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2 - 18);
      const flight = chip.animate(
        [{ transform: "translate(0, 0)", opacity: 1 }, { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 }],
        { duration: CHIP_MS, easing: EASE, fill: "forwards" },
      );
      void flight.finished.then(() => chip.remove());
    };
    document.addEventListener(STRIKE_CHIP, fly);
    return () => document.removeEventListener(STRIKE_CHIP, fly);
  }, []);

  return (
    <>
      <div className="seam" data-seam="panel" ref={panel} data-state={defeatedBy === null ? "standing" : "defeated"}>
        <div className="seam-above">
          <BossName boss={boss} />
        </div>
        <div className="seam-remaining" data-seam="remaining" ref={remaining} style={{ height: `${share * 100}%` }}>
          <BossName boss={boss} />
        </div>
        {defeatedBy !== null && (
          <div className="seam-defeat" ref={defeat}>
            <svg viewBox="0 0 1000 300" preserveAspectRatio="none">
              <text x="-30" y="290" fontSize="420" textLength="1060" lengthAdjust="spacingAndGlyphs">DOWN</text>
            </svg>
            <p className="defeat-line">{`${defeatedBy} landed the last blow.`}</p>
          </div>
        )}
      </div>
      <div className="boss-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={health} aria-valuetext={`${tenths(health)} / ${tenths(max)}`}>
        <span className="numerals" aria-hidden="true">{`${tenths(shown)} / ${tenths(max)}`}</span>
      </div>
    </>
  );
}
