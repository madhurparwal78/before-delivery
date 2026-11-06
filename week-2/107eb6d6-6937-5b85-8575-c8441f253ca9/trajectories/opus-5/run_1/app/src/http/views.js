import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';
import { COPY } from '../domain/errors.js';
import {
  DEPOT_LABELS,
  REQUEST_STATUSES,
  ROLES,
  ROLE_LABELS,
  STATUS_LABELS,
  STOP_KINDS,
  STOP_LABELS,
  TRANSPORT_TYPES,
  TRANSPORT_TYPE_LABELS,
  TRUCK_STATUSES,
  TRUCK_STATUS_LABELS,
  boardSummaryLine,
  decisionLine,
  fleetSummaryLine,
  truckCountLine
} from '../domain/labels.js';

const TEMPLATES_DIR = fileURLToPath(new URL('../../templates', import.meta.url));

const pad = (value) => String(value).padStart(2, '0');

export function configureViews(app, assetVersion) {
  const env = nunjucks.configure(TEMPLATES_DIR, { autoescape: true, express: app, noCache: false });

  const globals = {
    COPY,
    REQUEST_STATUSES,
    TRANSPORT_TYPES,
    TRUCK_STATUSES,
    ROLES,
    STOP_KINDS,
    STATUS_LABELS,
    TRANSPORT_TYPE_LABELS,
    TRUCK_STATUS_LABELS,
    DEPOT_LABELS,
    ROLE_LABELS,
    STOP_LABELS,
    truckCountLine,
    boardSummaryLine,
    fleetSummaryLine,
    decisionLine,
    assetVersion
  };
  for (const [name, value] of Object.entries(globals)) env.addGlobal(name, value);

  env.addFilter('day', (iso) => String(iso).slice(0, 10));
  env.addFilter(
    'stats',
    (line) =>
      new nunjucks.runtime.SafeString(
        nunjucks.lib.escape(line).replace(/\d+/g, (number) => `<span class="stat">${number}</span>`)
      )
  );
  env.addFilter('stamp', (iso) => {
    const at = new Date(iso);
    return `${at.toISOString().slice(0, 10)} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
  });

  return env;
}
