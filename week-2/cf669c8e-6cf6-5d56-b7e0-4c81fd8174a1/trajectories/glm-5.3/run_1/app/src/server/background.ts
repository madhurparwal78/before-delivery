import type { Config } from './config.js';
import { Killbill } from './services/killbill.js';
import { Registry } from './services/registry.js';
import { Mailer } from './services/mailer.js';
import { healthyDatabase } from './db.js';
import { migrateAndSeed, callbackSecret } from './store.js';
import { runCollectionSweep } from './domain/collection.js';
import { expireHolds } from './domain/rides.js';
import { markMailSent, markMailRetry, claimPendingMail } from './mail.js';
import { sendPendingDraws } from './domain/notifications.js';
import type { ProviderStatus } from './domain/payments.js';

// Background work: provider probes, callback registration, mail sending,
// hold expiry and instalment collection. All shared state lives in PostgreSQL.

export interface BackgroundHandle {
  providers: ProviderStatus;
  stop: () => void;
}

export function startBackground(config: Config, kb: Killbill, registry: Registry, mailer: Mailer, onDatabaseRecovered: () => void): BackgroundHandle {
  const providers: ProviderStatus = { killbill: 'down', registry: 'down' };
  let stopped = false;
  const timers: NodeJS.Timeout[] = [];

  // Provider probes: at least every 5 seconds; the browser refreshes at least
  // every 3 seconds from /api/status.
  const probe = async () => {
    if (stopped) return;
    const [kbUp, regUp] = await Promise.all([kb.health(), registry.probe()]);
    const kbWasUp = providers.killbill === 'up';
    providers.killbill = kbUp ? 'up' : 'down';
    providers.registry = regUp ? 'up' : 'down';
    if (!kbWasUp && kbUp) {
      // Recovery: send out deferred refund draws with their same external keys.
      try {
        await sendPendingDraws(config, kb, '');
      } catch {
        // The next probe retries.
      }
    }
  };
  timers.push(setInterval(() => void probe(), 3000));
  void probe();

  // Callback registration: retry until Kill Bill lists this instance's URL.
  const registerCallback = async () => {
    if (stopped) return;
    if (providers.killbill === 'down') return;
    try {
      const secret = await callbackSecret(config);
      const origin = `${config.killbillCallbackOrigin}/api/killbill/notifications/${secret}`;
      const existing = await kb.listCallbacks();
      if (!existing.includes(origin)) {
        await kb.registerCallback(origin);
      }
    } catch {
      // Retried on the next tick.
    }
  };
  timers.push(setInterval(() => void registerCallback(), 5000));
  void registerCallback();

  // Mail sender: claims pending mails one at a time; failures retry.
  const sendMails = async () => {
    if (stopped) return;
    for (let i = 0; i < 20; i++) {
      try {
        const mail = await claimPendingMail(config);
        if (!mail) break;
        const ok = await mailer.send({ id: mail.id, toEmail: mail.to_email, subject: mail.subject, body: mail.body });
        if (ok) {
          await markMailSent(config, mail.id);
        } else {
          await markMailRetry(config, mail.id);
          break;
        }
      } catch {
        break;
      }
    }
  };
  timers.push(setInterval(() => void sendMails(), 1000));
  void sendMails();

  // Hold expiry on the server's clock: no client involved, marked within a
  // second, once across instances sharing the database.
  timers.push(setInterval(() => {
    void (async () => {
      try {
        await expireHolds(config);
      } catch {
        // The next sweep retries.
      }
    })();
  }, 1000));

  // Instalment collection: checked at least once per real second.
  timers.push(setInterval(() => {
    void (async () => {
      try {
        if (await healthyDatabase(config)) {
          await runCollectionSweep(config, kb, providers.killbill === 'up');
        }
      } catch {
        // The next sweep retries.
      }
    })();
  }, 1000));

  // Database watchdog: when PostgreSQL returns, the schema is applied again.
  let dbWasDown = false;
  timers.push(setInterval(() => {
    void (async () => {
      try {
        const up = await healthyDatabase(config);
        if (!up) {
          dbWasDown = true;
          return;
        }
        if (dbWasDown) {
          dbWasDown = false;
          await migrateAndSeed(config);
          onDatabaseRecovered();
        }
      } catch {
        dbWasDown = true;
      }
    })();
  }, 2000));

  return {
    providers,
    stop: () => {
      stopped = true;
      for (const t of timers) clearInterval(t);
    },
  };
}
