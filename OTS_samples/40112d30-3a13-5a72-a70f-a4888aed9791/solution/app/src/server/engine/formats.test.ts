import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  averageText, compareDecimalText, isExactDecimal, numberText, percentText, roundHalfAway, shortDate, validRealDate,
} from './index.ts';

test('number text drops trailing zeros, exponents and a negative zero', () => {
  const cases: [string, string][] = [
    ['3.50', '3.5'], ['-0.0', '0'], ['100', '100'], ['-0.25', '-0.25'], ['007.10', '7.1'], [' 12 ', '12'],
    ['0.000', '0'], ['1000000000000000000000.5', '1000000000000000000000.5'], ['abc', 'abc'], ['1e5', '1e5'],
  ];
  for (const [text, expected] of cases) assert.equal(numberText(text), expected);
});

test('exact decimals are written with digits, an optional minus and an optional fraction', () => {
  for (const text of ['0', '-3', '3.50', ' 4.2 ', '007']) assert.equal(isExactDecimal(text), true, text);
  for (const text of ['', '3.', '.5', '+3', '1e5', '1,5', '--1', '1 2', '3.5\n4']) assert.equal(isExactDecimal(text), false, text);
});

test('decimals compare exactly', () => {
  assert.equal(compareDecimalText('0.1', '0.10'), 0);
  assert.equal(compareDecimalText('-1', '0'), -1);
  assert.equal(compareDecimalText('100.0000000000000000000001', '100'), 1);
  assert.equal(compareDecimalText('99.9', '100'), -1);
});

test('percent text has one decimal, half away from zero', () => {
  const cases: [number, number, string][] = [
    [1, 3, '33.3%'], [2, 3, '66.7%'], [1, 8, '12.5%'], [1, 6, '16.7%'], [0, 0, '0.0%'], [5, 5, '100.0%'],
    [1, 16, '6.3%'], [3, 16, '18.8%'], [0, 4, '0.0%'],
  ];
  for (const [count, of, expected] of cases) assert.equal(percentText(count, of), expected);
});

test('average text is the exact mean, half away from zero, at fixed places', () => {
  assert.equal(averageText(['4', '5', '4'], 2), '4.33');
  assert.equal(averageText(['1', '2'], 2), '1.50');
  assert.equal(averageText(['3', '4', '4', '5', '5', '5'], 2), '4.33');
  assert.equal(averageText(['2.5', '3.125'], 2), '2.81');
  assert.equal(averageText(['-1', '-2'], 2), '-1.50');
  assert.equal(averageText(['-1', '-1', '-2'], 1), '-1.3');
  assert.equal(averageText(['7'], 0), '7');
});

test('rounding is half away from zero with fixed places', () => {
  const cases: [string, number, string][] = [
    ['2.675', 2, '2.68'], ['-2.675', 2, '-2.68'], ['2.5', 0, '3'], ['-2.5', 0, '-3'], ['0.125', 2, '0.13'],
    ['19.999', 2, '20.00'], ['1', 2, '1.00'], ['-0.001', 2, '0.00'], ['0.5', 0, '1'],
  ];
  for (const [text, places, expected] of cases) assert.equal(roundHalfAway(text, places), expected);
});

test('short dates and real calendar days', () => {
  assert.equal(shortDate('2026-03-14'), '14 Mar 2026');
  assert.equal(shortDate('2026-04-03'), '3 Apr 2026');
  assert.equal(shortDate('2024-02-29'), '29 Feb 2024');
  assert.equal(shortDate('not a date'), 'not a date');
  for (const text of ['2026-03-14', '2024-02-29', '0001-01-01', '9999-12-31']) assert.equal(validRealDate(text), true, text);
  for (const text of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-3-4', '26-03-14', ' 2026-03-14', '2026-03-14T00:00', '']) {
    assert.equal(validRealDate(text), false, text);
  }
});
