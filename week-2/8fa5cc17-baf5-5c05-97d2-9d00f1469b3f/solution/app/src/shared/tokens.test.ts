import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glColor, heatColor, THEMES, tokenCss } from './tokens.ts';

test('token declarations for both themes', () => {
  assert.equal(
    tokenCss('paper'),
    '--quire-paper: rgb(244, 240, 230); --quire-ink: rgb(31, 28, 24); --quire-rule: rgb(207, 198, 180); --quire-accent: rgb(178, 58, 36); --quire-link: rgb(47, 107, 106); --quire-clear: rgb(244 240 230 / 0);',
  );
  assert.ok(tokenCss('lamplight').startsWith('--quire-paper: rgb(30, 26, 21);'));
});

test('glColor divides channels by 255', () => {
  assert.deepEqual(glColor(THEMES.paper.ink), [31 / 255, 28 / 255, 24 / 255]);
});

test('heat colour runs from paper to accent over six blocks', () => {
  assert.deepEqual(heatColor('paper', 0), [244, 240, 230]);
  assert.deepEqual(heatColor('paper', 3), [211, 149, 133]);
  assert.deepEqual(heatColor('paper', 6), [178, 58, 36]);
  assert.deepEqual(heatColor('paper', 40), [178, 58, 36]);
  assert.deepEqual(heatColor('lamplight', 1), [Math.round(30 + 194 / 6), Math.round(26 + 77 / 6), Math.round(21 + 55 / 6)]);
});
