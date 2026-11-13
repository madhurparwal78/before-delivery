import { confirmHold, createHold, holdView, listHolds, quoteHold, releaseHold, requireHold } from '../data/holds.js';
import { brusselsToday, isValidDay } from '../domain/brussels.js';
import { MAX_HIRE_DAYS, MIN_HIRE_DAYS } from '../domain/quotes.js';
import { fieldCopy } from '../http/fields.js';
import { problem } from '../http/problem.js';
import { route } from '../http/server.js';
import { Validation, readString, readWholeNumber } from '../http/validate.js';
import { askStock } from '../services/hiredesk.js';

function checkDays(check: Validation, days: number | null): void {
  if (days !== null && (days < MIN_HIRE_DAYS || days > MAX_HIRE_DAYS)) check.add('/days', fieldCopy.days);
}

function checkFirstDay(check: Validation, from: string | null): void {
  if (from === null) return;
  if (!isValidDay(from)) {
    check.add('/from', fieldCopy.firstDay);
    return;
  }
  if (from < brusselsToday(Date.now())) check.add('/from', fieldCopy.firstDay);
}

route('GET', '/api/hire/stock', async (context) => {
  const check = new Validation();
  const model = context.search.get('model');
  const from = context.search.get('from');
  const days = context.search.get('days');
  if (model === null || model === '') check.add('/model', fieldCopy.required);
  if (from === null) check.add('/from', fieldCopy.required);
  else checkFirstDay(check, from);
  const count = days === null ? null : Number(days);
  if (days === null || !Number.isInteger(count)) check.add('/days', fieldCopy.days);
  else checkDays(check, count);
  check.finish();
  const answer = await askStock(model as string, from as string, count as number);
  if (answer.kind !== 'answered') throw problem('hire_desk_unavailable');
  return {
    status: 200,
    body: {
      model: answer.value.model,
      available: answer.value.available,
      dayRateCents: answer.value.dayRateCents,
    },
  };
});

route(
  'POST',
  '/api/holds',
  async (context) => {
    const check = new Validation();
    const model = readString(check, context.body, 'model');
    const from = readString(check, context.body, 'from');
    const days = readWholeNumber(check, context.body, 'days', fieldCopy.days, MIN_HIRE_DAYS, MAX_HIRE_DAYS);
    checkFirstDay(check, from);
    check.finish();
    return {
      status: 201,
      body: await createHold({ model: model as string, from: from as string, days: days as number }),
    };
  },
  { keyed: true, shape: { model: true, from: true, days: true } },
);

route('GET', '/api/holds', async () => ({ status: 200, body: { items: await listHolds() } }));

route('GET', '/api/holds/:holdId', async (context) => ({
  status: 200,
  body: holdView(await requireHold(context.params['holdId'] as string), Date.now()),
}));

route(
  'POST',
  '/api/holds/:holdId/quote',
  async (context) => ({ status: 200, body: await quoteHold(context.params['holdId'] as string) }),
  { emptyAllowed: true, shape: {} },
);

route(
  'POST',
  '/api/holds/:holdId/confirm',
  async (context) => ({ status: 200, body: await confirmHold(context.params['holdId'] as string) }),
  { keyed: true, emptyAllowed: true, shape: {} },
);

route(
  'POST',
  '/api/holds/:holdId/release',
  async (context) => ({ status: 200, body: await releaseHold(context.params['holdId'] as string) }),
  { keyed: true, emptyAllowed: true, shape: {} },
);
