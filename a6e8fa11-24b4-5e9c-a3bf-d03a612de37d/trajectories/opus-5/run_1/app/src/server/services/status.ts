import { ServiceStatusDto } from '../../shared/api';
import { mailIsUp } from './mail';
import { storageIsUp } from './storage';

let current: ServiceStatusDto = { storage: 'down', mail: 'down', checkedAt: new Date(0).toISOString() };
let checking: Promise<void> | null = null;

async function runCheck(): Promise<void> {
  const [storage, mail] = await Promise.all([storageIsUp(), mailIsUp()]);
  current = {
    storage: storage ? 'up' : 'down',
    mail: mail ? 'up' : 'down',
    checkedAt: new Date().toISOString(),
  };
}

export async function serviceStatus(): Promise<ServiceStatusDto> {
  const age = Date.now() - new Date(current.checkedAt).getTime();
  if (age > 9000) {
    if (!checking) {
      checking = runCheck().finally(() => {
        checking = null;
      });
    }
    await checking;
  }
  return current;
}

export function startStatusChecks(): void {
  const tick = () => {
    if (!checking) {
      checking = runCheck().finally(() => {
        checking = null;
      });
    }
  };
  tick();
  setInterval(tick, 5000).unref();
}

export async function storageAvailable(): Promise<boolean> {
  return (await serviceStatus()).storage === 'up';
}
