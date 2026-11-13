import type { ReactElement } from 'react';
import { COPY } from './copy.ts';
import { Sprig } from './icons.tsx';
import { navigate } from './router.ts';

export function NotFound({ what }: { what: 'board' | 'card' }): ReactElement {
  return (
    <section className="not-found">
      <Sprig />
      <h1 className="not-found-title">{what === 'board' ? COPY.boardGoneTitle : COPY.cardGoneTitle}</h1>
      <p>{what === 'board' ? COPY.boardGoneBody : COPY.cardGoneBody}</p>
      <a
        href="/"
        className="back-link"
        onClick={(event) => {
          event.preventDefault();
          navigate('/');
        }}
      >
        Back to your boards
      </a>
    </section>
  );
}
