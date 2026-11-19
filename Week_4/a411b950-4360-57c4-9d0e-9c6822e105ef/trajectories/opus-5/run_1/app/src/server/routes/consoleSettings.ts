import { withTransaction } from '../db/pool.ts';
import { businessMonth, isMonthKey, isTimeZone } from '../../shared/dates.ts';
import { isJsonInteger, unwritableKeyErrors, WRITABLE_FIELDS } from '../domain/writable.ts';
import { validation } from '../errors.ts';
import { sendJson } from '../http/respond.ts';
import type { Route } from '../http/router.ts';
import { lockMonth, readMonth, readMonthsFrom, upsertCapacity } from '../repo/months.ts';
import { readSettings, writeTimeZone } from '../repo/settings.ts';
import { pendingEmails } from '../services/mail.ts';

const CAPACITY_MAX = 12;

export const consoleSettingsRoutes: readonly Route[] = [
  {
    path: '/api/console/months',
    method: 'GET',
    requiresSession: true,
    handler: async ({ response, now }) => {
      const settings = await readSettings();
      const months = await readMonthsFrom(businessMonth(now, settings.time_zone));
      sendJson(response, 200, { months });
    },
  },
  {
    path: '/api/console/months/:month',
    method: 'PUT',
    requiresSession: true,
    handler: async ({ response, params, json, now }) => {
      const settings = await readSettings();
      const month = params.month as string;
      const errors = unwritableKeyErrors(json, WRITABLE_FIELDS.month);
      if (!isMonthKey(month) || month < businessMonth(now, settings.time_zone)) {
        errors.month = 'Choose the current month or a later one.';
      }
      if (!isJsonInteger(json.capacity) || json.capacity < 0 || json.capacity > CAPACITY_MAX) {
        errors.capacity = `Use a whole number from 0 to ${CAPACITY_MAX}.`;
      }
      if (Object.keys(errors).length > 0) throw validation(errors);

      const capacity = json.capacity as number;
      await withTransaction(async (client) => {
        const locked = await lockMonth(client, month);
        if (capacity < locked.claimed) {
          throw validation({
            capacity: `Capacity can\u2019t be below the ${locked.claimed} places already claimed.`,
          });
        }
        await upsertCapacity(client, month, capacity);
      });
      sendJson(response, 200, { month: await readMonth(month) });
    },
  },
  {
    path: '/api/console/mail-queue',
    method: 'GET',
    requiresSession: true,
    handler: async ({ response, now }) => {
      sendJson(response, 200, { server_time: now.toISOString(), emails: await pendingEmails() });
    },
  },
  {
    path: '/api/console/settings',
    method: 'GET',
    requiresSession: true,
    handler: async ({ response }) => {
      const settings = await readSettings();
      sendJson(response, 200, { time_zone: settings.time_zone, operator_email: settings.operator_email });
    },
  },
  {
    path: '/api/console/settings',
    method: 'PUT',
    requiresSession: true,
    handler: async ({ response, json }) => {
      const errors = unwritableKeyErrors(json, WRITABLE_FIELDS.settings);
      if (typeof json.time_zone !== 'string' || !isTimeZone(json.time_zone)) {
        errors.time_zone = 'Choose a time zone from the list.';
      }
      if (Object.keys(errors).length > 0) throw validation(errors);
      const settings = await writeTimeZone(json.time_zone as string);
      sendJson(response, 200, { time_zone: settings.time_zone, operator_email: settings.operator_email });
    },
  },
];
