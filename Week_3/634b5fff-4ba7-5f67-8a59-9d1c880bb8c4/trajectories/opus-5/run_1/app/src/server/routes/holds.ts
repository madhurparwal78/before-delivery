import { Router } from 'express';
import { fail } from '../errors.js';
import { grantHold, holdMs, putBoxBack, readOwnHold } from '../holds.js';
import { handler, requireHeader } from '../http.js';

export const holdsRouter: Router = Router();

holdsRouter.post(
  '/api/holds',
  handler(async (req, res) => {
    const number = (req.jsonBody ?? {}).number;
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > 240) {
      throw fail(422, 'validation_failed');
    }
    const offered = requireHeader(req, 'X-Hold-Token');
    const hold = await grantHold(number, offered === '' ? null : offered);
    res.status(hold.fresh ? 201 : 200).json({
      number: hold.number,
      plate: hold.plate,
      holdToken: hold.holdToken,
      holdMs: hold.holdMs,
      remainingMs: hold.remainingMs,
    });
  }),
);

holdsRouter.get(
  '/api/holds/:number',
  handler(async (req, res) => {
    const number = Number.parseInt(String(req.params.number), 10);
    const remainingMs = await readOwnHold(number, requireHeader(req, 'X-Hold-Token'));
    res.json({ number, state: 'held', holdMs, remainingMs });
  }),
);

holdsRouter.delete(
  '/api/holds/:number',
  handler(async (req, res) => {
    const number = Number.parseInt(String(req.params.number), 10);
    await putBoxBack(number, requireHeader(req, 'X-Hold-Token'));
    res.status(204).end();
  }),
);
