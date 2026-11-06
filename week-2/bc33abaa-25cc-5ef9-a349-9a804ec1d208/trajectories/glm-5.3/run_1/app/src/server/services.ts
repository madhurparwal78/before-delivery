import type { Env } from "./env";
import { Storage } from "./storage";
import { KillBill } from "./killbill";
import { PocketBase } from "./pocketbase";
import { Mailer } from "./mailer";

export const services: { storage: Storage; killbill: KillBill; pocketbase: PocketBase; mailer: Mailer } = {
  storage: null as unknown as Storage,
  killbill: null as unknown as KillBill,
  pocketbase: null as unknown as PocketBase,
  mailer: null as unknown as Mailer,
};

export function initServices(env: Env): void {
  services.storage = new Storage(env);
  services.killbill = new KillBill(env);
  services.pocketbase = new PocketBase(env);
  services.mailer = new Mailer(env);
}

export { services as default };

// re-export convenience accessors used across routes
export const storage = () => services.storage;
export const killbill = () => services.killbill;
export const pocketbase = () => services.pocketbase;
export const mailer = () => services.mailer;
