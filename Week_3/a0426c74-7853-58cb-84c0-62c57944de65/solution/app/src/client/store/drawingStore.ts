import { ApiFailure, answerJson, jsonInit, onRefusal } from '../api.ts';
import { CommandSession, eraseGroup, ownAnnouncement, remoteAnnouncement } from '../../shared/commands/index.ts';
import type { CommandEnv, CommandInput, CommandUpdate } from '../../shared/commands/index.ts';
import * as copy from '../../shared/copy.ts';
import { ApiError } from '../../shared/errors.ts';
import { buildScene, distance, dragGrip, gripsOf, screenToWorld, worldToScreen } from '../../shared/geometry/index.ts';
import type { View } from '../../shared/geometry/index.ts';
import { emptyDrawingState, parameterViews, stateFromDocument } from '../../shared/model/index.ts';
import { MINIMUM_ROLE, atLeast, editRefusal, isConflict, isDownloadable, isExportBusy } from '../../shared/rules.ts';
import type {
  DrawingDocument, DrawingListing, DrawingState, ExportJob, LiveMessage, OperationGroup, OperationsResponse, OpsMessage, Point, PresenceMessage,
  Role, Sheet,
} from '../../shared/types.ts';
import { LiveChannel } from './liveChannel.ts';
import type { LiveHandlers, LiveSocket } from './liveChannel.ts';
import { OfflineQueue } from './offlineQueue.ts';
import { operationGroup } from './operationGroup.ts';
import { Replica } from './replica.ts';
import type { PendingGroup } from './replica.ts';
import { SceneStore, initialSceneSnapshot } from './sceneStore.ts';
import type { DragHandler, SceneEnv } from './sceneStore.ts';
import type { DrawingSnapshot, GripView, LoadStatus, OpInput, RemoteCursor } from './types.ts';

/** What the store needs from its surroundings; the page supplies the real ones (`browserDeps`), the unit tests fakes. */
export interface DrawingDeps extends SceneEnv {
  /** the signed-in person: author of the groups made here */
  username: string;
  toast(text: string): void;
  /** the session is gone: go to the sign-in page */
  signIn(): void;
  fetch: typeof fetch;
  /** opens the live socket at this path on this origin */
  openSocket(path: string, handlers: LiveHandlers): LiveSocket;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  newId(): string;
}

/** A grip is a square drawn this many screen px each side of its point; a press inside the square grabs it. */
export const GRIP_HALF_PX = 4;
/** Grips are drawn for a selection of up to this many entities (a crossing window over thousands would otherwise add thousands of elements). */
const GRIP_LIMIT = 100;
/** Others see this many of a person's selected entities as rings; the cursor message carries no more, so a huge selection does not flood the channel. */
export const REMOTE_SELECTION_LIMIT = 200;
/** A grip moved less than this is not an edit. */
const GRIP_SLOP_PX = 3;

const LOAD_FAILURE: Readonly<Record<number, LoadStatus>> = { 401: 'unauthenticated', 404: 'not-found' };

interface RemoteView { zoom: number; panX: number; panY: number; width: number; height: number }

function initialSnapshot(state: DrawingState): DrawingSnapshot {
  return {
    ...initialSceneSnapshot(buildScene(state), 'loading'),
    info: null,
    state,
    parameters: [],
    sheets: [],
    canEdit: false,
    currentLayer: '0',
    connection: { phase: 'reconnecting', text: copy.CONNECTION_RECONNECTING, offline: false },
    pendingOps: 0,
    members: [],
    cursors: [],
    followed: null,
    command: { active: false, expects: 'command' },
    preview: [],
    xrefNotices: [],
    storageNotice: null,
    exportJob: null,
    folderDrawings: [],
  };
}

export class DrawingStore extends SceneStore<DrawingSnapshot> {
  readonly drawingId: string;
  private readonly deps: DrawingDeps;
  private readonly channel: LiveChannel;
  private readonly offlineQueue: OfflineQueue;
  private readonly session = new CommandSession();
  private replica: Replica;
  private offline = false;
  private flushing = false;
  /** while the queue is sent after working offline: the counts so far */
  private flushReport: { sent: number; conflicts: number } | null = null;
  /** the counts `Back online` reports once that queue was sent */
  private backOnline = { sent: 0, conflicts: 0 };
  private phone = false;
  private stagePrompt: string = copy.PROMPT_READY;
  private cursorAt: Point | null = null;
  private readonly remoteCursors = new Map<string, RemoteCursor>();
  private readonly remoteViews = new Map<string, RemoteView>();
  private readonly xrefAnnounced = new Map<string, string>();
  private readonly liveListeners = new Set<(message: LiveMessage) => void>();
  private closed = false;

  constructor(drawingId: string, deps: DrawingDeps) {
    const state = emptyDrawingState();
    super(initialSnapshot(state), deps);
    this.drawingId = drawingId;
    this.deps = deps;
    this.replica = new Replica(state, deps.username);
    this.offlineQueue = new OfflineQueue(deps.storage, drawingId, deps.username);
    this.channel = new LiveChannel(`/api/drawings/${drawingId}/live`, (path, handlers) => deps.openSocket(path, handlers), {
      opened: () => this.socketOpened(),
      lost: () => this.setPhase('reconnecting'),
      message: (message) => this.receive(message),
      resync: () => this.background(() => this.reload()),
    });
  }

  protected change(patch: Partial<DrawingSnapshot>): void {
    this.update(patch);
  }

  protected override isLoaded(): boolean {
    return this.snapshot.status === 'ready';
  }

  // ------------------------------------------------------------ lifecycle

  /** Loads the document (404 -> `not-found`, 401 -> `unauthenticated`), the folder's drawings and the offline queue, then opens the live socket. */
  async open(): Promise<void> {
    let doc: DrawingDocument;
    try {
      doc = await this.get<DrawingDocument>(`/api/drawings/${this.drawingId}`);
    } catch (error) {
      if (!(error instanceof ApiFailure)) {
        this.change({ status: 'failed' });
        return;
      }
      this.change({ status: LOAD_FAILURE[error.status] ?? 'failed' });
      return;
    }
    if (this.closed) return;
    const record = this.offlineQueue.load();
    this.offline = record?.offline ?? false;
    this.replica = new Replica(stateFromDocument(doc), this.deps.username);
    if (record) this.replica.restore(record.groups, record.nextHandle);
    this.initialView = doc.view ? { zoom: doc.view.zoom, panX: doc.view.pan_x, panY: doc.view.pan_y } : null;
    this.batch(() => {
      this.change({
        status: 'ready',
        info: { id: doc.id, name: doc.name, folderId: doc.folder_id, role: doc.role, username: this.deps.username },
        canEdit: atLeast(doc.role, MINIMUM_ROLE.editDrawing),
        sheets: doc.sheets,
      });
      this.showVisible(null);
      this.setPhase(this.offline ? 'offline' : 'reconnecting');
    });
    this.initialiseView();
    this.background(() => this.loadFolderDrawings(doc.folder_id));
    if (this.offline) this.channel.resynced(doc.seq);
    else this.channel.connect(doc.seq);
  }

  /** Closes the socket and stops reconnecting. */
  close(): void {
    this.closed = true;
    this.channel.disconnect();
  }

  private async loadFolderDrawings(folderId: string): Promise<void> {
    const { drawings } = await this.get<{ drawings: DrawingListing[] }>(`/api/folders/${folderId}/drawings`);
    this.change({ folderDrawings: drawings });
  }

  /** A JSON request through the injected `fetch`; a lost session sends the person to sign in. */
  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    try {
      return await answerJson<T>(await this.deps.fetch(path, jsonInit(method, body)));
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'unauthenticated') this.deps.signIn();
      throw error;
    }
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /** Starts a request nobody awaits: the server's refusal is a toast, any other failure surfaces as an unhandled rejection. */
  private background(run: () => Promise<unknown>): void {
    void onRefusal(run, (failure) => this.deps.toast(failure.message));
  }

  // ------------------------------------------------------------ showing the replica

  /**
   * The replica's visible state is the new truth of the screen: scene, parameters, selection, grips, counts. `actor` is the other person whose
   * group caused it (a layer they locked or froze takes entities out of the selection, with a toast).
   */
  private showVisible(actor: string | null): void {
    const state = this.replica.visible;
    const selected = [...this.snapshot.selection];
    this.batch(() => {
      this.change({
        state,
        parameters: state.parameters === this.snapshot.state.parameters ? this.snapshot.parameters : parameterViews(state),
        pendingOps: this.replica.pendingOps,
        revision: this.replica.confirmed.revision,
        currentLayer: state.layers[this.snapshot.currentLayer] ? this.snapshot.currentLayer : '0',
        xrefNotices: this.unloadedXrefs(state),
      });
      this.setSceneInput(state);
      this.refreshGrips();
      this.refreshConnection();
    });
    if (actor !== null) for (const loss of this.selectionLosses(selected)) this.deps.toast(copy.leftSelection(actor, loss.layer, loss.count));
    this.persist();
  }

  /** Of the entities selected before the update, those that exist but can no longer be selected because their layer is locked or frozen now: how many, per layer. */
  private selectionLosses(selected: readonly string[]): { layer: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const id of selected) {
      const entity = this.snapshot.scene.byId.get(id);
      const layer = entity && this.snapshot.state.layers[entity.entity.layer];
      if (entity && !entity.selectable && layer && (layer.locked || layer.frozen)) counts.set(layer.name, (counts.get(layer.name) ?? 0) + 1);
    }
    return [...counts].map(([layer, count]) => ({ layer, count }));
  }

  private unloadedXrefs(state: DrawingState): readonly string[] {
    const names = [...this.xrefAnnounced].filter(([name, version]) => state.xrefs[name] && state.xrefs[name].version_id !== version).map(([name]) => name);
    const same = names.length === this.snapshot.xrefNotices.length && names.every((name, i) => name === this.snapshot.xrefNotices[i]);
    return same ? this.snapshot.xrefNotices : names;
  }

  private persist(): void {
    const groups = this.replica.pending.filter((entry) => !entry.answered).map(({ group, firstHandle }) => ({ group, firstHandle }));
    this.offlineQueue.save({ offline: this.offline, groups: this.offline || groups.length > 0 ? groups : [], nextHandle: this.replica.nextOptimistic });
  }

  // ------------------------------------------------------------ connection

  private setPhase(phase: 'live' | 'reconnecting' | 'offline' | 'back-online'): void {
    this.change({ connection: { ...this.snapshot.connection, phase } });
    this.refreshConnection();
  }

  private refreshConnection(): void {
    const { phase } = this.snapshot.connection;
    const report = this.backOnline;
    const text = {
      live: copy.CONNECTION_LIVE,
      reconnecting: copy.CONNECTION_RECONNECTING,
      offline: copy.offlineBanner(this.replica.pendingOps),
      'back-online': copy.backOnline(report.sent, report.conflicts),
    }[phase];
    if (text !== this.snapshot.connection.text || this.offline !== this.snapshot.connection.offline) {
      this.change({ connection: { phase, text, offline: this.offline } });
    }
  }

  private socketOpened(): void {
    if (this.flushReport === null) this.setPhase('live');
    void this.flush();
  }

  /** `switch "Work offline"`: closes the socket and queues groups in local storage; switching off sends them in order. */
  async setOffline(offline: boolean): Promise<void> {
    if (offline === this.offline) return;
    this.offline = offline;
    if (offline) {
      this.channel.disconnect();
      this.setPhase('offline');
      this.persist();
      return;
    }
    this.flushReport = { sent: 0, conflicts: 0 };
    this.setPhase('reconnecting');
    this.persist();
    this.channel.connect(this.channel.seq);
  }

  // ------------------------------------------------------------ sending groups

  private async flush(): Promise<void> {
    if (this.flushing || this.offline) return;
    this.flushing = true;
    try {
      for (let entry = this.nextUnsent(); entry; entry = this.nextUnsent()) {
        entry.sent = true;
        try {
          this.answered(entry, await this.post<OperationsResponse>(`/api/drawings/${this.drawingId}/ops`, entry.group));
        } catch (error) {
          if (!(error instanceof ApiFailure)) {
            entry.sent = false;
            return;
          }
          this.rejected(entry, error);
        }
      }
      if (this.flushReport) {
        this.backOnline = this.flushReport;
        this.flushReport = null;
        this.setPhase('back-online');
      }
    } finally {
      this.flushing = false;
    }
  }

  private nextUnsent(): PendingGroup | undefined {
    return this.replica.pending.find((entry) => !entry.sent);
  }

  /** The server applied the group. Its patch comes on the live channel; if it already came, or cannot come, the group leaves here. */
  private answered(entry: PendingGroup, response: OperationsResponse): void {
    if (this.flushReport) {
      this.flushReport.sent += entry.group.ops.length;
      this.flushReport.conflicts += response.results.filter(isConflict).length;
    }
    if (!this.replica.pending.includes(entry)) return;
    if (response.revision <= this.replica.confirmed.revision) {
      this.leaveQueue(entry);
    } else {
      entry.answered = true;
      if (!this.channel.isOpen) this.background(() => this.reload());
    }
  }

  /** The server refused the group: the screen falls back to the server's state, then the refusal shows and focus goes to Command. */
  private rejected(entry: PendingGroup, failure: ApiFailure): void {
    this.leaveQueue(entry);
    this.deps.toast(failure.message);
    this.requestFocus('command');
  }

  private leaveQueue(entry: PendingGroup): void {
    this.replica.drop(entry.group.group_id);
    this.showVisible(null);
  }

  /** The document again, after a gap in the live messages or a group answered with no channel to bring its patch. */
  private async reload(): Promise<void> {
    const doc = await this.get<DrawingDocument>(`/api/drawings/${this.drawingId}`);
    this.replica.reset(stateFromDocument(doc));
    this.batch(() => {
      this.change({ sheets: doc.sheets });
      this.showVisible(null);
    });
    this.channel.resynced(doc.seq);
  }

  /**
   * Makes one operation group of `command` (`LAYER`, `PROPERTIES`, `PARAM`, `XRELOAD`, `XCLIP`, `LAYERSTATE`, `RESTORE`, `IMPORT`, ...) from `ops`:
   * dry-run by the model engine so the screen updates at once, then sent (or queued while working offline). A refusal shows as a toast and focus
   * goes to Command. Groups with server-only operations (xref, restore, import) are not shown until the server confirms them.
   */
  edit(command: string, ops: readonly OpInput[]): void {
    const refusal = this.submitGroup(operationGroup(command, ops, this.replica.confirmed.revision, this.deps.newId));
    if (refusal !== null) {
      this.deps.toast(refusal);
      this.requestFocus('command');
    }
  }

  /** Queues the group for sending; returns the refusal text when the engine refuses it or this person cannot edit. */
  private submitGroup(group: OperationGroup): string | null {
    const refusal = editRefusal(this.role, false);
    if (refusal !== null) return refusal;
    try {
      this.replica.submit({ ...group, base_revision: this.replica.confirmed.revision });
    } catch (error) {
      if (error instanceof ApiError) return error.message;
      throw error;
    }
    this.showVisible(null);
    void this.flush();
    return null;
  }

  // ------------------------------------------------------------ undo, redo, erase, nudge

  /** Ctrl+Z or `U` at the Ready prompt: undo my last group on the server, or pop the last queued group while offline. */
  undo(): Promise<void> {
    return this.reverse('undo');
  }

  /** Ctrl+Shift+Z. */
  redo(): Promise<void> {
    return this.reverse('redo');
  }

  private async reverse(direction: 'undo' | 'redo'): Promise<void> {
    if (this.offline) {
      if (direction === 'undo' && this.replica.popLast()) this.showVisible(null);
      else this.deps.announce(direction === 'undo' ? copy.NOTHING_TO_UNDO : copy.NOTHING_TO_REDO);
      return;
    }
    try {
      const { command } = await this.post<{ revision: number; command: string }>(`/api/drawings/${this.drawingId}/${direction}`, {});
      this.deps.announce(direction === 'undo' ? copy.undone(command) : copy.redone(command));
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      if (error.code === 'nothing_to_undo') this.deps.announce(copy.NOTHING_TO_UNDO);
      else if (error.code === 'nothing_to_redo') this.deps.announce(copy.NOTHING_TO_REDO);
      else this.deps.toast(error.message);
    }
  }

  /** Delete: erases the selection as one `ERASE` group. */
  eraseSelection(): void {
    if (this.snapshot.selection.size === 0) return;
    const refusal = this.submitGroup(eraseGroup([...this.snapshot.selection], this.commandEnv()));
    if (refusal !== null) this.deps.toast(refusal);
    this.requestFocus('command');
  }

  /** An arrow key on the drawing: moves the selection by `dx`, `dy` world units as one `NUDGE` group. */
  nudge(dx: number, dy: number): void {
    if (this.snapshot.selection.size === 0) return;
    this.edit('NUDGE', [{ type: 'move', handles: [...this.snapshot.selection], dx, dy }]);
  }

  /** `combobox "Current layer"`: a frozen layer is refused with a toast. */
  setCurrentLayer(name: string): void {
    if (this.snapshot.state.layers[name]?.frozen) this.deps.toast(copy.FROZEN_CURRENT);
    else this.change({ currentLayer: name });
  }

  // ------------------------------------------------------------ command line

  private commandEnv(): CommandEnv {
    const { info, scene, view, currentLayer, selection, folderDrawings } = this.snapshot;
    return {
      state: this.replica.visible, scene, view, username: this.deps.username, role: this.role, phone: this.phone, layer: currentLayer,
      selection: [...selection], drawings: folderDrawings, host: { id: this.drawingId, name: info?.name ?? '' }, newOpId: this.deps.newId,
    };
  }

  private get role(): Role {
    return this.snapshot.info?.role ?? 'view';
  }

  private feed(input: CommandInput): CommandUpdate {
    let update = this.session.feed(input, this.commandEnv());
    if (update.submit) {
      const refusal = this.submitGroup(update.submit);
      if (refusal === null) this.session.accept();
      else update = this.session.refuse(refusal);
    }
    this.showCommand(update);
    return update;
  }

  private showCommand(update: CommandUpdate): void {
    this.stagePrompt = update.prompt;
    this.batch(() => {
      this.change({ prompt: update.text, command: { active: update.running, expects: update.expects }, preview: [] });
      this.refreshGrips();
    });
    if (update.focus === 'find') this.openFind();
    else if (update.focus) this.requestFocus(update.focus);
    if (update.view) this.zoomAll();
    if (update.focus === null && (update.done || update.cancelled || update.message !== null)) this.requestFocus('command');
  }

  /** Enter with `text` typed in `textbox "Command"`: runs a command or ends/feeds the current stage. The caller clears the box. */
  commandEnter(text: string): void {
    if (this.snapshot.status === 'ready') this.feed({ kind: 'text', text, terminator: 'enter' });
  }

  /** Space with `text` typed: acts as Enter and returns true (the caller clears the box), or returns false where Space is a character. */
  commandSpace(text: string): boolean {
    return this.snapshot.status === 'ready' && this.feed({ kind: 'text', text, terminator: 'space' }).consumed;
  }

  /** Escape in the Command box: cancels the command and drops its uncommitted work. */
  commandEscape(): void {
    this.feed({ kind: 'escape' });
  }

  /** Any key press in the Command box ends a transient message (`Cancelled.`, a refusal, a result): the prompt shows the stage again. */
  commandKeyPress(): void {
    this.session.clearMessage();
    this.setPrompt(this.stagePrompt);
  }

  /** True at the Ready prompt, where `U` in an empty Command box is undo. */
  get atReady(): boolean {
    return this.session.atReady;
  }

  /** True when a Space typed in Command is a character (a name, expression or text stage). */
  get spaceIsCharacter(): boolean {
    return this.session.spaceIsCharacter;
  }

  /** The phone layout refuses drawing commands (`Drawing commands aren't available on a phone...`). */
  setPhone(phone: boolean): void {
    this.phone = phone;
    this.refreshGrips();
  }

  // ------------------------------------------------------------ pointer (the live drawing adds commands, grips and presence)

  protected override lastPoint(): Point {
    return this.session.lastPoint;
  }

  protected override allowsWindow(): boolean {
    return this.snapshot.command.expects === 'command';
  }

  protected override click(at: Point, shift: boolean): void {
    const { expects } = this.snapshot.command;
    if (expects === 'command') {
      super.click(at, shift);
      return;
    }
    if (expects !== 'point' && expects !== 'pick') return;
    const point = expects === 'pick' ? screenToWorld(this.snapshot.view, at) : this.resolve(at).point;
    this.feed({ kind: 'point', point });
    this.requestFocus('command');
  }

  protected override pointerMoved(world: Point, point: Point): void {
    this.cursorAt = world;
    this.sendCursor();
    if (this.snapshot.command.active) this.change({ preview: this.session.preview(point, this.commandEnv()) });
  }

  protected override pointerGone(): void {
    this.cursorAt = null;
    this.sendCursor();
  }

  protected override selectionChanged(): void {
    this.refreshGrips();
    this.sendCursor();
  }

  /** The grips of the selected entities: only for a person who can edit, at the Ready prompt, in the model layout. */
  private refreshGrips(): void {
    const { selection, scene, canEdit, command, sheet } = this.snapshot;
    const grips: GripView[] = [];
    if (canEdit && !this.phone && command.expects === 'command' && sheet === null && selection.size <= GRIP_LIMIT) {
      for (const id of selection) {
        const entity = scene.byId.get(id)?.entity;
        if (entity) for (const grip of gripsOf(entity)) grips.push({ entity: id, grip });
      }
    }
    this.setGrips(grips);
  }

  protected override beginDrag(at: Point): DragHandler | null {
    const { grips, view } = this.snapshot;
    const offset = (grip: GripView): number => {
      const [x, y] = worldToScreen(view, [grip.grip.x, grip.grip.y]);
      return Math.max(Math.abs(x - at[0]), Math.abs(y - at[1]));
    };
    const hit = grips.filter((grip) => offset(grip) <= GRIP_HALF_PX).sort((a, b) => offset(a) - offset(b))[0];
    if (!hit) return null;
    const origin: Point = [hit.grip.x, hit.grip.y];
    const sameGrip = (grip: GripView): boolean => grip.entity === hit.entity && grip.grip.kind === hit.grip.kind && grip.grip.index === hit.grip.index;
    return {
      move: (to) => {
        const [x, y] = this.resolveFrom(to, origin).point;
        this.setGrips(this.snapshot.grips.map((grip) => (sameGrip(grip) ? { entity: grip.entity, grip: { ...grip.grip, x, y } } : grip)));
      },
      end: (to) => {
        const target = this.resolveFrom(to, origin).point;
        this.refreshGrips();
        const entity = this.snapshot.scene.byId.get(hit.entity)?.entity;
        if (!entity || distance(to, at) <= GRIP_SLOP_PX) return;
        this.edit('GRIP', [{ type: 'modify', handle: hit.entity, set: dragGrip(entity, hit.grip, target) }]);
      },
    };
  }

  // ------------------------------------------------------------ people

  /** `button "Follow <user>"`: this viewport copies their zoom and the world centre of their view until the person pans or zooms. */
  follow(username: string): void {
    this.change({ followed: username });
    this.copyView(username);
  }

  protected override stopFollowing(): void {
    const { followed } = this.snapshot;
    if (followed === null) return;
    this.change({ followed: null });
    this.deps.announce(copy.stoppedFollowing(followed));
  }

  private copyView(username: string): void {
    const theirs = this.remoteViews.get(username);
    const { pane } = this.snapshot;
    if (!theirs || pane.width === 0) return;
    const centre: Point = [(theirs.width / 2 - theirs.panX) / theirs.zoom, (theirs.panY - theirs.height / 2) / theirs.zoom];
    const view: View = { zoom: theirs.zoom, panX: pane.width / 2 - centre[0] * theirs.zoom, panY: pane.height / 2 + centre[1] * theirs.zoom };
    this.applyView(view);
  }

  protected override viewChanged(): void {
    this.sendCursor();
  }

  private sendCursor(): void {
    const { view, pane, selection } = this.snapshot;
    const world = this.cursorAt;
    this.channel.send({
      type: 'cursor', x: world?.[0] ?? null, y: world?.[1] ?? null, selection: [...selection].slice(0, REMOTE_SELECTION_LIMIT),
      zoom: view.zoom, pan_x: view.panX, pan_y: view.panY, width: pane.width, height: pane.height,
    });
  }

  // ------------------------------------------------------------ layouts, xrefs, storage

  /** Shows the layout of the sheet with this id, or the model for null. */
  showLayout(sheetId: string | null): void {
    this.showSheet(this.snapshot.sheets.find((sheet) => sheet.id === sheetId) ?? null);
  }

  /** `button "Reload"` of an xref (also the Xref notice): one `XRELOAD` group. */
  reloadXref(name: string): void {
    this.edit('XRELOAD', [{ type: 'xref_reload', name }]);
  }

  /** Sets the text of `status "Storage notice"` (null clears it) and says it in the announcements. */
  setStorageNotice(text: string | null): void {
    this.change({ storageNotice: text });
    if (text !== null) this.deps.announce(text);
  }

  /** Follows an export job this person started; the store updates it from the live `export` messages and writes its notices. */
  trackExport(job: ExportJob): void {
    this.change({ exportJob: job });
    this.setStorageNotice(isExportBusy(job.state) ? copy.EXPORT_STARTED : isDownloadable(job.state) ? copy.EXPORT_READY : copy.EXPORT_FAILED);
  }

  /** Every live message after it was applied to the store (version, review, markup, issue, rfi, link...), for the panels that keep their own lists. */
  onLive(listener: (message: LiveMessage) => void): () => void {
    this.liveListeners.add(listener);
    return () => {
      this.liveListeners.delete(listener);
    };
  }

  // ------------------------------------------------------------ live messages

  private receive(message: LiveMessage): void {
    switch (message.type) {
      case 'ops': this.receiveOps(message.data); break;
      case 'presence': this.receivePresence(message.data); break;
      case 'notice':
        if (message.data.username === this.deps.username) this.deps.toast(message.data.text);
        break;
      case 'role': this.receiveRole(message.data); break;
      case 'xref_version':
        for (const name of message.data.xref_names) if (this.replica.visible.xrefs[name]) this.xrefAnnounced.set(name, message.data.version_id);
        this.change({ xrefNotices: this.unloadedXrefs(this.replica.visible) });
        break;
      case 'version': {
        const { sheet } = message.data;
        if (sheet) this.upsertSheet(sheet);
        break;
      }
      case 'export':
        if (message.data.username === this.deps.username && message.data.job.id === this.snapshot.exportJob?.id) this.trackExport(message.data.job);
        break;
      default: break;
    }
    for (const listener of this.liveListeners) listener(message);
  }

  private receiveOps(data: OpsMessage): void {
    if (data.patch.revision <= this.replica.confirmed.revision) return;
    const mine = data.username === this.deps.username;
    const own = mine ? this.replica.pending.find((entry) => entry.group.group_id === data.group_id) : undefined;
    const previous = this.replica.visible;
    this.replica.settle(data.patch, own ? { groupId: own.group.group_id, results: data.results } : null);
    this.showVisible(mine ? null : data.username);
    if (own) {
      const sentence = ownAnnouncement(own.group, data.results, own.before ?? previous);
      if (sentence) this.deps.announce(sentence);
      if (data.results.some(isConflict)) this.requestFocus('command');
    } else if (!mine) {
      const sentence = remoteAnnouncement(data.username, data.ops);
      if (sentence) this.deps.announce(sentence);
    }
  }

  private receivePresence(data: PresenceMessage): void {
    if (data.kind === 'members') {
      const names = new Set(data.members.map((member) => member.username));
      for (const name of [...this.remoteCursors.keys()]) {
        if (names.has(name)) continue;
        this.remoteCursors.delete(name);
        this.remoteViews.delete(name);
      }
      this.change({ members: data.members, cursors: this.cursorList(), followed: this.snapshot.followed && names.has(this.snapshot.followed) ? this.snapshot.followed : null });
      return;
    }
    if (data.username === this.deps.username) return;
    const member = this.snapshot.members.find((candidate) => candidate.username === data.username);
    if (!member) return;
    this.remoteCursors.set(data.username, { username: data.username, colour: member.colour, x: data.x, y: data.y, selection: data.selection });
    this.remoteViews.set(data.username, { zoom: data.zoom, panX: data.pan_x, panY: data.pan_y, width: data.width, height: data.height });
    this.change({ cursors: this.cursorList() });
    if (this.snapshot.followed === data.username) this.copyView(data.username);
  }

  private cursorList(): readonly RemoteCursor[] {
    return [...this.remoteCursors.values()];
  }

  private receiveRole(data: { username: string; role: Role | null }): void {
    const { info } = this.snapshot;
    if (data.username !== this.deps.username || !info) return;
    if (data.role === null) {
      this.channel.disconnect();
      this.replica = new Replica(emptyDrawingState(), this.deps.username);
      this.batch(() => {
        this.change({ status: 'revoked', info: null, canEdit: false });
        this.showVisible(null);
      });
      return;
    }
    const { role } = data;
    this.batch(() => {
      this.change({ info: { ...info, role }, canEdit: atLeast(role, MINIMUM_ROLE.editDrawing) });
      this.refreshGrips();
    });
    this.deps.toast(copy.roleNow(role));
    this.requestFocus('drawing');
  }

  private upsertSheet(sheet: Sheet): void {
    const { sheets } = this.snapshot;
    const known = sheets.some((candidate) => candidate.id === sheet.id);
    this.change({ sheets: known ? sheets.map((candidate) => (candidate.id === sheet.id ? sheet : candidate)) : [...sheets, sheet] });
    if (this.snapshot.sheet?.id === sheet.id) this.showSheet(sheet);
  }
}
