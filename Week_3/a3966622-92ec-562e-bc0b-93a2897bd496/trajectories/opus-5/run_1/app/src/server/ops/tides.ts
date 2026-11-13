import { holdsCommittedWindow } from '../../domain/moves.ts';
import { formatInstantSeconds, parsePortTime, wallToInstants } from '../../domain/porttime.ts';
import { type TideEvent, eventsAlternate } from '../../domain/tide.ts';
import type { App } from '../app.ts';
import { forbidden } from '../errors.ts';
import { orderAmended } from '../notices.ts';
import type { UserRecord } from '../store/types.ts';
import type { ActionResult } from './moves.ts';
import { recheckCommittedWindow } from './moves.ts';
import { FieldErrors, TIME_DOES_NOT_EXIST, asRecord, dateField, definite } from './validate.ts';

export function publishTideRevision(app: App, user: UserRecord, body: unknown): ActionResult {
  if (user.role !== 'dispatcher') throw forbidden();
  const now = Date.now();
  const fields = asRecord(body);
  const errors = new FieldErrors();
  const dateCandidate = dateField(fields, 'date', errors);
  const rawEvents = fields.events;
  const events: TideEvent[] = [];
  if (!Array.isArray(rawEvents) || rawEvents.length < 2 || rawEvents.length > 6) {
    errors.add('events', 'From 2 to 6 alternating high and low waters are required');
  } else {
    let previousMinutes = -1;
    for (const entry of rawEvents) {
      if (typeof entry !== 'object' || entry === null) {
        errors.add('events', 'Each event needs a time, a type and a height');
        break;
      }
      const event = entry as Record<string, unknown>;
      const at = event.at;
      const type = event.type;
      const height = event.height_mm;
      if (typeof at !== 'string' || parsePortTime(at) === null) {
        errors.add('events', 'Each event time reads HH:MM in port time');
        break;
      }
      if (type !== 'high' && type !== 'low') {
        errors.add('events', 'Each event is a high or a low water');
        break;
      }
      if (typeof height !== 'number' || !Number.isInteger(height) || height < 0 || height > 20000) {
        errors.add('events', 'Each height is a whole number of millimetres');
        break;
      }
      const time = parsePortTime(at) as { hour: number; minute: number };
      const minutes = time.hour * 60 + time.minute;
      if (minutes <= previousMinutes) {
        errors.add('events', 'Events run in rising order of time');
        break;
      }
      previousMinutes = minutes;
      if (dateCandidate !== null) {
        const instants = wallToInstants({
          year: dateCandidate.wall.year,
          month: dateCandidate.wall.month,
          day: dateCandidate.wall.day,
          hour: time.hour,
          minute: time.minute,
          second: 0,
        });
        if (instants.length === 0) {
          errors.add('events', TIME_DOES_NOT_EXIST);
          break;
        }
      }
      events.push({ at, type, height_mm: height });
    }
    if (events.length === rawEvents.length && !eventsAlternate(events)) {
      errors.add('events', 'High and low waters must alternate');
    }
  }
  errors.throwIfAny();
  const date = definite(dateCandidate, 'date');

  const state = app.store.read();
  const returned: string[] = [];
  const version = app.store.mutate(() => {
    state.tide_revisions = [
      ...state.tide_revisions.filter((revision) => revision.date !== date.text),
      {
        date: date.text,
        events,
        version: state.tide_version + 1,
        published_at: formatInstantSeconds(now),
      },
    ];
    state.tide_version += 1;
    for (const move of state.moves) {
      if (!holdsCommittedWindow(move.status)) continue;
      const wentBack = recheckCommittedWindow(app, state, move, now);
      move.version += 1;
      if (wentBack) {
        returned.push(move.ref);
        move.history.push({ at: formatInstantSeconds(now), status: move.status, by: user.name });
        orderAmended({
          state,
          move,
          now,
          nextId: (counter, prefix) => app.store.nextId(counter, prefix),
        });
      }
    }
    return state.tide_version;
  });
  void app.steps.runPending();
  return { status: 201, json: { version, returned_to_ordered: returned } };
}
