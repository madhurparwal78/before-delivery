// The app object: config, pool, storage, clock, and the domain limits that
// come from the environment. Everything the routes need hangs off this.
import pg from 'pg';
import type { Config } from './config';
import type { S3Client } from './s3client';
import type { Clock } from './clock';
import type { DomainLimits } from '../domain/props';

export type Pool = pg.Pool;

export interface App {
  cfg: Config;
  pool: Pool;
  s3: S3Client;
  clock: Clock;
  limits: DomainLimits;
  instanceId: string;
  startedAt: number;
}
