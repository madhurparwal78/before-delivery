import express, { type Router, type Express } from "express";
import type { Database } from "./db.js";
import type { Config } from "./config.js";
import type { ObjectStore } from "./objectstore.js";
import type { KillBillClient } from "./killbill.js";
import type { Mailer } from "./mailer.js";
import type { Person } from "./person.js";

export type AppContext = {
  db: Database;
  config: Config;
  store: ObjectStore;
  killbill: KillBillClient;
  mailer: Mailer;
};

export type RouteContext = AppContext & {
  person: Person;
};

export type RouteModule = (router: Router, ctx: AppContext) => void;

export function createRouter(): Router {
  return express.Router();
}

export type { Express };

