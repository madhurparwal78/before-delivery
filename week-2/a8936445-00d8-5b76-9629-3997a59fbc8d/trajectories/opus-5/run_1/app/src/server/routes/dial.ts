import { route } from '../http/router.js';
import { dialDay } from '../services/dial.js';
import { queryValue } from './params.js';

route('GET', '/api/dial', {}, async (ctx) => ({
  status: 200,
  json: await dialDay(ctx.actor, queryValue(ctx.query, 'date')),
}));
