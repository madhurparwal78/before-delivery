import { useRef } from 'react';
import { partyLabel } from '../lib/format';

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8];

export function PartySizes({
  party,
  onChoose,
}: {
  party: number;
  onChoose: (size: number) => void;
}): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const step = (from: number, delta: number): void => {
    const index = (from - 1 + delta + PARTY_SIZES.length) % PARTY_SIZES.length;
    const size = PARTY_SIZES[index] as number;
    refs.current[index]?.focus();
    onChoose(size);
  };

  return (
    <div role="radiogroup" aria-label="Party size" className="party-sizes">
      {PARTY_SIZES.map((size, index) => (
        <button
          key={size}
          type="button"
          role="radio"
          aria-checked={size === party}
          tabIndex={size === party ? 0 : -1}
          ref={(node) => {
            refs.current[index] = node;
          }}
          className={`party-size${size === party ? ' party-size--on' : ''}`}
          onClick={() => onChoose(size)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              step(size, 1);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              step(size, -1);
            } else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onChoose(size);
            }
          }}
        >
          {partyLabel(size)}
        </button>
      ))}
    </div>
  );
}
