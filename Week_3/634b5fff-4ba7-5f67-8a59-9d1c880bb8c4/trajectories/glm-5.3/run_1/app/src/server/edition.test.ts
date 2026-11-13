import { test } from 'node:test';
import assert from 'node:assert/strict';
import { divideRound, applyBps, formatOre } from '../shared/money.js';
import { splitBox, refundParts, remainingParts, gatewayFeeOre, plateFor } from './edition.js';
import { bankingDeadline } from './pure.js';

test('rounding is half up and written once', () => {
  assert.equal(divideRound(5, 2), 3);
  assert.equal(divideRound(3, 2), 2);
  assert.equal(divideRound(1, 3), 0);
  assert.equal(divideRound(2, 3), 1);
  assert.equal(divideRound(-5, 2), -3);
});

test('the published split examples', () => {
  assert.deepEqual(splitBox(119_600, 3150), { charityOre: 37_674, makerOre: 81_926 });
  assert.deepEqual(splitBox(119_600, 3300), { charityOre: 39_468, makerOre: 80_132 });
});

test('the partial refund example', () => {
  const sale = { netOre: 119_600, vatOre: 29_900, charityOre: 37_674, makerOre: 81_926 };
  const first = refundParts(33_333, 3150, sale);
  assert.deepEqual(first, { netOre: 26_666, vatOre: 6_667, charityOre: 8_400, makerOre: 18_266 });
});

test('the final refund takes the exact remainder and totals reach zero', () => {
  const sale = { netOre: 119_600, vatOre: 29_900, charityOre: 37_674, makerOre: 81_926 };
  const first = refundParts(33_333, 3150, sale);
  const remainders = remainingParts(sale, [first]);
  assert.deepEqual(remainders, { netOre: 92_934, vatOre: 23_233, charityOre: 29_274, makerOre: 63_660 });
  const second = refundParts(116_167, 3150, remainders);
  assert.deepEqual(second, { netOre: 92_934, vatOre: 23_233, charityOre: 29_274, makerOre: 63_660 });
  assert.equal(sale.netOre - (first.netOre + second.netOre), 0);
  assert.equal(sale.vatOre - (first.vatOre + second.vatOre), 0);
  assert.equal(sale.charityOre - (first.charityOre + second.charityOre), 0);
  assert.equal(sale.makerOre - (first.makerOre + second.makerOre), 0);
});

test('gateway fees', () => {
  assert.equal(gatewayFeeOre('card'), 2_080);
  assert.equal(gatewayFeeOre('bank'), 400);
});

test('formatting kroner with a thousands comma', () => {
  assert.equal(formatOre(158_400), '1,584.00');
  assert.equal(formatOre(37_674), '376.74');
  assert.equal(formatOre(-33_333), '-333.33');
});

test('plates cycle across the five names', () => {
  assert.equal(plateFor(1), 'stove');
  assert.equal(plateFor(117), 'goose');
  assert.equal(plateFor(240), 'grandmother');
});

test('banking-day deadline skips weekends and holidays', () => {
  assert.equal(bankingDeadline(new Date('2026-12-22T10:00:00Z')).toISOString(), '2026-12-29T22:59:59.999Z');
});

test('applyBps matches half up on rates', () => {
  assert.equal(applyBps(26_666, 3150), 8_400);
  assert.equal(applyBps(1, 5000), 1);
  assert.equal(applyBps(1, 4999), 0);
});
