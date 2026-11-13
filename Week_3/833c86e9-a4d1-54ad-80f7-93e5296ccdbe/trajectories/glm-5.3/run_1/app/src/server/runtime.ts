import { Pool, types } from "pg";
import { loadConfig, S3, type Config } from "./config.js";

// DATE (1082) and TIMESTAMP (1114) come back as strings; BIGINT (20) as number.
types.setTypeParser(1082, (v: string) => v);
types.setTypeParser(1114, (v: string) => v);
types.setTypeParser(20, (v: string) => Number(v));

export const cfg: Config = loadConfig();
export const db: Pool = new Pool({ connectionString: cfg.databaseUrl });
db.on("error", () => { /* keep serving; queries surface their own errors */ });
export const s3 = new S3(cfg.s3);

let storageUp = true;
let storageForcedDown = false;

export function storageAvailable(): boolean {
  return !storageForcedDown && storageUp;
}

export function setStorageDown(down: boolean): void {
  storageForcedDown = down;
}

export function markStorage(up: boolean): void {
  storageUp = up;
}

export type { Config };
