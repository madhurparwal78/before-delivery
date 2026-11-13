import { checkMail } from "./mail/smtp.js";
import { checkStorage } from "./storage.js";
import { dispatch } from "./live.js";

type Service = "mail" | "storage";

const status: Record<Service, boolean | null> = { mail: null, storage: null };
let recheck: NodeJS.Timeout | null = null;

export function serviceStatus(): { mail: boolean; storage: boolean } {
  return { mail: status.mail !== false, storage: status.storage !== false };
}

export function isHealthy(): boolean {
  return status.mail === true && status.storage === true;
}

export async function runChecks(): Promise<void> {
  const before = serviceStatus();
  const [mail, storage] = await Promise.all([checkMail(), checkStorage()]);
  status.mail = mail;
  status.storage = storage;
  const after = serviceStatus();
  if (before.mail !== after.mail || before.storage !== after.storage) dispatch({ type: "services", ...after });
}

export function reportFailure(service: Service): void {
  const before = serviceStatus();
  status[service] = false;
  if (before[service]) dispatch({ type: "services", ...serviceStatus() });
  if (!recheck) {
    recheck = setTimeout(() => {
      recheck = null;
      void runChecks();
    }, 0);
  }
}
