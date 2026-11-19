import React from 'react';

/**
 * The Gandyboard puffy wordmark: each letter its own colour with a darker
 * extruded lower edge, drawn for this product as an SVG.
 */

interface LetterSpec {
  ch: string;
  fill: string;
  edge: string;
  path: string;
}

const LETTERS: LetterSpec[] = [
  {
    ch: 'G',
    fill: '#ff8b21',
    edge: '#c14e00',
    path: 'M38 30 C38 12 52 4 70 4 C82 4 92 8 98 16 L98 48 C92 56 82 60 70 60 C52 60 38 52 38 34 Z M58 34 C58 42 62 46 70 46 C74 46 78 44 78 40 L78 28 C78 24 74 22 70 22 C62 22 58 26 58 34 Z',
  },
  {
    ch: 'a',
    fill: '#3fa9f5',
    edge: '#1848c2',
    path: 'M106 26 C106 12 118 4 134 4 C150 4 162 12 162 26 L162 58 L142 58 L142 54 C138 58 132 60 126 60 C114 60 106 52 106 42 C106 32 114 28 126 28 L142 30 C142 22 138 20 134 20 C130 20 128 22 126 24 Z M126 40 C126 44 128 46 132 46 C136 46 140 44 142 40 L142 38 L132 38 C128 38 126 38 126 40 Z',
  },
  {
    ch: 'n',
    fill: '#23b04b',
    edge: '#157033',
    path: 'M170 6 L190 6 L190 12 C194 7 200 4 208 4 C222 4 232 14 232 30 L232 58 L212 58 L212 32 C212 26 209 22 203 22 C198 22 194 26 190 30 L190 58 L170 58 Z',
  },
  {
    ch: 'd',
    fill: '#ffb648',
    edge: '#c98400',
    path: 'M240 4 L260 4 L260 10 C264 5 270 4 276 4 C292 4 302 16 302 32 C302 48 292 60 276 60 C270 60 264 58 260 54 L260 74 L240 74 Z M262 32 C262 42 266 46 274 46 C282 46 286 42 286 32 C286 22 282 18 274 18 C266 18 262 22 262 32 Z',
  },
  {
    ch: 'y',
    fill: '#3fa9f5',
    edge: '#1848c2',
    path: 'M310 6 L331 6 L342 30 L353 6 L374 6 L352 54 L342 74 L322 74 L332 54 Z',
  },
  {
    ch: 'b',
    fill: '#23b04b',
    edge: '#157033',
    path: 'M382 4 L402 4 L402 10 C406 5 412 4 418 4 C434 4 444 16 444 32 C444 48 434 60 418 60 C412 60 406 58 402 54 L402 74 L382 74 Z M424 32 C424 22 420 18 412 18 C406 18 402 20 402 24 L402 40 C402 44 406 46 412 46 C420 46 424 42 424 32 Z',
  },
  {
    ch: 'o',
    fill: '#ff8b21',
    edge: '#c14e00',
    path: 'M452 32 C452 14 464 4 482 4 C500 4 512 14 512 32 C512 50 500 60 482 60 C464 60 452 50 452 32 Z M472 32 C472 40 476 44 482 44 C488 44 492 40 492 32 C492 24 488 20 482 20 C476 20 472 24 472 32 Z',
  },
  {
    ch: 'a',
    fill: '#3fa9f5',
    edge: '#1848c2',
    path: 'M520 26 C520 12 532 4 548 4 C564 4 576 12 576 26 L576 58 L556 58 L556 54 C552 58 546 60 540 60 C528 60 520 52 520 42 C520 32 528 28 540 28 L556 30 C556 22 552 20 548 20 C544 20 542 22 540 24 Z M540 40 C540 44 542 46 546 46 C550 46 554 44 556 40 L556 38 L546 38 C542 38 540 38 540 40 Z',
  },
  {
    ch: 'r',
    fill: '#23b04b',
    edge: '#157033',
    path: 'M584 6 L604 6 L604 12 C608 7 614 4 620 4 L620 24 C614 24 608 26 604 30 L604 58 L584 58 Z',
  },
  {
    ch: 'd',
    fill: '#ffb648',
    edge: '#c98400',
    path: 'M628 4 L648 4 L648 10 C652 5 658 4 664 4 C680 4 690 16 690 32 C690 48 680 60 664 60 C658 60 652 58 648 54 L648 74 L628 74 Z M650 32 C650 42 654 46 662 46 C670 46 674 42 674 32 C674 22 670 18 662 18 C654 18 650 22 650 32 Z',
  },
];

/** The playful uneven baseline offsets for each letter. */
const BASELINE: number[] = [30, 26, 28, 22, 24, 26, 28, 24, 28, 22];

export function Wordmark(): React.ReactElement {
  const width = 700;
  const height = 100;
  return (
    <svg className="wordmark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Gandyboard" data-testid="splash-wordmark" width="484" height="69">
      {LETTERS.map((letter, i) => (
        <g key={i} transform={`translate(0, ${BASELINE[i] ?? 0})`}>
          <path d={letter.path} fill={letter.edge} transform="translate(0, 5)" />
          <path d={letter.path} fill={letter.fill} />
        </g>
      ))}
    </svg>
  );
}
