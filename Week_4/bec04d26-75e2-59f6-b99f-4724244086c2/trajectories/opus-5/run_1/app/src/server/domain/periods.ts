import { Frequency } from '../../shared/types';
import { CivilDate, MONTH_NAMES, addMonths, pad } from '../../shared/dates';

const MONTHLY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTERLY_RE = /^(\d{4})-Q([1-4])$/;
const YEARLY_RE = /^(\d{4})$/;

export function matchesFrequency(period: string, frequency: Frequency): boolean {
  switch (frequency) {
    case 'monthly':
      return MONTHLY_RE.test(period);
    case 'quarterly':
      return QUARTERLY_RE.test(period);
    case 'yearly':
      return YEARLY_RE.test(period);
  }
}

/** The first day of the period in the state's own calendar. */
export function periodStartDate(period: string, frequency: Frequency): CivilDate {
  switch (frequency) {
    case 'monthly': {
      const m = MONTHLY_RE.exec(period);
      if (!m) throw new Error(`not a monthly period: ${period}`);
      return { y: Number(m[1]), m: Number(m[2]), d: 1 };
    }
    case 'quarterly': {
      const m = QUARTERLY_RE.exec(period);
      if (!m) throw new Error(`not a quarterly period: ${period}`);
      return { y: Number(m[1]), m: (Number(m[2]) - 1) * 3 + 1, d: 1 };
    }
    case 'yearly': {
      const m = YEARLY_RE.exec(period);
      if (!m) throw new Error(`not a yearly period: ${period}`);
      return { y: Number(m[1]), m: 1, d: 1 };
    }
  }
}

/** The year and month that follows the period, where the due day falls. */
export function dueMonth(period: string, frequency: Frequency): { y: number; m: number } {
  switch (frequency) {
    case 'monthly': {
      const start = periodStartDate(period, frequency);
      return addMonths(start.y, start.m, 1);
    }
    case 'quarterly': {
      const start = periodStartDate(period, frequency);
      return addMonths(start.y, start.m, 3);
    }
    case 'yearly': {
      const start = periodStartDate(period, frequency);
      return { y: start.y + 1, m: 1 };
    }
  }
}

export function periodLabel(period: string, frequency: Frequency): string {
  switch (frequency) {
    case 'monthly': {
      const m = MONTHLY_RE.exec(period);
      if (!m) return period;
      return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
    }
    case 'quarterly': {
      const m = QUARTERLY_RE.exec(period);
      if (!m) return period;
      return `Q${m[2]} ${m[1]}`;
    }
    case 'yearly':
      return period;
  }
}

/** The first 12 monthly, 4 quarterly or 1 yearly periods from the first period. */
export function generatePeriods(firstPeriod: string, frequency: Frequency): string[] {
  switch (frequency) {
    case 'monthly': {
      const start = periodStartDate(firstPeriod, frequency);
      const out: string[] = [];
      for (let i = 0; i < 12; i += 1) {
        const next = addMonths(start.y, start.m, i);
        out.push(`${pad(next.y, 4)}-${pad(next.m, 2)}`);
      }
      return out;
    }
    case 'quarterly': {
      const m = QUARTERLY_RE.exec(firstPeriod);
      if (!m) throw new Error(`not a quarterly period: ${firstPeriod}`);
      let year = Number(m[1]);
      let quarter = Number(m[2]);
      const out: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        out.push(`${pad(year, 4)}-Q${quarter}`);
        quarter += 1;
        if (quarter > 4) {
          quarter = 1;
          year += 1;
        }
      }
      return out;
    }
    case 'yearly':
      return [firstPeriod];
  }
}

export function isFrequency(value: unknown): value is Frequency {
  return value === 'monthly' || value === 'quarterly' || value === 'yearly';
}
