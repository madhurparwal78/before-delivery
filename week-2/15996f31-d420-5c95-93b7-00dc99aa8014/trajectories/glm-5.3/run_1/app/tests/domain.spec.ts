/**
 * Unit checks for the domain rules that have published worked examples: the
 * largest-remainder settlement allocation, block strength rounding, the
 * Pacific delivery date and the people-facing formats.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { allocateSettlement, averageFramesTenths, payPerHiveCents, splitPayoutAcrossDrops, tierForAverage, type RuleSet } from "../src/server/domain/model.ts";
import { formatDateText, formatDateTimeText, formatMoney, isValidDate, pacificDateParts } from "../src/server/domain/dates.ts";

const RULES_2027: RuleSet = {
  id: "rs_2027",
  name: "2027 season",
  effective_from: "2026-11-01",
  threshold_reduced: 60,
  threshold_standard: 80,
  threshold_bonus: 100,
  price_none_cents: 0,
  price_reduced_cents: 14875,
  price_standard_cents: 21450,
  price_bonus_cents: 23995,
  commission_bps: 1175,
  deposit_per_hive_cents: 6000,
};

test("the brief's worked allocation example splits exactly", () => {
  // Ridgeback: 40 Standard + 10 Bonus hives; Prairie: 40 Bonus hives.
  const ridgeback = { beekeeperId: "bk_ridge", hives: 50, grossCents: 40 * 21450 + 10 * 23995 };
  const prairie = { beekeeperId: "bk_prairie", hives: 40, grossCents: 40 * 23995 };
  const payable = ridgeback.grossCents + prairie.grossCents;
  assert.equal(formatMoney(payable), "$20,577.50");
  const allocation = allocateSettlement(payable, RULES_2027.commission_bps, [ridgeback, prairie]);
  assert.equal(formatMoney(allocation.commissionCents), "$2,417.86");
  const ridgebackShare = allocation.shares.find((share) => share.beekeeperId === "bk_ridge");
  const prairieShare = allocation.shares.find((share) => share.beekeeperId === "bk_prairie");
  assert.equal(formatMoney(ridgebackShare?.payoutCents ?? 0), "$9,689.41");
  assert.equal(formatMoney(prairieShare?.payoutCents ?? 0), "$8,470.23");
  const total = allocation.commissionCents
    + allocation.shares.reduce((sum, share) => sum + share.payoutCents, 0);
  assert.equal(total, payable, "shares plus commission always equal P");
});

test("ties favour beekeepers in ascending id before the broker", () => {
  const allocation = allocateSettlement(1001, 3000, [
    { beekeeperId: "bk_b", hives: 1, grossCents: 500.5 },
    { beekeeperId: "bk_a", hives: 1, grossCents: 500.5 },
  ]);
  // Exact: broker 300.3, each beekeeper 350.35. The single leftover cent goes
  // to the tied largest remainders in ascending beekeeper id, before the broker.
  assert.equal(allocation.commissionCents, 300);
  const payouts = allocation.shares.map((share) => share.payoutCents);
  assert.equal(payouts[0], 351, "the lowest beekeeper id takes the leftover cent");
  assert.equal(payouts[1], 350);
  assert.equal(payouts[0]! + payouts[1]! + allocation.commissionCents, 1001);
});

test("averages round half up to one decimal and cross the tier edges", () => {
  assert.equal(averageFramesTenths([90, 125]), 108);
  assert.equal(averageFramesTenths([85, 90]), 88);
  assert.equal(averageFramesTenths([]), null);
  assert.equal(tierForAverage(59, RULES_2027), "none");
  assert.equal(tierForAverage(60, RULES_2027), "reduced");
  assert.equal(tierForAverage(79, RULES_2027), "reduced");
  assert.equal(tierForAverage(80, RULES_2027), "standard");
  assert.equal(tierForAverage(100, RULES_2027), "bonus");
});

test("beekeeper pay per hive is the tier price net of commission, half up", () => {
  assert.equal(payPerHiveCents("standard", RULES_2027), 18930);
  assert.equal(payPerHiveCents("bonus", RULES_2027), 21176);
});

test("a payout splits across drops in proportion to gross, leftovers to the lowest id", () => {
  const split = splitPayoutAcrossDrops(1001, [
    { id: "drp_b", grossCents: 250 },
    { id: "drp_a", grossCents: 250 },
  ]);
  assert.equal(split.get("drp_a"), 501);
  assert.equal(split.get("drp_b"), 500);
  const single = splitPayoutAcrossDrops(777, [{ id: "drp_x", grossCents: 0 }]);
  assert.equal(single.get("drp_x"), 777);
});

test("Pacific dates and the people-facing formats", () => {
  assert.equal(formatDateText("2027-02-05"), "Feb 5, 2027");
  assert.equal(formatMoney(123450), "$1,234.50");
  assert.equal(formatMoney(0), "$0.00");
  assert.equal(isValidDate("2027-02-05"), true);
  assert.equal(isValidDate("2027-2-5"), false);
  assert.equal(isValidDate("2027-02-30"), false);
  assert.equal(pacificDateParts(new Date("2027-02-05T23:30:00-08:00")), "2027-02-05");
  assert.equal(pacificDateParts(new Date("2027-02-06T07:30:00Z")), "2027-02-05");
  assert.match(formatDateTimeText(new Date("2027-02-05T23:30:00-08:00")), /^Feb 5, 2027, 11:30 PM$/);
});
