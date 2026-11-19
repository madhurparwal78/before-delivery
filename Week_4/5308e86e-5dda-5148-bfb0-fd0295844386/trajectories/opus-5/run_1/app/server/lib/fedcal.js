'use strict';

// The Federal Reserve business-day calendar. Defined once; every business-day
// question in the product reads these functions.

const { addDays, dayOfWeek } = require('./nytime');

const FIXED_HOLIDAYS = [
  [1, 1], // New Year's Day
  [6, 19], // Juneteenth National Independence Day
  [7, 4], // Independence Day
  [11, 11], // Veterans Day
  [12, 25], // Christmas Day
];

const FLOATING_HOLIDAYS = [
  { month: 1, weekday: 1, nth: 3 }, // Martin Luther King Jr. Day
  { month: 2, weekday: 1, nth: 3 }, // Washington's Birthday
  { month: 5, weekday: 1, nth: -1 }, // Memorial Day
  { month: 9, weekday: 1, nth: 1 }, // Labor Day
  { month: 10, weekday: 1, nth: 2 }, // Columbus Day
  { month: 11, weekday: 4, nth: 4 }, // Thanksgiving Day
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function nthWeekdayOfMonth(year, month, weekday, nth) {
  if (nth > 0) {
    const first = `${year}-${pad2(month)}-01`;
    const shift = (weekday - dayOfWeek(first) + 7) % 7;
    return addDays(first, shift + (nth - 1) * 7);
  }
  const firstOfNext = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;
  const last = addDays(firstOfNext, -1);
  const back = (dayOfWeek(last) - weekday + 7) % 7;
  return addDays(last, -back);
}

const cache = new Map();

function observedHolidays(year) {
  if (cache.has(year)) return cache.get(year);
  const set = new Set();
  for (const [month, day] of FIXED_HOLIDAYS) {
    const date = `${year}-${pad2(month)}-${pad2(day)}`;
    const weekday = dayOfWeek(date);
    // A fixed-date holiday on a Sunday is observed the following Monday; one on
    // a Saturday is not observed on any other day.
    if (weekday === 0) set.add(addDays(date, 1));
    else if (weekday !== 6) set.add(date);
  }
  for (const spec of FLOATING_HOLIDAYS) {
    set.add(nthWeekdayOfMonth(year, spec.month, spec.weekday, spec.nth));
  }
  cache.set(year, set);
  return set;
}

function isHoliday(dateStr) {
  const year = Number(dateStr.slice(0, 4));
  if (observedHolidays(year).has(dateStr)) return true;
  // 1 January of the next year can be observed on 2 January, never earlier, and
  // a Sunday 31 December is never a fixed holiday, so neighbouring years cannot
  // push an observance into this one.
  return false;
}

function isBusinessDay(dateStr) {
  const weekday = dayOfWeek(dateStr);
  if (weekday === 0 || weekday === 6) return false;
  return !isHoliday(dateStr);
}

function firstBusinessDayOnOrAfter(dateStr) {
  let cursor = dateStr;
  while (!isBusinessDay(cursor)) cursor = addDays(cursor, 1);
  return cursor;
}

function nextBusinessDayAfter(dateStr) {
  return firstBusinessDayOnOrAfter(addDays(dateStr, 1));
}

function addBusinessDays(dateStr, count) {
  let cursor = dateStr;
  for (let i = 0; i < count; i += 1) cursor = nextBusinessDayAfter(cursor);
  return cursor;
}

module.exports = {
  isBusinessDay,
  isHoliday,
  firstBusinessDayOnOrAfter,
  nextBusinessDayAfter,
  addBusinessDays,
};
