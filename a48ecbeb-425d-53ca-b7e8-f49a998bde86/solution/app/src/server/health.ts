import { probeDb } from "./db.js";
import { probeFiles } from "./files.js";
import { probeKillBill } from "./killbill.js";
import { probeMail } from "./mail.js";
import { probePocketBase } from "./pocketbase.js";

// The live status of each backing service, probed every few seconds.

type Service = "killbill" | "postgres" | "pocketbase" | "minio" | "mailpit";

const PROBES: Record<Service, () => Promise<boolean>> = {
  killbill: probeKillBill,
  postgres: probeDb,
  pocketbase: probePocketBase,
  minio: probeFiles,
  mailpit: probeMail,
};

const status: Record<Service, "up" | "down"> = {
  killbill: "down",
  postgres: "down",
  pocketbase: "down",
  minio: "down",
  mailpit: "down",
};

export async function refreshStatus(): Promise<void> {
  await Promise.all(
    (Object.keys(PROBES) as Service[]).map(async (service) => {
      status[service] = (await PROBES[service]()) ? "up" : "down";
    }),
  );
}

export const serviceStatus = (): Record<Service, "up" | "down"> => ({ ...status });
export const isUp = (service: Service): boolean => status[service] === "up";
