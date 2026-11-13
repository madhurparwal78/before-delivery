import { queryOne } from '../db/pool.js';
import {
  type MovementKind,
  MOVEMENT_KINDS,
  logShowHours,
  movementPage,
  recordMovement,
  reverseMovement,
  shelfView,
} from '../data/kit.js';
import { compare, parseDecimal } from '../domain/decimal.js';
import { fieldCopy } from '../http/fields.js';
import { problem } from '../http/problem.js';
import { route } from '../http/server.js';
import { Validation, readNumberText, readString } from '../http/validate.js';

const ZERO = parseDecimal('0');
const HOURS_HIGH = parseDecimal('1000');

route('GET', '/api/kit/shelf', async () => ({ status: 200, body: await shelfView() }));

route(
  'POST',
  '/api/kit/movements',
  async (context) => {
    const check = new Validation();
    const kind = readString(check, context.body, 'kind');
    const serial = readString(check, context.body, 'serial');
    if (kind !== null && !(MOVEMENT_KINDS as readonly string[]).includes(kind)) {
      check.add('/kind', fieldCopy.required);
    }
    const model = kind === 'bought' ? readString(check, context.body, 'model') : null;
    const siteId = kind === 'sent_to_site' ? readString(check, context.body, 'siteId') : null;
    const hours =
      context.body['loggedHours'] === undefined ? null : readNumberText(check, context.body, 'loggedHours', 'refused');
    if (siteId !== null) {
      const site = await queryOne('select id from sites where id = $1', [siteId]);
      if (site === null) check.add('/siteId', fieldCopy.required);
    }
    check.finish();
    const movement = await recordMovement({
      kind: kind as MovementKind,
      serial: serial as string,
      model,
      loggedHours: hours === null ? null : hours.text.replace(',', '.'),
      siteId,
    });
    return { status: 201, body: movement };
  },
  { keyed: true, shape: { kind: true, serial: true, model: true, loggedHours: true, siteId: true } },
);

route('GET', '/api/kit/movements', async (context) => {
  const asked = context.search.get('limit');
  if (asked !== null && !/^[0-9]+$/.test(asked)) {
    throw problem('validation_failed', { extensions: { errors: { '/limit': fieldCopy.limit } } });
  }
  const limit = asked === null ? 50 : Number(asked);
  if (limit < 1 || limit > 200) {
    throw problem('validation_failed', { extensions: { errors: { '/limit': fieldCopy.limit } } });
  }
  return { status: 200, body: await movementPage(limit, context.search.get('after')) };
});

route(
  'POST',
  '/api/kit/movements/:movementId/reverse',
  async (context) => ({ status: 201, body: await reverseMovement(context.params['movementId'] as string) }),
  { keyed: true, emptyAllowed: true, shape: {} },
);

route(
  'POST',
  '/api/kit/bodies/:serial/hours',
  async (context) => {
    const check = new Validation();
    const hours = readNumberText(check, context.body, 'hours', 'refused');
    if (hours !== null && (compare(hours.value, ZERO) <= 0 || compare(hours.value, HOURS_HIGH) > 0)) {
      check.add('/hours', fieldCopy.hours);
    }
    check.finish();
    const logged = await logShowHours(
      context.params['serial'] as string,
      (hours as { text: string }).text.replace(',', '.'),
    );
    return { status: 200, body: logged };
  },
  { keyed: true, shape: { hours: true } },
);
