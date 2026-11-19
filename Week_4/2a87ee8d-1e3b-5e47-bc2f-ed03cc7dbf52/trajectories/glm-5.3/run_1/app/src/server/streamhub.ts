/**
 * The live-update stream. Every instance LISTENs on one Postgres channel;
 * a committed change NOTIFIEs all instances, and each instance then pushes a
 * `board` event with the version to the streams it serves (DP-21).
 */
import { type Client } from 'pg';
import type { ServerResponse } from 'node:http';

interface StreamEntry {
  res: ServerResponse;
  workshopId: string;
  viewerKey: string; // facilitator id or participant id
  lastEventId: number;
}

export class StreamHub {
  private streams: StreamEntry[] = [];
  private listener: Client | null = null;

  attach(listener: Client): void {
    this.listener = listener;
    listener.on('notification', (msg) => {
      if (msg.channel !== 'lf_change') return;
      const [workshopId, versionStr, endedIds] = (msg.payload ?? '').split('|');
      const version = Number(versionStr);
      if (!workshopId || Number.isNaN(version)) return;
      this.pushBoardEvent(workshopId, version);
      for (const id of endedIds.split(',').filter((x) => x.length > 0)) this.pushEnded(id);
    });
    listener.on('error', () => { this.listener = null; });
    listener.query('listen lf_change').catch(() => { /* retried by the owner */ });
  }

  pushBoardEvent(workshopId: string, version: number): void {
    for (const s of this.streams) {
      if (s.workshopId !== workshopId) continue;
      if (s.lastEventId >= version) continue;
      s.lastEventId = version;
      this.writeEvent(s, 'board', String(version), { version });
    }
  }

  /** presence data: the caller's own cursor is never echoed back. */
  pushPresence(workshopId: string, data: { cursorId: string; hue: number; x: number; y: number; name?: string }, senderKey: string, silentRoundForParticipants: boolean): void {
    for (const s of this.streams) {
      if (s.workshopId !== workshopId) continue;
      if (s.viewerKey === senderKey) continue;
      if (silentRoundForParticipants && s.viewerKey.startsWith('p:')) continue;
      this.writeEvent(s, 'presence', undefined, data);
    }
  }

  /** event: ended for one participant, then close. */
  pushEnded(participantId: string): void {
    for (const s of [...this.streams]) {
      if (s.viewerKey === `p:${participantId}`) {
        this.writeEvent(s, 'ended', undefined, {});
        s.res.end();
        this.remove(s);
      }
    }
  }

  private writeEvent(s: StreamEntry, event: string, id: string | undefined, data: unknown): void {
    try {
      s.res.write(`event: ${event}\n`);
      if (id !== undefined) s.res.write(`id: ${id}\n`);
      s.res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.remove(s);
    }
  }

  add(res: ServerResponse, workshopId: string, viewerKey: string, lastEventId: number, currentVersion: number, catchUp: boolean): void {
    const entry: StreamEntry = { res, workshopId, viewerKey, lastEventId };
    this.streams.push(entry);
    // A reconnect catches up first: one event for the current version.
    if (catchUp && currentVersion > lastEventId) {
      entry.lastEventId = currentVersion;
      this.writeEvent(entry, 'board', String(currentVersion), { version: currentVersion });
    }
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(ping); this.remove(entry); }
    }, 15000);
    res.on('close', () => { clearInterval(ping); this.remove(entry); });
  }

  remove(entry: StreamEntry): void {
    this.streams = this.streams.filter((s) => s !== entry);
  }
}
