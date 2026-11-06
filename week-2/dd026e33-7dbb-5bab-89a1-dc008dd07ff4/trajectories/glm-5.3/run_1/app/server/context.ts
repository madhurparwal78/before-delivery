import type { Db } from './db.ts';
import type { Env } from './env.ts';
import type { Storage } from './providers/storage.ts';
import type { KillBill } from './providers/killbill.ts';
import type { MailService } from './providers/mail.ts';

export interface ServiceStatus {
  storage: 'up' | 'down';
  billing: 'up' | 'down';
  mail: 'up' | 'down';
  checkedAt: number;
}

export interface AppCtx {
  db: Db;
  env: Env;
  storage: Storage;
  killbill: KillBill;
  mail: MailService;
  status: ServiceStatus;
}

export interface Actor {
  id: string;
  name: string;
}

export interface Viewer {
  id: string;
  name: string;
  email: string;
  role: 'concierge' | 'care_technician' | 'workshop_lead' | 'house_manager' | 'owner';
  sessionId: string;
  isStaff(): boolean;
  isOwner(): boolean;
}

export function makeViewer(user: { id: string; name: string; email: string; role: string }, sessionId: string): Viewer {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as Viewer['role'],
    sessionId,
    isStaff() {
      return this.role !== 'owner';
    },
    isOwner() {
      return this.role === 'owner';
    },
  };
}
