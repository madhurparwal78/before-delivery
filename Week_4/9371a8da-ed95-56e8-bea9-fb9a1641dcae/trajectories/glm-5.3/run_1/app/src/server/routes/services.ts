import type { Sql } from '../db.js';
import type { Config } from '../config.js';
import type { Storage } from '../storage.js';
import type { Mailer } from '../mail.js';
import type { Request, Response, NextFunction } from 'express';

export interface Services {
  sql: Sql;
  storage: Storage;
  mailer: Mailer;
  config: Config;
}

export type Wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => void;

export interface RouteCtx { wrap: Wrap; svc: Services }
