// The one live-feed publisher. Every state change goes through publish().
type Client = { clinicId: string; userId: string; send: (event: string, data: any) => void };

const clients = new Map<number, Client>();
let nextId = 1;

export function subscribe(clinicId: string, userId: string, send: (event: string, data: any) => void): number {
  const id = nextId++;
  clients.set(id, { clinicId, userId, send });
  return id;
}

export function unsubscribe(id: number): void {
  clients.delete(id);
}

export function closeClinicStreams(clinicId: string, exceptUserId?: string): void {
  for (const [id, c] of clients) {
    if (c.clinicId === clinicId && c.userId !== exceptUserId) {
      c.send('close', {});
      clients.delete(id);
    }
  }
}

export function pushClinic(clinicId: string, event: string, data: any, opts: { exceptUser?: string } = {}): void {
  for (const c of clients.values()) {
    if (c.clinicId === clinicId && (!opts.exceptUser || c.userId !== opts.exceptUser)) {
      try { c.send(event, data); } catch { /* stream already gone */ }
    }
  }
}

// announce carries the polite success text for the window that did the action;
// other windows of the clinic still receive the state event silently.
export function publish(clinicId: string, event: string, data: any, opts: { actorId?: string; announcement?: string } = {}): void {
  for (const c of clients.values()) {
    if (c.clinicId !== clinicId) continue;
    const payload = opts.announcement && c.userId === opts.actorId ? { ...data, announcement: opts.announcement } : data;
    try { c.send(event, payload); } catch { /* stream already gone */ }
  }
}

// pushClinicAll notifies every subscriber of every clinic (used after a clock set).
export function pushClinicAll(event: string, data: any): void {
  for (const c of clients.values()) {
    try { c.send(event, data); } catch { /* stream already gone */ }
  }
}

// pushUser carries a targeted event to one person's open windows.
export function pushUser(userId: string, event: string, data: any): void {
  for (const c of clients.values()) {
    if (c.userId === userId) {
      try { c.send(event, data); } catch { /* stream already gone */ }
    }
  }
}
