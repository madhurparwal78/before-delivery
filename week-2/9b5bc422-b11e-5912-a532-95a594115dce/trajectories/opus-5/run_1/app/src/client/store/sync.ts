import { announce, notices as noticeCopy } from '../../domain/copy.ts';
import { textOf } from '../../domain/blocks.ts';
import type { Op, StoredOp } from '../../domain/types.ts';
import { allFiles, putFile, readMeta, writeMeta } from './local.ts';
import {
  announce as say,
  forgetDocuments,
  markOps,
  notice,
  onSyncPoke,
  setFile,
  setSyncMode,
  snapshot,
  syncing,
  takeRemoteOps,
  update,
} from './store.ts';

type Json = Record<string, unknown>;

export type ApiResult = { status: number; body: Json; reachable: boolean };

export async function api(path: string, init: RequestInit = {}): Promise<ApiResult> {
  if (!navigator.onLine) return { status: 0, body: {}, reachable: false };
  try {
    const response = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
    const text = await response.text();
    const body = text ? (JSON.parse(text) as Json) : {};
    return { status: response.status, body, reachable: true };
  } catch {
    return { status: 0, body: {}, reachable: false };
  }
}

let lastSeq = 0;
let uploading = false;
let pokeTimer: number | null = null;
let ticking = false;

async function handleRemoval(): Promise<void> {
  const state = snapshot();
  if (!state.account) return;
  await writeMeta('account', null);
  await setSyncMode('off', state.choiceMade);
  update({ account: null });
  notice(noticeCopy.deviceRemoved);
}

async function readSession(): Promise<void> {
  const cached = (await readMeta<{ user: { id: string; email: string }; device: { id: string; name: string } }>(
    'account',
  )) ?? null;
  if (cached) update({ account: cached });
  const result = await api('/api/session');
  if (!result.reachable || result.status === 503) return;
  if (result.body.user) {
    const account = result.body as unknown as { user: { id: string; email: string }; device: { id: string; name: string } };
    await writeMeta('account', account);
    update({ account });
    const choiceAccount = await readMeta<string>('choiceAccount');
    if (choiceAccount !== account.user.email) {
      await setSyncMode('off', false);
      update({ uploadDialogOpen: true });
    }
    return;
  }
  if (cached) await handleRemoval();
}

function pendingOps(): StoredOp[] {
  return snapshot().ops.filter((op) => op.status !== 'confirmed');
}

async function pushOnce(): Promise<void> {
  const state = snapshot();
  const waiting = pendingOps();
  const sendable = waiting.map(({ status, ...op }) => op as Op);
  await markOps(new Set(waiting.map((op) => op.id)), 'sent');

  const result = await api('/api/sync/push', {
    method: 'POST',
    body: JSON.stringify({
      ops: sendable,
      since: lastSeq,
      deletedForever: [...state.deletedForever],
    }),
  });

  if (result.status === 401) {
    await handleRemoval();
    return;
  }
  if (!result.reachable || result.status !== 200) {
    update({ serviceAvailable: false });
    return;
  }

  const body = result.body as unknown as {
    accepted: { id: string; seq: number }[];
    droppedDocuments: string[];
    tombstones: string[];
    storedAttachments: string[];
    ops: Op[];
    seq: number;
  };

  const seqs = new Map(body.accepted.map((entry) => [entry.id, entry.seq]));
  await markOps(new Set(seqs.keys()), 'confirmed', seqs);
  await takeRemoteOps(body.ops.map((op) => ({ ...op, status: 'confirmed' as const })));
  lastSeq = body.seq;
  await writeMeta('lastSeq', lastSeq);
  await noteRemovedDocuments(body.tombstones);
  await markStored(body.storedAttachments);
  update({ serviceAvailable: true });
}

async function noteRemovedDocuments(tombstones: string[]): Promise<void> {
  const state = snapshot();
  const here = tombstones.filter((documentId) => state.workspace.documents.has(documentId));
  if (!here.length) return;
  for (const documentId of here) {
    const document = state.workspace.documents.get(documentId);
    const hadEdits = state.ops.some(
      (op) => !op.seed && op.status !== 'confirmed' && documentOfOp(op) === documentId,
    );
    if (document && hadEdits) notice(noticeCopy.deletedElsewhere(textOf(document.title)));
  }
  await forgetDocuments(here);
}

function documentOfOp(op: StoredOp): string | null {
  const workspace = snapshot().workspace;
  if (op.entity === 'document') return op.entityId;
  if (op.entity === 'block') return workspace.blocks.get(op.entityId)?.documentId ?? null;
  if (op.entity === 'note') return workspace.notes.get(op.entityId)?.documentId ?? null;
  if (op.entity === 'connector') return workspace.connectors.get(op.entityId)?.documentId ?? null;
  if (op.entity === 'attachment') return workspace.attachments.get(op.entityId)?.documentId ?? null;
  return null;
}

async function markStored(ids: string[]): Promise<void> {
  const known = new Set(ids);
  for (const file of await allFiles()) {
    if (file.state === 'waiting' && known.has(file.id)) {
      const stored = { ...file, state: 'stored' as const };
      await putFile(stored);
      await setFile(stored);
    }
  }
}

async function sendFiles(): Promise<void> {
  const state = snapshot();
  for (const file of await allFiles()) {
    if (file.state !== 'waiting') continue;
    const attachment = state.workspace.attachments.get(file.id);
    if (!attachment) continue;
    let response: Response;
    try {
      response = await fetch(`/api/attachments/${file.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': file.contentType || 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
          'X-Document-Id': attachment.documentId,
        },
        body: file.bytes,
      });
    } catch {
      return;
    }
    if (response.status === 200 || response.status === 201) {
      const stored = { ...file, state: 'stored' as const };
      await putFile(stored);
      await setFile(stored);
      say(announce.attachmentStored(file.name));
      continue;
    }
    if (response.status === 413 || response.status === 507) {
      const refused = {
        ...file,
        state: 'refused' as const,
        refusal: response.status === 413 ? ('too-large' as const) : ('account-full' as const),
      };
      await putFile(refused);
      await setFile(refused);
      say(announce.attachmentRefused(file.name));
      continue;
    }
    return;
  }
}

async function readStatus(): Promise<void> {
  const result = await api('/api/status');
  if (!result.reachable) {
    update({ serviceAvailable: false, storageAvailable: false });
    return;
  }
  update({
    serviceAvailable: result.body.sync === 'ok',
    storageAvailable: result.body.storage === 'ok',
  });
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    if (syncing()) await markOps(new Set(pendingOps().map((op) => op.id)), 'sent');
    if (!navigator.onLine) {
      update({ online: false });
      return;
    }
    await readStatus();
    if (!syncing()) return;
    await pushOnce();
    await sendFiles();
    if (uploading && !pendingOps().length) {
      uploading = false;
      say(announce.uploadFinished);
    }
  } finally {
    ticking = false;
  }
}

export function poke(): void {
  if (pokeTimer !== null) return;
  pokeTimer = window.setTimeout(() => {
    pokeTimer = null;
    void tick();
  }, 60);
}

export async function startSync(): Promise<void> {
  lastSeq = (await readMeta<number>('lastSeq')) ?? 0;
  onSyncPoke(poke);
  await readSession();
  void tick();
  window.setInterval(() => void tick(), 5000);
}

export const account = {
  async create(email: string, password: string): Promise<ApiResult> {
    const result = await api('/api/accounts', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (result.status === 201) await afterSignIn(result.body, email);
    return result;
  },

  async signIn(email: string, password: string): Promise<ApiResult> {
    const result = await api('/api/sessions', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (result.status === 200) await afterSignIn(result.body, email);
    return result;
  },

  async signOut(): Promise<void> {
    await api('/api/session', { method: 'DELETE' });
    await writeMeta('account', null);
    await setSyncMode('off', snapshot().choiceMade);
    update({ account: null, uploadDialogOpen: false });
    say(announce.signedOut);
  },

  async chooseUpload(): Promise<void> {
    const state = snapshot();
    if (state.account) await writeMeta('choiceAccount', state.account.user.email);
    uploading = true;
    await setSyncMode('on', true);
    update({ uploadDialogOpen: false });
    void tick();
  },

  async chooseKeep(): Promise<void> {
    const state = snapshot();
    if (state.account) await writeMeta('choiceAccount', state.account.user.email);
    await setSyncMode('off', true);
    update({ uploadDialogOpen: false });
    say(announce.keepChoice);
  },

  closeUploadDialog(): void {
    update({ uploadDialogOpen: false });
  },
};

async function afterSignIn(body: Json, email: string): Promise<void> {
  const value = body as unknown as { user: { id: string; email: string }; device: { id: string; name: string } };
  await writeMeta('account', value);
  lastSeq = 0;
  await writeMeta('lastSeq', 0);
  const choiceAccount = await readMeta<string>('choiceAccount');
  const sameAccount = choiceAccount === value.user.email;
  await setSyncMode(sameAccount && snapshot().choiceMade ? snapshot().syncMode : 'off', sameAccount);
  update({ account: value, uploadDialogOpen: !sameAccount });
  say(announce.signedIn(email.trim().toLowerCase()));
  void tick();
}

export const attachments = {
  async queue(file: File, documentId: string, attachmentId: string): Promise<void> {
    const tooLarge = file.size > 5_000_000;
    const stored = {
      id: attachmentId,
      name: file.name,
      size: file.size,
      contentType: file.type || 'application/octet-stream',
      state: tooLarge ? ('refused' as const) : ('waiting' as const),
      refusal: tooLarge ? ('too-large' as const) : null,
      bytes: file,
    };
    await putFile(stored);
    await setFile(stored);
    say(tooLarge ? announce.attachmentRefused(file.name) : announce.attachmentWaiting(file.name));
    poke();
  },
};

export const devices = {
  async list(): Promise<{ id: string; name: string; current: boolean; lastSeenAt: string }[]> {
    const result = await api('/api/devices');
    if (result.status !== 200) return [];
    return (result.body.devices as { id: string; name: string; current: boolean; lastSeenAt: string }[]) ?? [];
  },

  async remove(deviceId: string): Promise<ApiResult> {
    return api(`/api/devices/${deviceId}`, { method: 'DELETE' });
  },
};

export const share = {
  get: (documentId: string) => api(`/api/documents/${documentId}/share`),
  create: (documentId: string) => api(`/api/documents/${documentId}/share`, { method: 'POST', body: '{}' }),
  revoke: (documentId: string) => api(`/api/documents/${documentId}/share`, { method: 'DELETE' }),
};
