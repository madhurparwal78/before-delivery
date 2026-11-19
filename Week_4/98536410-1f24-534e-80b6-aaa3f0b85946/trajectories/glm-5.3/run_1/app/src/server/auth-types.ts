import type { AuthContext } from "./auth.js";

export interface StoreRecord {
  id: string;
  operator_id: string;
  name: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  timezone: "Europe/Lisbon" | "Atlantic/Azores";
  suspended: boolean;
  suspension_reason: string | null;
}

export interface AppLocals {
  cfg: import("./config.js").Config;
  db: import("./db.js").Database;
  storage: import("./object-storage.js").ObjectStorage;
}

export type { AuthContext };
