import { type Config, loadConfig } from './config.ts';
import { BillingProvider } from './providers/billing.ts';
import { MailProvider } from './providers/mail.ts';
import { ObjectStore } from './providers/objectstore.ts';
import { ServiceState } from './providers/services.ts';
import { StepRunner } from './steps.ts';
import { Store } from './store/store.ts';

export type App = {
  config: Config;
  store: Store;
  billing: BillingProvider;
  objectStore: ObjectStore;
  mail: MailProvider;
  services: ServiceState;
  steps: StepRunner;
};

export function createApp(): App {
  const config = loadConfig();
  const store = new Store(config.dataDirectory, config.port);
  const billing = new BillingProvider(config.killbill);
  const objectStore = new ObjectStore(config.objectStore);
  const mail = new MailProvider(config.mail);
  const services = new ServiceState(billing, objectStore, mail);
  const steps = new StepRunner(store, billing, objectStore, mail);
  return { config, store, billing, objectStore, mail, services, steps };
}
