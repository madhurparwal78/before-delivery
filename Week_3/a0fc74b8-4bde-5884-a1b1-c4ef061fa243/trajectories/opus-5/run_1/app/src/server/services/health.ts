import { checkMail } from './mail.ts';
import { checkStorage } from './storage.ts';

const CHECK_INTERVAL_MS = 5000;

interface Health {
  mail: boolean;
  storage: boolean;
}

const latest: Health = { mail: true, storage: true };

export const health = (): Health => ({ mail: latest.mail, storage: latest.storage });

export const recheckMail = async (): Promise<boolean> => {
  latest.mail = await checkMail();
  return latest.mail;
};

export const recheckStorage = async (): Promise<boolean> => {
  latest.storage = await checkStorage();
  return latest.storage;
};

/** Marks a service down at once, so the next decision uses the fresh verdict. */
export const markMailDown = (): void => {
  latest.mail = false;
};

export const markStorageDown = (): void => {
  latest.storage = false;
};

export const startHealthChecks = async (): Promise<void> => {
  await Promise.all([recheckMail(), recheckStorage()]);
  setInterval(() => {
    void recheckMail();
    void recheckStorage();
  }, CHECK_INTERVAL_MS).unref();
};
