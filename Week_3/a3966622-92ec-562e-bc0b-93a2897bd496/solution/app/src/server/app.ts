// What every route and step works with: the store, the configuration and the three providers.
import type { Config } from "./config.js";
import type { ServiceMonitor } from "./providers/health.js";
import type { KillBill } from "./providers/killbill.js";
import type { ObjectStore } from "./providers/s3.js";
import type { Mailer } from "./providers/smtp.js";
import type { Store } from "./store.js";

export interface App {
  store: Store;
  config: Config;
  killbill: KillBill;
  objects: ObjectStore;
  mailer: Mailer;
  services: ServiceMonitor;
}
