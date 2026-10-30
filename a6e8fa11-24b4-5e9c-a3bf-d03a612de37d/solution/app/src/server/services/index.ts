import { type Db } from "../db.js";
import { type Workers } from "../workers.js";
import { type StatusMonitor } from "./status.js";
import { type Storage } from "./storage.js";

/** The three provided services and the workers that use them, as the routes see them. */
export interface Services {
  db: Db;
  storage: Storage;
  status: StatusMonitor;
  workers: Workers;
}
