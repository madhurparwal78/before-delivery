import { Moon, Square, Sun, Sunrise, Sunset, type LucideIcon } from "lucide-react";
import { useId } from "react";
import { DIAL_MODES, type DialMode } from "../../shared/dial";
import { useDial } from "../lib/dial";
import { useSession } from "../lib/session";

const LABELS: Record<DialMode, string> = {
  auto: "Auto",
  morning: "Morning",
  day: "Day",
  evening: "Evening",
  night: "Night",
  gallery: "Gallery",
};

function AutoIcon(props: { size: number; strokeWidth: number; "aria-hidden": "true" }) {
  return (
    <svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={props.strokeWidth} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}

const ICONS: Record<DialMode, LucideIcon | typeof AutoIcon> = {
  auto: AutoIcon,
  morning: Sunrise,
  day: Sun,
  evening: Sunset,
  night: Moon,
  gallery: Square,
};

/** Fixed bottom-left: Auto and the five lighting states, as one radio group. */
export function LightingDial() {
  const { mode, light } = useDial();
  const { chooseLight } = useSession();
  const name = useId();
  return (
    <div className="dial-dock">
      <fieldset className="dial" role="radiogroup" aria-label="Lighting">
        {DIAL_MODES.map((option) => {
          const Icon = ICONS[option];
          return (
            <label key={option} className="dial__option" title={LABELS[option]}>
              <input
                type="radio"
                name={name}
                value={option}
                checked={mode === option}
                onChange={() => chooseLight(option)}
                className="dial__input"
              />
              <Icon aria-hidden="true" size={18} strokeWidth={1.5} />
              <span className="dial__label">{LABELS[option]}</span>
            </label>
          );
        })}
        <span className="dial__now" aria-hidden="true">
          {mode === "auto" && <span className="dial__auto">Auto · </span>}
          {LABELS[light]}
        </span>
      </fieldset>
    </div>
  );
}
