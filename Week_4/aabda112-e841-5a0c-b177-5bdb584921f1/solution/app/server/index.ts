import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { clinicDate, CLINIC_ZONE } from '../shared/clinictime.js';
import { clinicHours, config } from './config.js';
import { now, startClock } from './clock.js';
import { ping, prepareDatabase } from './db.js';
import { seedDefaults } from './defaults.js';
import { dispatch, route } from './http.js';
import { startLive } from './live.js';
import { storageReachable } from './storage.js';
import { startTicker } from './ticker.js';
import { registerAccountRoutes } from './accounts.js';
import { registerAppointmentRoutes } from './appointments.js';
import { registerBookingRoutes } from './booking.js';
import { registerConsultRoutes } from './consult.js';
import { registerGradingRoutes } from './grading.js';
import { registerInvoiceRoutes } from './invoices.js';
import { registerPatientRoutes } from './patients.js';
import { registerStockRoutes } from './stock.js';
import { registerWardRoutes } from './ward.js';

const webRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'web');
let ready = false;

route('GET', '/api/health', async (ctx) => {
  if (!ready || !(await ping())) {
    ctx.send(503, { status: 'down' });
    return;
  }
  ctx.send(200, { status: (await storageReachable()) ? 'ok' : 'unavailable' });
});

route('GET', '/api/time', async (ctx) => {
  const at = now();
  ctx.send(200, { now: at.toISOString(), clinicDate: clinicDate(at), timeZone: CLINIC_ZONE });
});

route('GET', '/api/settings', async (ctx) => {
  ctx.send(200, {
    slotMinutes: config.slotMinutes,
    openMinute: clinicHours.openMinute,
    closeMinute: clinicHours.closeMinute,
    uploadMaxMb: config.uploadMaxMb,
    vatPercent: config.vatPercent,
  });
});

registerAccountRoutes();
registerAppointmentRoutes();
registerConsultRoutes();
registerWardRoutes();
registerStockRoutes();
registerInvoiceRoutes();
registerPatientRoutes();
registerBookingRoutes();
registerGradingRoutes();

const server = createServer((req, res) => void dispatch(req, res, webRoot, { ready: () => ready }));
server.keepAliveTimeout = 65_000;
server.listen(config.port, '0.0.0.0');

/** Postgres may come up after the app: keep trying every two seconds until the schema and seed are in place. */
async function boot(): Promise<void> {
  try {
    await prepareDatabase((db) => seedDefaults(db, config.baseUrl));
    await startClock();
    startLive();
    startTicker();
    ready = true;
  } catch {
    setTimeout(() => void boot(), 2000);
  }
}

void boot();
