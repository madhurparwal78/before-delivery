import { useId, useState, type KeyboardEvent } from "react";
import { priceLabel, type MarketKind } from "../../shared/rules";
import { COPY } from "../copy";
import type { RingLevel } from "../orbit/scene";

interface BookLevelsProps {
  kind: MarketKind;
  levels: RingLevel[];
  selected: string | null;
  onActive: (key: string | null) => void;
  onSelect: (level: RingLevel) => void;
}

/**
 * One Tab stop, a ladder from the highest ask down to the best ask, then the best bid down.
 * Up/Down move, Home/End jump, Enter/Space or a click selects.
 */
export function BookLevels({ kind, levels, selected, onActive, onSelect }: BookLevelsProps) {
  const id = useId();
  const options = [
    ...levels.filter((l) => l.side === "ask").sort((a, b) => b.price - a.price),
    ...levels.filter((l) => l.side === "bid").sort((a, b) => b.price - a.price),
  ];
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(1, ...options.map((o) => o.quantity));
  const activeKey = active && options.some((o) => o.key === active) ? active : null;

  const move = (key: string | null) => {
    setActive(key);
    onActive(key);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (options.length === 0) return;
    const index = options.findIndex((o) => o.key === activeKey);
    const go = (i: number) => {
      event.preventDefault();
      move((options[Math.max(0, Math.min(options.length - 1, i))] as RingLevel).key);
    };
    if (event.key === "ArrowDown") go(index + 1);
    else if (event.key === "ArrowUp") go(index < 0 ? 0 : index - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(options.length - 1);
    else if ((event.key === "Enter" || event.key === " ") && index >= 0) {
      event.preventDefault();
      onSelect(options[index] as RingLevel);
    }
  };

  if (options.length === 0) {
    return (
      <div className="levels-empty">
        <div role="listbox" aria-label="Book levels" tabIndex={0} className="levels" />
        <p className="empty-line small">{COPY.emptyBook}</p>
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Book levels"
      tabIndex={0}
      className="levels"
      aria-activedescendant={activeKey ? `${id}-${activeKey}` : undefined}
      onKeyDown={onKeyDown}
      onFocus={() => move(activeKey ?? selected ?? (options[0] as RingLevel).key)}
      onBlur={() => move(null)}
    >
      {options.map((option) => {
        const label = `${option.side === "ask" ? "Ask" : "Bid"} ${priceLabel(kind, option.price)}, ${option.quantity} resting`;
        return (
          <div
            key={option.key}
            id={`${id}-${option.key}`}
            role="option"
            aria-selected={option.key === selected}
            aria-label={label}
            className={`level level-${option.side}${option.key === activeKey ? " is-active" : ""}`}
            onClick={() => onSelect(option)}
          >
            <span className="level-bar" style={{ width: `${(100 * option.quantity) / max}%` }} />
            <span className="level-side">{option.side === "ask" ? "Ask" : "Bid"}</span>
            <span className="level-price numeric">{priceLabel(kind, option.price)}</span>
            <span className="level-qty numeric">{option.quantity.toLocaleString("en-US")}</span>
          </div>
        );
      })}
    </div>
  );
}
