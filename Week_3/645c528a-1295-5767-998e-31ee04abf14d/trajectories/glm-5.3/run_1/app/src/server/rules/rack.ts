import type { Mode } from '../../shared/types.js';
import type { Ball } from './physics.js';

export function rackFor(mode: Mode): Ball[] {
  if (mode === 'nine-ball') {
    const balls: Ball[] = [{ number: 0, across: 50, along: 88 }];
    const rows = [
      [1],
      [2, 3],
      [4, 9, 5],
      [6, 7, 8],
    ];
    let along = 10;
    for (const row of rows) {
      const width = row.length;
      row.forEach((number, i) => {
        const across = 50 + (i - (width - 1) / 2) * 5.7;
        balls.push({ number, across, along });
      });
      along -= 10;
    }
    return balls;
  }
  const balls: Ball[] = [{ number: 0, across: 50, along: 88 }];
  const order = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];
  let index = 0;
  for (let row = 0; row < 5; row++) {
    const count = row + 1;
    for (let i = 0; i < count; i++) {
      const across = 50 + (i - (count - 1) / 2) * 5.7;
      const along = 10 - row * 10;
      balls.push({ number: order[index], across, along });
      index++;
    }
  }
  return balls;
}

export function tutorialBalls(step: 1 | 2 | 3): Ball[] {
  const ballNumber = step === 2 ? 9 : 1;
  return [
    { number: 0, across: 50, along: 25 },
    { number: ballNumber, across: 50, along: 88 },
  ];
}
