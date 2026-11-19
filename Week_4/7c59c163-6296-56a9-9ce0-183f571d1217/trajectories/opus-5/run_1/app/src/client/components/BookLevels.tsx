import { useEffect, useRef } from 'react';
import { formatInteger, formatPrice } from '../format.js';
import type { OrbitLevel } from './Orbit.js';
import type { MarketKind } from '../api.js';

export interface BookLevelsProps {
  kind: MarketKind;
  levels: OrbitLevel[];
  active: string;
  onActive: (key: string) => void;
  onChoose: (key: string) => void;
}

/** One Tab stop; Up and Down move the active option, Home and End jump to the ends. */
export function BookLevels(props: BookLevelsProps): React.JSX.Element {
  const listRef = useRef<HTMLUListElement | null>(null);
  const index = Math.max(
    props.levels.findIndex((level) => level.key === props.active),
    0,
  );

  useEffect(() => {
    const option = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    option?.scrollIntoView({ block: 'nearest' });
  }, [props.active]);

  const move = (next: number): void => {
    const level = props.levels[Math.max(0, Math.min(next, props.levels.length - 1))];
    if (level !== undefined) props.onActive(level.key);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(index + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        move(index - 1);
        return;
      case 'Home':
        event.preventDefault();
        move(0);
        return;
      case 'End':
        event.preventDefault();
        move(props.levels.length - 1);
        return;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const level = props.levels[index];
        if (level !== undefined) props.onChoose(level.key);
        return;
      }
      default:
        return;
    }
  };

  return (
    <ul
      ref={listRef}
      className="levels"
      role="listbox"
      aria-label="Book levels"
      tabIndex={0}
      aria-activedescendant={props.levels[index]?.key}
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (props.active === '' && props.levels[0] !== undefined) props.onActive(props.levels[0].key);
      }}
    >
      {props.levels.map((level) => (
        <li
          key={level.key}
          id={level.key}
          role="option"
          className={level.side === 'ask' ? 'levels__ask' : 'levels__bid'}
          aria-selected={level.key === props.active}
          onClick={() => props.onChoose(level.key)}
        >
          <span>
            {level.side === 'ask' ? 'Ask' : 'Bid'} {formatPrice(props.kind, level.price)},{' '}
            {formatInteger(level.quantity)} resting
          </span>
        </li>
      ))}
    </ul>
  );
}
