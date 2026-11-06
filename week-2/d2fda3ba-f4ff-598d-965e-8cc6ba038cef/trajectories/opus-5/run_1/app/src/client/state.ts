import type { CandidateNote } from '../shared/boundary';
import { analyseGraph, MAX_HOP } from '../shared/boundary';
import type { NotePlaintext } from '../shared/envelope';
import { SAMPLE_CASE } from '../shared/sample';
import { formatDisplayTime } from '../shared/time';
import { ApiError, NetworkError, api, type Account, type Device, type Dossier, type Plans, type Revision } from './api';
import { COPY } from './copy';
import { createVaultKey, newId, newIdempotencyKey, openNote, sealNote, unwrapVaultKey } from './crypto';
import { localStore, type StoredNote, type StoredNotebook, type StoredQueueItem } from './db';

export const LOCAL_NOTEBOOK_ID = 'local';
export const LOCAL_NOTEBOOK_NAME = 'Local notebook';

export type Badge = 'local only' | 'pending' | 'synced' | 'conflict' | 'sync error' | 'paused';

export type Outage = 'none' | 'storage' | 'billing' | 'readonly';

export interface AppState {
  ready: boolean;
  online: boolean;
  deviceId: string | null;
  deviceName: string;
  account: Account | null;
  device: Device | null;
  devices: Device[];
  plans: Plans | null;
  notebooks: StoredNotebook[];
  notes: StoredNote[];
  queue: StoredQueueItem[];
  currentNotebookId: string;
  currentNoteId: string | null;
  editing: boolean;
  requestsInFlight: number;
  outage: Outage;
  accountStatus: string | null;
  accountError: string | null;
  accountFields: Record<string, string>;
  planStatus: string | null;
  vaultStatus: string | null;
  restoreStatus: string | null;
  publishStatus: string | null;
  previewStatus: string | null;
  previewUrl: string | null;
  dossiers: Dossier[];
  unlockVaultId: string | null;
  history: { noteId: string; revisions: Revision[] } | null;
  accountDialogOpen: boolean;
  railOpen: boolean;
  contextOpen: boolean;
  contextTab: 'backlinks' | 'history' | 'graph' | 'publish';
}

const initialState: AppState = {
  ready: false,
  online: true,
  deviceId: null,
  deviceName: 'This browser',
  account: null,
  device: null,
  devices: [],
  plans: null,
  notebooks: [],
  notes: [],
  queue: [],
  currentNotebookId: LOCAL_NOTEBOOK_ID,
  currentNoteId: null,
  editing: false,
  requestsInFlight: 0,
  outage: 'none',
  accountStatus: null,
  accountError: null,
  accountFields: {},
  planStatus: null,
  vaultStatus: null,
  restoreStatus: null,
  publishStatus: null,
  previewStatus: null,
  previewUrl: null,
  dossiers: [],
  unlockVaultId: null,
  history: null,
  accountDialogOpen: false,
  railOpen: false,
  contextOpen: false,
  contextTab: 'backlinks',
};

const PULL_INTERVAL_MS = 15000;
const RETRY_INTERVAL_MS = 10000;
const SAVE_DELAY_MS = 900;

function plaintextOf(note: StoredNote): NotePlaintext {
  return {
    title: note.title,
    aliases: note.aliases,
    frontmatter: note.frontmatter,
    body: note.body,
    private: note.private,
  };
}

export function candidateOf(note: StoredNote): CandidateNote {
  return {
    id: note.id,
    title: note.title,
    aliases: note.aliases,
    frontmatter: note.frontmatter,
    body: note.body,
    private: note.private,
  };
}

/** The notes the browser sends as publish candidates: non-private notes within hop 4 of the root. */
export function candidateNotes(notes: readonly StoredNote[], rootNoteId: string): CandidateNote[] {
  const all = notes.map(candidateOf);
  const graph = analyseGraph(all, rootNoteId);
  return all.filter((note) => !note.private && (graph.hops.get(note.id) ?? MAX_HOP + 1) <= MAX_HOP);
}

export class CairnStore {
  private state: AppState = initialState;
  private readonly listeners = new Set<() => void>();
  private readonly vaultKeys = new Map<string, CryptoKey>();
  private readonly saveTimers = new Map<string, number>();
  private readonly notesByNotebook = new Map<string, { source: StoredNote[]; result: StoredNote[] }>();
  private pushing = false;
  private retryTimer: number | null = null;
  private approvalPoll: number | null = null;

  getState = (): AppState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private patchNote(noteId: string, patch: Partial<StoredNote>, persist = true): StoredNote | null {
    let updated: StoredNote | null = null;
    const notes = this.state.notes.map((note) => {
      if (note.id !== noteId) return note;
      updated = { ...note, ...patch };
      return updated;
    });
    if (!updated) return null;
    this.set({ notes });
    if (persist) void localStore.notes.put(updated);
    return updated;
  }

  note(noteId: string | null): StoredNote | null {
    return this.state.notes.find((note) => note.id === noteId) ?? null;
  }

  notebook(notebookId: string): StoredNotebook | null {
    return this.state.notebooks.find((book) => book.id === notebookId) ?? null;
  }

  currentNotebook(): StoredNotebook | null {
    return this.notebook(this.state.currentNotebookId);
  }

  /** Notes of one notebook, sorted by title. The result keeps its identity until notes change. */
  notesOf(notebookId: string): StoredNote[] {
    const cached = this.notesByNotebook.get(notebookId);
    if (cached && cached.source === this.state.notes) return cached.result;
    const result = this.state.notes
      .filter((note) => note.notebookId === notebookId)
      .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    this.notesByNotebook.set(notebookId, { source: this.state.notes, result });
    return result;
  }

  queuedCount(): number {
    return this.state.queue.length;
  }

  hasVaultKey(vaultId: string): boolean {
    return this.vaultKeys.has(vaultId);
  }

  // ---------------------------------------------------------------- lifecycle

  async init(): Promise<void> {
    const [notes, notebooks, queue] = await Promise.all([
      localStore.notes.all(),
      localStore.notebooks.all(),
      localStore.queue.all(),
    ]);

    let deviceId = await localStore.meta.get<string>('deviceId');
    const deviceName = (await localStore.meta.get<string>('deviceName')) ?? this.guessDeviceName();
    const currentNoteId = await localStore.meta.get<string>('currentNoteId');
    const currentNotebookId = (await localStore.meta.get<string>('currentNotebookId')) ?? LOCAL_NOTEBOOK_ID;

    if (notebooks.length === 0) {
      const local: StoredNotebook = {
        id: LOCAL_NOTEBOOK_ID,
        name: LOCAL_NOTEBOOK_NAME,
        vaultId: null,
        role: null,
        cursor: 0,
      };
      notebooks.push(local);
      await localStore.notebooks.put(local);
    }

    for (const vaultId of notebooks.filter((book) => book.vaultId).map((book) => book.vaultId as string)) {
      const key = await localStore.meta.get<CryptoKey>(`vaultKey:${vaultId}`);
      if (key) this.vaultKeys.set(vaultId, key);
    }

    this.set({
      notes,
      notebooks,
      queue,
      deviceId,
      deviceName,
      currentNotebookId: notebooks.some((book) => book.id === currentNotebookId)
        ? currentNotebookId
        : LOCAL_NOTEBOOK_ID,
      currentNoteId: notes.some((note) => note.id === currentNoteId) ? currentNoteId : null,
      online: navigator.onLine,
      ready: true,
    });

    window.addEventListener('online', () => {
      this.set({ online: true });
      void this.syncNow();
    });
    window.addEventListener('offline', () => this.set({ online: false }));
    window.addEventListener('focus', () => void this.pullAll());
    window.setInterval(() => {
      if (document.visibilityState === 'visible') void this.pullAll();
    }, PULL_INTERVAL_MS);

    try {
      const me = await api.me();
      deviceId = me.device.id;
      await localStore.meta.set('deviceId', me.device.id);
      this.set({
        account: me.account,
        device: me.device,
        deviceId: me.device.id,
        deviceName: me.device.name,
        accountStatus: COPY.account.signedIn(me.account.email),
      });
      await this.refreshAccountData();
    } catch {
      // Signed out, or offline: the local notebook works either way.
    }
    this.startApprovalPolling();
    void this.pumpQueue();
  }

  private guessDeviceName(): string {
    const agent = navigator.userAgent;
    if (/Android|iPhone|iPad|Mobile/.test(agent)) return 'Phone browser';
    return 'Laptop browser';
  }

  private startApprovalPolling(): void {
    if (this.approvalPoll !== null) return;
    this.approvalPoll = window.setInterval(() => {
      if (!this.state.account || this.state.device?.approved !== false) return;
      void api
        .me()
        .then(async (me) => {
          if (!me.device.approved) return;
          this.set({ device: me.device });
          await this.refreshAccountData();
        })
        .catch(() => undefined);
    }, 5000);
  }

  async refreshAccountData(): Promise<void> {
    if (!this.state.account) return;
    const results = await Promise.allSettled([api.vaults(), api.billing(), api.devices(), api.dossiers()]);
    const [vaults, billing, devices, dossiers] = results;

    if (billing.status === 'fulfilled') {
      this.set({ plans: billing.value, outage: this.state.outage === 'billing' ? 'none' : this.state.outage });
    } else if (billing.reason instanceof ApiError && billing.reason.failure.code === 'billing_unavailable') {
      this.set({ outage: 'billing' });
    }
    if (devices.status === 'fulfilled') this.set({ devices: devices.value.devices });
    if (dossiers.status === 'fulfilled') this.set({ dossiers: dossiers.value.dossiers });

    if (vaults.status === 'fulfilled') {
      const notebooks = [...this.state.notebooks];
      for (const vault of vaults.value.vaults) {
        if (notebooks.some((book) => book.vaultId === vault.id)) continue;
        const notebook: StoredNotebook = {
          id: vault.id,
          name: vault.name,
          vaultId: vault.id,
          role: vault.role,
          cursor: 0,
        };
        notebooks.push(notebook);
        await localStore.notebooks.put(notebook);
      }
      this.set({ notebooks });
      const locked = notebooks
        .filter((book) => book.vaultId && !this.vaultKeys.has(book.vaultId))
        .map((book) => book.vaultId as string);
      // An unapproved device cannot fetch a vault key, so it waits for approval first.
      const canUnlock = this.state.device?.approved === true;
      this.set({ unlockVaultId: canUnlock ? (this.state.unlockVaultId ?? locked[0] ?? null) : null });
      await this.pullAll();
    }
  }

  // ------------------------------------------------------------------- notes

  selectNotebook(notebookId: string): void {
    const notebook = this.notebook(notebookId);
    this.set({ currentNotebookId: notebookId });
    void localStore.meta.set('currentNotebookId', notebookId);
    if (notebook?.vaultId && !this.vaultKeys.has(notebook.vaultId)) {
      this.set({ unlockVaultId: notebook.vaultId });
      return;
    }
    const first = this.notesOf(notebookId)[0] ?? null;
    this.selectNote(first?.id ?? null);
  }

  selectNote(noteId: string | null): void {
    this.set({ currentNoteId: noteId, history: null, restoreStatus: null });
    void localStore.meta.set('currentNoteId', noteId);
    if (noteId && this.state.contextTab === 'history') void this.loadHistory(noteId);
  }

  setEditing(editing: boolean): void {
    this.set({ editing });
  }

  setContextTab(tab: AppState['contextTab']): void {
    this.set({ contextTab: tab });
    if (tab === 'history' && this.state.currentNoteId) void this.loadHistory(this.state.currentNoteId);
  }

  /** Closing a drawer or sheet hands focus back to the button that opened it. */
  setRailOpen(open: boolean): void {
    this.set({ railOpen: open });
    if (!open) document.getElementById('files-button')?.focus();
  }

  setContextOpen(open: boolean): void {
    this.set({ contextOpen: open });
    if (!open) document.getElementById('context-button')?.focus();
  }

  setAccountDialogOpen(open: boolean): void {
    this.set({ accountDialogOpen: open, accountError: null, accountFields: {} });
  }

  createNote(): StoredNote {
    const notebook = this.currentNotebook();
    const note: StoredNote = {
      id: newId(),
      notebookId: this.state.currentNotebookId,
      title: '',
      aliases: [],
      frontmatter: {},
      body: '',
      private: false,
      updatedAt: Date.now(),
      serverRev: null,
      badge: notebook?.vaultId ? 'pending' : 'local only',
      rejection: null,
      conflictNotice: false,
      conflictCopyId: null,
      isConflictCopy: false,
    };
    this.set({ notes: [...this.state.notes, note], currentNoteId: note.id, editing: true });
    void localStore.notes.put(note);
    if (notebook?.vaultId) this.scheduleSave(note.id);
    return note;
  }

  /** Edits save to the device about a second after the last keystroke, then queue a revision. */
  editNote(noteId: string, patch: Partial<Pick<StoredNote, 'title' | 'body' | 'private' | 'aliases'>>): void {
    const note = this.note(noteId);
    if (!note) return;
    const updated = this.patchNote(
      noteId,
      { ...patch, updatedAt: Date.now(), badge: note.badge === 'local only' ? 'local only' : 'pending' },
      false,
    );
    if (!updated) return;
    this.scheduleSave(noteId);
  }

  private scheduleSave(noteId: string): void {
    const existing = this.saveTimers.get(noteId);
    if (existing) window.clearTimeout(existing);
    this.saveTimers.set(
      noteId,
      window.setTimeout(() => {
        this.saveTimers.delete(noteId);
        const note = this.note(noteId);
        if (!note) return;
        void localStore.notes.put(note);
        const notebook = this.notebook(note.notebookId);
        if (notebook?.vaultId) void this.queueRevision(note, notebook.vaultId);
      }, SAVE_DELAY_MS),
    );
  }

  private async queueRevision(note: StoredNote, vaultId: string): Promise<void> {
    const item: StoredQueueItem = {
      id: newId(),
      vaultId,
      notebookId: note.notebookId,
      noteId: note.id,
      baseRevision: note.serverRev,
      plaintext: plaintextOf(note),
      idempotencyKey: newIdempotencyKey(),
      createdAt: Date.now(),
    };
    const queue = [...this.state.queue.filter((queued) => queued.noteId !== note.id), item];
    for (const dropped of this.state.queue.filter((queued) => queued.noteId === note.id)) {
      await localStore.queue.remove(dropped.id);
    }
    this.set({ queue });
    this.patchNote(note.id, { badge: 'pending' });
    await localStore.queue.put(item);
    void this.pumpQueue();
  }

  async loadSampleCase(): Promise<void> {
    const notebookId = this.state.currentNotebookId;
    const notebook = this.notebook(notebookId);
    const notes: StoredNote[] = SAMPLE_CASE.map((sample) => ({
      id: newId(),
      notebookId,
      title: sample.title,
      aliases: [...sample.aliases],
      frontmatter: { ...sample.frontmatter },
      body: sample.body,
      private: sample.private,
      updatedAt: Date.now(),
      serverRev: null,
      badge: notebook?.vaultId ? 'pending' : 'local only',
      rejection: null,
      conflictNotice: false,
      conflictCopyId: null,
      isConflictCopy: false,
    }));
    this.set({ notes: [...this.state.notes, ...notes], currentNoteId: notes[0]?.id ?? null, editing: false });
    for (const note of notes) await localStore.notes.put(note);
    if (notebook?.vaultId) {
      for (const note of notes) await this.queueRevision(note, notebook.vaultId);
    }
  }

  dismissConflict(noteId: string): void {
    this.patchNote(noteId, { conflictNotice: false, badge: 'synced' });
  }

  // ------------------------------------------------------------------ account

  async createAccount(input: {
    email: string;
    password: string;
    display_name: string;
    device_name: string;
  }): Promise<void> {
    this.set({ accountStatus: COPY.account.creating, accountError: null, accountFields: {} });
    try {
      const answer = await api.createAccount({
        ...input,
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await localStore.meta.set('deviceId', answer.device.id);
      await localStore.meta.set('deviceName', answer.device.name);
      this.set({
        account: answer.account,
        device: answer.device,
        deviceId: answer.device.id,
        deviceName: answer.device.name,
        accountStatus: COPY.account.created,
      });
      await this.refreshAccountData();
    } catch (error) {
      this.reportAccountError(error);
    }
  }

  async signIn(input: { email: string; password: string; device_name: string }): Promise<void> {
    this.set({ accountStatus: COPY.account.signingIn, accountError: null, accountFields: {} });
    try {
      const answer = await api.signIn({ ...input, device_id: this.state.deviceId });
      await localStore.meta.set('deviceId', answer.device.id);
      await localStore.meta.set('deviceName', answer.device.name);
      this.set({
        account: answer.account,
        device: answer.device,
        deviceId: answer.device.id,
        deviceName: answer.device.name,
        accountStatus: COPY.account.signedIn(answer.account.email),
      });
      await this.refreshAccountData();
    } catch (error) {
      this.reportAccountError(error);
    }
  }

  private reportAccountError(error: unknown): void {
    if (error instanceof ApiError) {
      if (error.failure.code === 'invalid_credentials') {
        this.set({ accountStatus: null, accountError: COPY.account.wrongCredentials, accountFields: {} });
        return;
      }
      this.set({
        accountStatus: null,
        accountError: error.failure.message,
        accountFields: error.failure.fields ?? {},
      });
      return;
    }
    this.set({ accountStatus: null, accountError: 'Could not reach Cairn. Try again shortly.' });
  }

  async signOut(): Promise<void> {
    await api.signOut().catch(() => undefined);
    this.set({
      account: null,
      device: null,
      devices: [],
      plans: null,
      dossiers: [],
      accountStatus: null,
      accountDialogOpen: false,
    });
  }

  async changePlan(addon: 'sync' | 'publish', action: 'add' | 'cancel'): Promise<void> {
    this.set({ planStatus: COPY.plan.pending });
    try {
      const plans = action === 'add' ? await api.addAddon(addon) : await api.cancelAddon(addon);
      this.set({ plans, planStatus: null, outage: this.state.outage === 'billing' ? 'none' : this.state.outage });
    } catch (error) {
      if (error instanceof ApiError && error.failure.code === 'billing_unavailable') {
        this.set({ planStatus: COPY.plan.billingOutage });
        return;
      }
      this.set({ planStatus: error instanceof ApiError ? error.failure.message : COPY.plan.billingOutage });
    }
  }

  planLine(addon: 'sync' | 'publish'): string | null {
    const plan = addon === 'sync' ? this.state.plans?.sync : this.state.plans?.publish;
    if (!plan) return null;
    const zone = this.state.account?.time_zone ?? 'UTC';
    if (plan.state === 'active') return addon === 'sync' ? COPY.plan.syncActive : COPY.plan.publishActive;
    if (plan.state === 'none') return addon === 'sync' ? 'Sync not added' : 'Publish not added';
    const deadline = addon === 'sync' ? plan.period_end : plan.period_end;
    const when = deadline ? formatDisplayTime(new Date(deadline), zone) : '';
    return addon === 'sync' ? COPY.plan.syncEnds(when) : COPY.plan.publishEnds(when);
  }

  // -------------------------------------------------------------------- vault

  async createVault(passphrase: string): Promise<void> {
    const notebook = this.currentNotebook();
    if (!notebook) return;
    this.set({ vaultStatus: COPY.vault.creating });
    try {
      const { key, envelope } = await createVaultKey(passphrase);
      const answer = await api.createVault({
        name: notebook.name === LOCAL_NOTEBOOK_NAME ? 'Case vault' : notebook.name,
        key_envelope: envelope,
      });
      this.vaultKeys.set(answer.vault.id, key);
      await localStore.meta.set(`vaultKey:${answer.vault.id}`, key);
      const updated: StoredNotebook = {
        ...notebook,
        name: answer.vault.name,
        vaultId: answer.vault.id,
        role: 'owner',
      };
      await localStore.notebooks.put(updated);
      this.set({
        notebooks: this.state.notebooks.map((book) => (book.id === notebook.id ? updated : book)),
        vaultStatus: COPY.vault.created,
      });
      for (const note of this.notesOf(notebook.id)) {
        this.patchNote(note.id, { serverRev: null, badge: 'pending' });
        await this.queueRevision({ ...note, serverRev: null }, answer.vault.id);
      }
      await this.refreshAccountData();
    } catch (error) {
      this.set({ vaultStatus: error instanceof ApiError ? error.failure.message : 'Could not create the vault.' });
    }
  }

  async unlockVault(vaultId: string, passphrase: string): Promise<boolean> {
    try {
      const answer = await api.vault(vaultId);
      const key = await unwrapVaultKey(answer.key_envelope, passphrase);
      this.vaultKeys.set(vaultId, key);
      await localStore.meta.set(`vaultKey:${vaultId}`, key);
      this.set({ unlockVaultId: null, vaultStatus: null, currentNotebookId: vaultId });
      await localStore.meta.set('currentNotebookId', vaultId);
      await this.pullAll();
      const first = this.notesOf(vaultId)[0] ?? null;
      this.selectNote(first?.id ?? null);
      return true;
    } catch {
      this.set({ vaultStatus: COPY.vault.wrongPassphrase });
      return false;
    }
  }

  dismissUnlock(): void {
    this.set({ unlockVaultId: null });
  }

  openUnlock(vaultId: string): void {
    this.set({ unlockVaultId: vaultId, vaultStatus: null });
  }

  async invitePartner(email: string): Promise<void> {
    const notebook = this.currentNotebook();
    if (!notebook?.vaultId) return;
    try {
      await api.invite(notebook.vaultId, email);
      this.set({ vaultStatus: COPY.vault.inviteCreated(email) });
    } catch (error) {
      this.set({ vaultStatus: error instanceof ApiError ? error.failure.message : 'Could not send the invite.' });
    }
  }

  // --------------------------------------------------------------------- sync

  async syncNow(): Promise<void> {
    await this.pullAll();
    await this.pumpQueue();
  }

  private vaultNotebooks(): StoredNotebook[] {
    return this.state.notebooks.filter((book) => book.vaultId && this.vaultKeys.has(book.vaultId));
  }

  async pullAll(): Promise<void> {
    if (!this.state.account || this.state.device?.approved === false) return;
    for (const notebook of this.vaultNotebooks()) await this.pullVault(notebook);
  }

  private async pullVault(notebook: StoredNotebook): Promise<void> {
    const vaultId = notebook.vaultId;
    const key = vaultId ? this.vaultKeys.get(vaultId) : null;
    if (!vaultId || !key) return;

    this.set({ requestsInFlight: this.state.requestsInFlight + 1 });
    try {
      const answer = await api.revisions(vaultId, notebook.cursor);
      for (const revision of answer.revisions) await this.applyRevision(notebook, revision, key);
      if (answer.next_after !== notebook.cursor) {
        const updated = { ...this.notebook(notebook.id), ...notebook, cursor: answer.next_after };
        await localStore.notebooks.put(updated);
        this.set({ notebooks: this.state.notebooks.map((book) => (book.id === notebook.id ? updated : book)) });
      }
      if (this.state.outage === 'storage') this.set({ outage: 'none' });
    } catch (error) {
      this.noteOutage(error, null);
    } finally {
      this.set({ requestsInFlight: Math.max(0, this.state.requestsInFlight - 1) });
    }
  }

  private async applyRevision(notebook: StoredNotebook, revision: Revision, key: CryptoKey): Promise<void> {
    const vaultId = notebook.vaultId;
    if (!vaultId) return;
    const queued = this.state.queue.some((item) => item.noteId === revision.note_id);
    const existing = this.note(revision.note_id);
    if (queued) return;

    const blob = await api.blob(vaultId, revision.rev);
    const plaintext = await openNote(key, blob);
    const shared = {
      title: plaintext.title,
      aliases: plaintext.aliases,
      frontmatter: plaintext.frontmatter,
      body: plaintext.body,
      private: plaintext.private,
      serverRev: revision.rev,
      badge: 'synced' as Badge,
      rejection: null,
      updatedAt: Date.now(),
    };
    if (existing) {
      this.patchNote(existing.id, shared);
      return;
    }
    const note: StoredNote = {
      id: revision.note_id,
      notebookId: notebook.id,
      conflictNotice: false,
      conflictCopyId: null,
      isConflictCopy: false,
      ...shared,
    };
    this.set({ notes: [...this.state.notes, note] });
    await localStore.notes.put(note);
    if (!this.state.currentNoteId) this.selectNote(note.id);
  }

  /** Pushes queued revisions one at a time, in the order they were saved. */
  async pumpQueue(): Promise<void> {
    if (this.pushing) return;
    if (!this.state.account || this.state.device?.approved === false) return;
    this.pushing = true;
    try {
      for (;;) {
        const item = [...this.state.queue].sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!item) {
          if (this.state.outage !== 'readonly') this.set({ outage: 'none' });
          return;
        }
        const key = this.vaultKeys.get(item.vaultId);
        if (!key) return;
        const sealed = await sealNote(key, item.plaintext);

        this.set({ requestsInFlight: this.state.requestsInFlight + 1 });
        try {
          const answer = await api.push(
            item.vaultId,
            item.noteId,
            { base_revision: item.baseRevision, ...sealed },
            item.idempotencyKey,
          );
          await this.acknowledge(item, answer.revision.rev);
          this.set({ outage: 'none' });
        } catch (error) {
          const stop = await this.handlePushFailure(item, error);
          if (stop) return;
        } finally {
          this.set({ requestsInFlight: Math.max(0, this.state.requestsInFlight - 1) });
        }
      }
    } finally {
      this.pushing = false;
    }
  }

  private async acknowledge(item: StoredQueueItem, rev: number): Promise<void> {
    const queue = this.state.queue.filter((queued) => queued.id !== item.id);
    this.set({ queue });
    await localStore.queue.remove(item.id);
    const stillQueued = queue.some((queued) => queued.noteId === item.noteId);
    this.patchNote(item.noteId, {
      serverRev: rev,
      badge: stillQueued ? 'pending' : 'synced',
      rejection: null,
    });
    const notebook = this.state.notebooks.find((book) => book.vaultId === item.vaultId);
    if (notebook && rev > notebook.cursor) {
      const updated = { ...notebook, cursor: rev };
      await localStore.notebooks.put(updated);
      this.set({ notebooks: this.state.notebooks.map((book) => (book.id === notebook.id ? updated : book)) });
    }
  }

  /** Returns true when the push loop should stop until the next retry. */
  private async handlePushFailure(item: StoredQueueItem, error: unknown): Promise<boolean> {
    if (error instanceof ApiError && error.failure.code === 'revision_conflict') {
      await this.resolveConflict(item, error.failure.head_revision ?? null);
      return false;
    }
    if (error instanceof ApiError && error.status === 422) {
      this.patchNote(item.noteId, { badge: 'sync error', rejection: error.failure.message });
      this.set({ queue: this.state.queue.filter((queued) => queued.id !== item.id) });
      await localStore.queue.remove(item.id);
      return false;
    }
    if (error instanceof ApiError && (error.status === 402 || error.status === 403)) {
      this.patchNote(item.noteId, { badge: 'sync error', rejection: error.failure.message });
      this.set({ outage: error.failure.code === 'vault_read_only' ? 'readonly' : this.state.outage });
      this.scheduleRetry();
      return true;
    }
    this.noteOutage(error, item.noteId);
    this.scheduleRetry();
    return true;
  }

  private noteOutage(error: unknown, noteId: string | null): void {
    if (error instanceof ApiError && error.failure.code === 'storage_unavailable') {
      this.set({ outage: 'storage' });
      if (noteId) this.patchNote(noteId, { badge: 'paused' });
      return;
    }
    if (error instanceof ApiError && error.failure.code === 'billing_unavailable') {
      this.set({ outage: 'billing' });
      if (noteId) this.patchNote(noteId, { badge: 'paused' });
      return;
    }
    if (error instanceof NetworkError) {
      if (noteId) this.patchNote(noteId, { badge: 'pending' });
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.syncNow();
    }, RETRY_INTERVAL_MS);
  }

  private async resolveConflict(item: StoredQueueItem, head: number | null): Promise<void> {
    const original = this.note(item.noteId);
    this.set({ queue: this.state.queue.filter((queued) => queued.noteId !== item.noteId) });
    for (const dropped of this.state.queue.filter((queued) => queued.noteId === item.noteId)) {
      await localStore.queue.remove(dropped.id);
    }
    await localStore.queue.remove(item.id);

    const notebook = this.state.notebooks.find((book) => book.vaultId === item.vaultId);
    const key = this.vaultKeys.get(item.vaultId);
    if (notebook && key && head) {
      const blob = await api.blob(item.vaultId, head).catch(() => null);
      if (blob) {
        const winner = await openNote(key, blob);
        this.patchNote(item.noteId, {
          title: winner.title,
          aliases: winner.aliases,
          frontmatter: winner.frontmatter,
          body: winner.body,
          private: winner.private,
          serverRev: head,
        });
      }
    }

    const copy: StoredNote = {
      id: newId(),
      notebookId: item.notebookId,
      title: COPY.conflict.copyTitle(original?.title ?? item.plaintext.title, this.state.deviceName),
      aliases: [],
      frontmatter: item.plaintext.frontmatter,
      body: item.plaintext.body,
      private: item.plaintext.private,
      updatedAt: Date.now(),
      serverRev: null,
      badge: 'pending',
      rejection: null,
      conflictNotice: false,
      conflictCopyId: null,
      isConflictCopy: true,
    };
    this.set({ notes: [...this.state.notes, copy] });
    await localStore.notes.put(copy);
    this.patchNote(item.noteId, { badge: 'conflict', conflictNotice: true, conflictCopyId: copy.id });
    await this.queueRevision(copy, item.vaultId);
  }

  // ------------------------------------------------------------------ history

  async loadHistory(noteId: string): Promise<void> {
    const notebook = this.currentNotebook();
    if (!notebook?.vaultId) {
      this.set({ history: null });
      return;
    }
    try {
      const answer = await api.history(notebook.vaultId, noteId);
      this.set({ history: { noteId, revisions: answer.revisions } });
    } catch {
      this.set({ history: null });
    }
  }

  async restoreRevision(noteId: string, rev: number): Promise<void> {
    const notebook = this.currentNotebook();
    const note = this.note(noteId);
    if (!notebook?.vaultId || !note) return;
    this.set({ restoreStatus: COPY.restore.pending(rev) });
    try {
      const answer = await api.restore(
        notebook.vaultId,
        noteId,
        { revision: rev, base_revision: note.serverRev ?? 0 },
        newIdempotencyKey(),
      );
      const key = this.vaultKeys.get(notebook.vaultId);
      if (key) {
        const blob = await api.blob(notebook.vaultId, answer.revision.rev);
        const plaintext = await openNote(key, blob);
        this.patchNote(noteId, {
          title: plaintext.title,
          aliases: plaintext.aliases,
          frontmatter: plaintext.frontmatter,
          body: plaintext.body,
          private: plaintext.private,
          serverRev: answer.revision.rev,
          badge: 'synced',
        });
      }
      this.set({ restoreStatus: COPY.restore.success(rev, answer.revision.rev) });
      await this.loadHistory(noteId);
    } catch (error) {
      if (error instanceof ApiError && error.failure.code === 'revision_conflict') {
        this.set({ restoreStatus: COPY.restore.conflict });
        await this.pullAll();
        await this.loadHistory(noteId);
        return;
      }
      if (error instanceof ApiError && error.failure.code === 'storage_unavailable') {
        this.set({ restoreStatus: COPY.restore.storage, outage: 'storage' });
        return;
      }
      this.set({ restoreStatus: error instanceof ApiError ? error.failure.message : COPY.restore.storage });
    }
  }

  // ----------------------------------------------------------------- dossiers

  async createDossier(slug: string, rootNoteId: string): Promise<Dossier | null> {
    try {
      const answer = await api.createDossier({ slug, root_note_id: rootNoteId });
      this.set({ dossiers: [...this.state.dossiers, answer.dossier], publishStatus: null });
      return answer.dossier;
    } catch (error) {
      if (error instanceof ApiError) {
        this.set({
          publishStatus:
            error.failure.code === 'publish_not_entitled'
              ? COPY.publish.notEntitled
              : (error.failure.fields?.slug ?? error.failure.message),
        });
      }
      return null;
    }
  }

  replaceDossier(dossier: Dossier): void {
    this.set({
      dossiers: this.state.dossiers.some((entry) => entry.id === dossier.id)
        ? this.state.dossiers.map((entry) => (entry.id === dossier.id ? dossier : entry))
        : [...this.state.dossiers, dossier],
    });
  }

  setPublishStatus(status: string | null): void {
    this.set({ publishStatus: status });
  }

  setPreview(status: string | null, url: string | null): void {
    this.set({ previewStatus: status, previewUrl: url });
  }

  async refreshDossiers(): Promise<void> {
    const answer = await api.dossiers().catch(() => null);
    if (answer) this.set({ dossiers: answer.dossiers });
  }
}

export const store = new CairnStore();
