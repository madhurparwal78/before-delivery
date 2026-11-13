import { ApiFailure, del, get, post } from '../api';
import type { Placement, Room, TriggerNode, Version } from '../../shared/types';

interface Restored {
  revision: number;
  room: Room;
  placements: Placement[];
  nodes: TriggerNode[];
  sceneOrder: string[];
}
import { putVersion } from './mutate';
import { EDITS_PAUSED } from './copy';
import { editor, say } from './state';

export async function loadVersions(): Promise<void> {
  const { roomId } = editor.get();
  if (!roomId) return;
  const { versions } = await get<{ versions: Version[] }>(`/api/rooms/${roomId}/versions`);
  editor.set({ versions });
}

/** Freezes the open room; resolves to the new version, or the field messages when the label was refused. */
export async function freezeVersion(label: string): Promise<{ version?: Version; errors?: Record<string, string> }> {
  const { roomId } = editor.get();
  say('Freezing version...');
  try {
    const { version } = await post<{ version: Version }>(`/api/rooms/${roomId}/versions`, { label }, { 'idempotency-key': crypto.randomUUID() });
    putVersion(version);
    editor.set((s) => ({ versions: s.versions.map((v) => (v.number === version.number - 1 ? { ...v, state: 'superseded' as const, supersededBy: version.number } : v)) }));
    say(`Version ${version.number} frozen.`);
    return { version };
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 422) {
      const errors = error.fieldErrors;
      say(Object.values(errors)[0] ?? 'Freeze failed. Nothing was saved. Try again.');
      return { errors };
    }
    say('Freeze failed. Nothing was saved. Try again.');
    return {};
  }
}

export async function copyPackLink(version: Version): Promise<void> {
  if (!version.packUrl) return;
  await navigator.clipboard.writeText(version.packUrl).catch(() => undefined);
  say('Link copied.');
}

export async function regenerateLink(version: Version): Promise<void> {
  await post(`/api/versions/${version.id}/link`);
  await loadVersions();
  say('New link made. The old link no longer works.');
}

export async function revokeLink(version: Version): Promise<void> {
  await del(`/api/versions/${version.id}/link`);
  await loadVersions();
  say('Link revoked.');
}

/** Restores a frozen version as one new change; every open editor redraws the room in place. */
export async function restoreVersion(version: Version): Promise<void> {
  const { roomId } = editor.get();
  try {
    const restored = await post<Restored>(`/api/rooms/${roomId}/restore`, { versionId: version.id });
    editor.set((s) => ({
      room: restored.room, placements: restored.placements, nodes: restored.nodes, sceneOrder: restored.sceneOrder,
      rooms: s.rooms.map((r) => (r.id === restored.room.id ? restored.room : r)),
      selectedId: restored.placements.some((p) => p.id === s.selectedId) ? s.selectedId : null,
    }));
    say(`Restored v${version.number} as change ${restored.revision}.`);
  } catch (error) {
    if (!(error instanceof ApiFailure)) throw error;
    if (error.code === 'prop_missing') say("A prop from that version is no longer in the library. Nothing was restored.");
    else if (error.code === 'playtest_running') say(EDITS_PAUSED);
    else say('Restore failed. Nothing was changed.');
  }
}
