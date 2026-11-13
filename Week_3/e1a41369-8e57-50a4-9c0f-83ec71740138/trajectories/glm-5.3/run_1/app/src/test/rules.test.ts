import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyExperience,
  bandOf,
  damageTenthsFor,
  difficultyMultiplier,
  experienceFor,
  experienceToLevel,
  faintPenalty,
  goldCentsFor,
  habitDownHealthTenths,
  missedDailyHealthTenths,
  strikeBackTenths,
  fixtureByName,
  QUEST_FIXTURES,
  WEEKDAYS,
} from '../shared/rules.js';
import { parseDeedlist } from '../server/deedlist.js';

test('difficulty multiplier table', () => {
  assert.equal(difficultyMultiplier('trivial'), 0.5);
  assert.equal(difficultyMultiplier('easy'), 1);
  assert.equal(difficultyMultiplier('medium'), 1.5);
  assert.equal(difficultyMultiplier('hard'), 2);
});

test('band and factor table', () => {
  assert.deepEqual(bandOf(-20), { band: 'Crimson', factor: 2 });
  assert.deepEqual(bandOf(-10), { band: 'Crimson', factor: 2 });
  assert.deepEqual(bandOf(-9), { band: 'Amber', factor: 1.5 });
  assert.deepEqual(bandOf(-1), { band: 'Amber', factor: 1.5 });
  assert.deepEqual(bandOf(0), { band: 'Sand', factor: 1 });
  assert.deepEqual(bandOf(4), { band: 'Sand', factor: 1 });
  assert.deepEqual(bandOf(5), { band: 'Teal', factor: 0.75 });
  assert.deepEqual(bandOf(9), { band: 'Teal', factor: 0.75 });
  assert.deepEqual(bandOf(10), { band: 'Blue', factor: 0.5 });
  assert.deepEqual(bandOf(20), { band: 'Blue', factor: 0.5 });
});

test('reward formulas: medium todo at value 0 pays 15 xp, 1.50 gold, 7.5 damage', () => {
  const xp = experienceFor({ difficulty: 'medium', value: 0, checked: 0, total: 0 });
  assert.equal(xp, 15);
  assert.equal(goldCentsFor(xp), 150);
  assert.equal(damageTenthsFor(xp), 75);
});

test('checklist bonus: medium todo, 1 of 2 checked pays 19 xp', () => {
  const xp = experienceFor({ difficulty: 'medium', value: 0, checked: 1, total: 2 });
  assert.equal(xp, 19);
  assert.equal(goldCentsFor(xp), 190);
  assert.equal(damageTenthsFor(xp), 95);
});

test('habit scored down: easy at value 0 loses 2.0 health', () => {
  assert.equal(habitDownHealthTenths('easy', 0), 20);
  // medium at Amber (f=1.5): 2 × 1.5 × 1.5 = 4.5
  assert.equal(habitDownHealthTenths('medium', -4), 45);
});

test('missed daily loss uses the same formula', () => {
  assert.equal(missedDailyHealthTenths('easy', 0), 20);
});

test('strike-back: power 1.5 with 1 missed = 1.5', () => {
  assert.equal(strikeBackTenths(1.5, 1), 15);
  assert.equal(strikeBackTenths(2.0, 3), 60);
});

test('levels: thresholds, carry-over and multi-level', () => {
  assert.equal(experienceToLevel(1), 25);
  assert.equal(experienceToLevel(2), 50);
  const one = applyExperience(1, 0, 25);
  assert.deepEqual({ level: one.level, experience: one.experience, gained: one.levelsGained }, {
    level: 2,
    experience: 0,
    gained: 1,
  });
  const carry = applyExperience(1, 20, 10);
  assert.equal(carry.experience, 5);
  const multi = applyExperience(1, 0, 100); // 25 + 50 = 75 → level 3 with 25
  assert.equal(multi.level, 3);
  assert.equal(multi.experience, 25);
  assert.equal(multi.levelsGained, 2);
});

test('faint: one level down never below 1, gold loss rounded down to the cent', () => {
  assert.deepEqual(faintPenalty(2, 1000), { level: 1, goldLostCents: 100 });
  assert.deepEqual(faintPenalty(1, 0), { level: 1, goldLostCents: 0 });
  assert.deepEqual(faintPenalty(5, 999), { level: 4, goldLostCents: 99 });
});

test('quest fixtures table', () => {
  assert.equal(QUEST_FIXTURES.length, 3);
  const wake = fixtureByName('Wake the Drowsewyrm')!;
  assert.equal(wake.boss, 'Drowsewyrm');
  assert.equal(wake.maxHealth, 400.0);
  assert.equal(wake.power, 1.5);
  assert.equal(wake.rewardGold, 25.0);
  assert.equal(wake.rewardExperience, 100);
  const clutter = fixtureByName('Hush the Clutterhound')!;
  assert.equal(clutter.maxHealth, 250.0);
  assert.equal(clutter.power, 1.0);
  const moth = fixtureByName('Dim the Gloamtide Moth')!;
  assert.equal(moth.maxHealth, 600.0);
  assert.equal(moth.power, 2.0);
});

test('weekday list is in week order', () => {
  assert.deepEqual([...WEEKDAYS], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
});

// ---------------------------------------------------------------------------
// deedlist parser

test('deedlist: good file parses all four types', () => {
  const text = [
    'DEEDLIST 1',
    'habit | Morning stretch | easy',
    'daily | Evening walk | medium | Mon,Wed,Fri',
    'todo | Fix the bike | hard | Check tyres; Oil chain',
    'reward | Cinema night | 12.50',
    '# a comment',
    '',
  ].join('\n');
  const { lines, errors } = parseDeedlist(text);
  assert.equal(errors.length, 0);
  assert.equal(lines.length, 4);
  assert.equal(lines[0].type, 'habit');
  assert.deepEqual(lines[1].weekdays, ['Mon', 'Wed', 'Fri']);
  assert.deepEqual(lines[2].checklist, ['Check tyres', 'Oil chain']);
  assert.equal(lines[3].price, 1250);
});

test('deedlist: line 1 error is the only error', () => {
  const { lines, errors } = parseDeedlist('DEEDLIST 2\nbogus | x | easy\n');
  assert.equal(lines.length, 0);
  assert.deepEqual(errors, [{ line: 1, message: 'Line 1: the first line must be DEEDLIST 1' }]);
});

test('deedlist: unknown type and wrong field count are alone on their line', () => {
  const { errors } = parseDeedlist('DEEDLIST 1\nbogus | x | easy\ndaily | too few\n');
  assert.equal(errors.length, 2);
  assert.equal(errors[0].message, 'Line 2: unknown task type "bogus"');
  assert.equal(errors[1].message, 'Line 3: expected 4 fields, found 2');
});

test('deedlist: every error of a line, in order', () => {
  const { errors } = parseDeedlist('DEEDLIST 1\nreward | ok | 0\n');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'Line 2: price must be a number from 0.01 to 9999.99');
});

test('deedlist: weekday error wording', () => {
  const { errors } = parseDeedlist('DEEDLIST 1\ndaily | x | easy | Mon,Tue\n');
  assert.equal(errors.length, 0);
  const bad = parseDeedlist('DEEDLIST 1\ndaily | x | easy | Mon,Mon\n');
  assert.equal(bad.errors[0].message, 'Line 2: weekdays must be chosen from Mon, Tue, Wed, Thu, Fri, Sat, Sun');
  const bad2 = parseDeedlist('DEEDLIST 1\ndaily | x | easy | \n');
  assert.equal(bad2.errors[0].message, 'Line 2: weekdays must be chosen from Mon, Tue, Wed, Thu, Fri, Sat, Sun');
});

test('deedlist: title length and difficulty wording', () => {
  const long = 'x'.repeat(81);
  const { errors } = parseDeedlist(`DEEDLIST 1\nhabit | ${long} | nope\n`);
  assert.deepEqual(errors.map((e: { message: string }) => e.message), [
    'Line 2: title must be 1 to 80 characters',
    'Line 2: difficulty must be trivial, easy, medium or hard',
  ]);
});

test('deedlist: todo accepts 3 or 4 fields', () => {
  const three = parseDeedlist('DEEDLIST 1\ntodo | Plain | easy\n');
  assert.equal(three.errors.length, 0);
  assert.equal(three.lines[0].checklist, undefined);
  const four = parseDeedlist('DEEDLIST 1\ntodo | Plain | easy | one;two\n');
  assert.equal(four.errors.length, 0);
  assert.deepEqual(four.lines[0].checklist, ['one', 'two']);
});
