import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Renders text so that each character that changes rolls to its new value.
 * Digits that fall roll back down the same way. Under reduced motion the
 * stylesheet drops the animation and the digits change in place.
 */
export function RollingText({ text }: { text: string }): ReactNode {
  const previous = useRef(text);
  const before = [...previous.current];
  const now = [...text];

  useEffect(() => {
    previous.current = text;
  });

  return (
    <>
      {now.map((character, index) => {
        const was = before[index];
        const changed = was !== undefined && was !== character;
        const falling =
          changed && /\d/.test(character) && /\d/.test(was) && character < was;
        return (
          <span
            key={`${index}-${character}`}
            className={changed ? `digit ${falling ? 'roll-down' : 'roll-up'}` : 'digit'}
          >
            {character}
          </span>
        );
      })}
    </>
  );
}
