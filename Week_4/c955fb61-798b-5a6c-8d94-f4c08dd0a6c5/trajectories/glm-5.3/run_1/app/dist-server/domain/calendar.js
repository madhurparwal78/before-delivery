// Working-day calendar: the one place that decides what a working day is.
const MS_DAY = 86_400_000;
/** 1970-01-01 is working-day number 1. */
const WORKDAY_ANCHOR = '1970-01-01';
export class WorkingCalendar {
    holidays;
    constructor(holidays) {
        this.holidays = new Set(holidays);
    }
    isWorking(date) {
        const dow = weekday(date);
        return dow >= 1 && dow <= 5 && !this.holidays.has(date);
    }
    nextWorking(date) {
        let d = date;
        let guard = 0;
        while (!this.isWorking(d) && guard < 400) {
            d = addDays(d, 1);
            guard += 1;
        }
        return d;
    }
    previousWorking(date) {
        let d = date;
        let guard = 0;
        while (!this.isWorking(d) && guard < 400) {
            d = addDays(d, -1);
            guard += 1;
        }
        return d;
    }
    /** Count of working days strictly after `from` up to and including `to`; negative in the other direction. */
    workDiff(from, to) {
        if (from === to)
            return 0;
        const a = toEpoch(from);
        const b = toEpoch(to);
        const step = b > a ? 1 : -1;
        let count = 0;
        for (let d = a + step;; d += step) {
            if (this.isWorking(fromEpoch(d)))
                count += step;
            if (d === b)
                break;
        }
        return count;
    }
    /** Working-day number of a calendar day: the number of its next working day. */
    workingNumber(date) {
        return this.workDiff(WORKDAY_ANCHOR, this.nextWorking(date)) + 1;
    }
    /** The calendar date of working-day number `n`. */
    workingDay(n) {
        return this.addWorkdays(WORKDAY_ANCHOR, n - 1);
    }
    /** `n` working days after (or before, for negative `n`) a calendar day. */
    addWorkdays(date, n) {
        if (n === 0)
            return this.nextWorking(date);
        if (n > 0) {
            let iso = this.nextWorking(date);
            let left = n;
            while (left > 0) {
                iso = addDays(iso, 1);
                if (this.isWorking(iso))
                    left -= 1;
            }
            return iso;
        }
        let iso = this.previousWorking(date);
        let left = -n;
        while (left > 0) {
            iso = addDays(iso, -1);
            if (this.isWorking(iso))
                left -= 1;
        }
        return iso;
    }
    /** Working days from `start` to `end` inclusive, both assumed working days. */
    spanDuration(start, end) {
        if (end < start)
            return 0;
        return this.workDiff(start, end) + 1;
    }
}
export function isoDate(year, month, day) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export function toEpoch(date) {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / MS_DAY;
}
export function fromEpoch(epochDay) {
    const dt = new Date(epochDay * MS_DAY);
    return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
export function addDays(date, n) {
    return fromEpoch(toEpoch(date) + n);
}
export function weekday(date) {
    const dow = new Date(toEpoch(date) * MS_DAY).getUTCDay();
    return dow === 0 ? 7 : dow;
}
export function isIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const [y, m, d] = value.split('-').map(Number);
    if (m < 1 || m > 12 || d < 1 || d > 31)
        return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** `Mon 1 Mar 2027`. */
export function longDate(date) {
    const [y, m, d] = date.split('-').map(Number);
    return `${WEEKDAYS[weekday(date)]} ${d} ${MONTHS[m - 1]} ${y}`;
}
/** `Mon 1 Mar`. */
export function shortDate(date) {
    const [, m, d] = date.split('-').map(Number);
    return `${WEEKDAYS[weekday(date)]} ${d} ${MONTHS[m - 1]}`;
}
