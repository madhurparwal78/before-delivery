import { activityCopy, allowanceText } from "../../shared/copy";
import type { Clip, Comment, Cut, ExportRecord, Kit, LiveMessage, LoggedOp, OpChanges, OpResult, ProjectDetail, Project, Role } from "../../shared/types";
import { ASPECTS } from "../../shared/types";
import { timecode } from "../../shared/timecode";
import { api, ApiError, newOpId } from "../lib/api";
import type { LiveSocket } from "../lib/live";
import { notify } from "../lib/notices";
import { allowanceStore } from "../lib/session";
import { Store } from "../lib/store";
import { buildSearch, parseAddress, type Panel } from "./address";
import type { OpBody } from "../../shared/ops";
import { emptyState, firstForZoom, lastFrame, rateOfState, timelineOrder, visibleFrames, type ProjectState } from "./state";


const placeholder = (id: string): Project => ({
  id,
  title: "",
  agency: "",
  description: "",
  frame_rate: "25",
  aspect_ratio: "16:9",
  width: 1920,
  height: 1080,
  time_unit: "frames",
  version: 0,
  total_frames: 0,
  role: "commenter",
  markers: [],
  last_cut: null,
});

const PLAYHEAD_INTERVAL_MS = 250;
const WINNER_MS = 2000;
const GLIDE_MS = 300;

/** The open project: the saved document, the live socket and this person's view of it. */
export class ProjectStore {
  readonly state: Store<ProjectState>;
  private activityId = 0;
  private lastPlayheadSent = Number.NEGATIVE_INFINITY;
  private playheadTimer: number | null = null;
  private lastAllowance = allowanceStore.get()?.text ?? "";
  private focusSeq = 0;
  private catching: Promise<void> | null = null;
  private measured = false;

  constructor(
    readonly projectId: string,
    private readonly socket: LiveSocket,
    private readonly me: { id: string; name: string },
  ) {
    this.state = new Store(emptyState(placeholder(projectId)));
  }

  get s(): ProjectState {
    return this.state.get();
  }

  private patch(change: Partial<ProjectState>): void {
    this.state.set({ ...this.s, ...change });
  }

  // ----- loading and the live socket -----

  async load(search: string): Promise<void> {
    try {
      const [detail, cuts, comments, exports] = await Promise.all([
        api.get<ProjectDetail>(`/api/projects/${this.projectId}`),
        api.get<{ items: Cut[] }>(`/api/projects/${this.projectId}/cuts`),
        api.get<{ items: Comment[] }>(`/api/projects/${this.projectId}/comments`),
        api.get<{ items: ExportRecord[] }>(`/api/projects/${this.projectId}/exports`),
      ]);
      const base = {
        ...this.s,
        status: "ready" as const,
        project: detail.project,
        rows: detail.rows,
        clips: detail.clips,
        captions: detail.captions,
        markers: detail.project.markers,
        members: detail.members,
        media: detail.media,
        version: detail.project.version,
        role: detail.project.role,
        cuts: cuts.items,
        comments: comments.items,
        exports: exports.items,
      };
      const address = parseAddress(search, lastFrame(base), new Set(detail.clips.map((clip) => clip.id)));
      const next: ProjectState = { ...base, playhead: address.frame, zoom: address.zoom, current: address.clip, panel: address.panel };
      next.first = firstForZoom(next);
      this.state.set(next);
      if (address.clip) this.requestFocus(address.clip);
      if (this.s.role !== "commenter") void this.loadKits();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.patch({ status: "missing" });
      else throw error;
    }
  }

  private async loadKits(): Promise<void> {
    try {
      this.patch({ kits: (await api.get<{ items: Kit[] }>("/api/kits")).items });
    } catch {
      this.patch({ kits: [] });
    }
  }

  attach(): () => void {
    const offOpen = this.socket.onOpen(() => this.socket.send({ type: "subscribe", project_id: this.projectId, after_version: this.s.version }));
    const offMessage = this.socket.onMessage((message) => this.live(message));
    const offClose = this.socket.onClose((code) => {
      if (code === 4403) void this.afterRoleClose();
      this.patch({ remotePlayheads: {} });
    });
    return () => {
      offOpen();
      offMessage();
      offClose();
    };
  }

  private async afterRoleClose(): Promise<void> {
    if (this.s.status === "removed") {
      this.socket.close();
      return;
    }
    try {
      const detail = await api.get<ProjectDetail>(`/api/projects/${this.projectId}`);
      this.patch({ role: detail.project.role, members: detail.members });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.removed();
    }
  }

  private removed(): void {
    this.patch({ status: "removed" });
    notify(`You no longer have access to ${this.s.project.title}.`);
    this.socket.close();
  }

  private live(message: LiveMessage): void {
    switch (message.type) {
      case "op":
        void this.applyLogged(message);
        break;
      case "comment":
        this.mergeComment(message.comment);
        break;
      case "export":
        this.mergeExport(message.export);
        break;
      case "allowance": {
        const text = allowanceText(message.allowance);
        if (text !== this.lastAllowance) {
          this.announce(`Allowance now: ${text}.`);
          this.lastAllowance = text;
        }
        break;
      }
      case "playhead": {
        const remote = { ...this.s.remotePlayheads };
        if (message.frame === null) delete remote[message.person];
        else remote[message.person] = message.frame;
        this.patch({ remotePlayheads: remote });
        break;
      }
      case "cut_shared":
        this.announce(`${message.cut.name} is now shared for review.`);
        void this.refreshCuts();
        break;
      case "role_changed":
        if (message.role === null) this.removed();
        else this.roleIs(message.role);
        break;
      case "token_window":
        break;
    }
  }

  private roleIs(role: Role): void {
    if (role === this.s.role) return;
    this.patch({ role });
    notify(`Your role on ${this.s.project.title} is now ${role}.`);
    if (role !== "commenter") void this.loadKits();
  }

  async refreshCuts(): Promise<void> {
    this.patch({ cuts: (await api.get<{ items: Cut[] }>(`/api/projects/${this.projectId}/cuts`)).items });
  }

  announce(text: string): void {
    this.activityId += 1;
    this.patch({ activity: [...this.s.activity.slice(-40), { id: this.activityId, text }] });
  }

  private mergeComment(comment: Comment): void {
    const others = this.s.comments.filter((existing) => existing.id !== comment.id);
    this.patch({ comments: [...others, comment].sort((a, b) => (a.created_at < b.created_at ? -1 : 1)) });
  }

  private mergeExport(exported: ExportRecord): void {
    const before = this.s.exports.find((existing) => existing.id === exported.id);
    const rest = this.s.exports.filter((existing) => existing.id !== exported.id);
    this.patch({ exports: [exported, ...rest].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) });
    if (before?.state === exported.state) return;
    const subject = `Export of ${exported.cut_name} at ${exported.size}p`;
    if (exported.state === "done") this.announce(`${subject} is ready.`);
    else if (exported.state === "failed") this.announce(`${subject} failed.`);
    else if (exported.state === "cancelled") this.announce(`${subject} was cancelled.`);
  }

  // ----- applying saved changes -----

  private async applyLogged(op: LoggedOp): Promise<void> {
    if (op.version <= this.s.version) return;
    if (op.version > this.s.version + 1) {
      await this.catchUp();
      return;
    }
    const own = op.author.id === this.me.id;
    this.merge(op.version, op.changes, op.removed, own ? null : op.author.name);
    if (!own) this.announce(activityCopy(op.author.name, op.op, rateOfState(this.s)));
  }

  catchUp(): Promise<void> {
    this.catching ??= (async () => {
      try {
        const { ops } = await api.get<{ ops: LoggedOp[] }>(`/api/projects/${this.projectId}/ops?after=${this.s.version}`);
        for (const op of ops) await this.applyLogged(op);
      } finally {
        this.catching = null;
      }
    })();
    return this.catching;
  }

  private merge(version: number, changes: OpChanges, removed: readonly string[], remoteAuthor: string | null): void {
    const state = this.s;
    const gone = new Set(removed);
    const byId = <T extends { id: string }>(list: readonly T[], updates: readonly T[]): T[] => {
      const map = new Map(list.filter((item) => !gone.has(item.id)).map((item) => [item.id, item]));
      for (const update of updates) map.set(update.id, update);
      return [...map.values()];
    };
    const clips = byId(state.clips, changes.clips);
    const rows = byId(state.rows, changes.rows).sort((a, b) => a.position - b.position);
    const comments = byId(state.comments, changes.comments);
    const project = changes.project
      ? { ...state.project, ...changes.project, aspect_ratio: changes.project.aspect_ratio }
      : state.project;
    const gliding = { ...state.gliding };
    const winners = { ...state.winners };
    if (remoteAuthor !== null) {
      for (const clip of changes.clips) {
        gliding[clip.id] = true;
        winners[clip.id] = remoteAuthor;
      }
    }
    const clipIds = new Set(clips.map((clip) => clip.id));
    const next: ProjectState = {
      ...state,
      version,
      clips,
      rows,
      comments,
      captions: byId(state.captions, changes.captions),
      markers: changes.markers ?? state.markers,
      project: { ...project, version },
      gliding,
      winners,
      selection: state.selection.filter((id) => clipIds.has(id)),
      current: state.current && clipIds.has(state.current) ? state.current : null,
    };
    this.state.set(next);
    if (remoteAuthor !== null && changes.clips.length) {
      window.setTimeout(() => {
        const left = { ...this.s.gliding };
        for (const clip of changes.clips) delete left[clip.id];
        this.patch({ gliding: left });
      }, GLIDE_MS);
      window.setTimeout(() => {
        const left = { ...this.s.winners };
        for (const clip of changes.clips) delete left[clip.id];
        this.patch({ winners: left });
      }, WINNER_MS);
    }
    if (this.s.playhead > lastFrame(this.s)) this.patch({ playhead: lastFrame(this.s) });
  }

  // ----- saving changes -----

  private readonly jobs: (() => Promise<void>)[] = [];
  private draining = false;

  /** Runs queued jobs one at a time; the first job of an idle queue starts synchronously. */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    for (let job = this.jobs.shift(); job; job = this.jobs.shift()) await job();
    this.draining = false;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.jobs.push(() => work().then(resolve, reject));
      void this.drain();
    });
  }

  /** Queues one saved change; the factory runs when its turn comes, against the document as it is then. */
  submit(factory: (state: ProjectState) => OpBody | null): Promise<OpResult | null> {
    return this.enqueue(async (): Promise<OpResult | null> => {
      const body = factory(this.s);
      if (!body) return null;
      const ids = pendingIds(body);
      this.markPending(ids, true);
      try {
        const result = await api.post<OpResult>(`/api/projects/${this.projectId}/ops`, { ...body, op_id: newOpId(), base_version: this.s.version });
        await this.saved(result);
        return result;
      } catch (error) {
        this.refused(error);
        return null;
      } finally {
        this.markPending(ids, false);
      }
    });
  }

  history(direction: "undo" | "redo"): Promise<void> {
    return this.enqueue(async (): Promise<void> => {
      try {
        const result = await api.post<OpResult>(`/api/projects/${this.projectId}/${direction}`, { op_id: newOpId() });
        await this.saved(result);
      } catch (error) {
        this.refused(error);
      }
    });
  }

  async saved(result: OpResult): Promise<void> {
    if (result.version === this.s.version + 1) this.merge(result.version, result.changes, result.removed, null);
    else if (result.version > this.s.version + 1) await this.catchUp();
    if (result.stopped) notify(`Stopped at ${timecode(rateOfState(this.s), result.stopped.at_frame)}: ${result.stopped.reason}.`);
  }

  private refused(error: unknown): void {
    if (!(error instanceof ApiError)) throw error;
    notify(error.message);
    if (error.code === "conflict") {
      const winner = error.body.winner ?? "";
      const items = (error.body.items ?? []) as Clip[];
      const clips = new Map(this.s.clips.map((clip) => [clip.id, clip]));
      const winners = { ...this.s.winners };
      for (const item of items) {
        if (item && typeof item === "object" && "start_frame" in item) {
          clips.set(item.id, item);
          winners[item.id] = winner;
        }
      }
      this.patch({ clips: [...clips.values()], winners });
      window.setTimeout(() => this.patch({ winners: {} }), WINNER_MS);
      void this.catchUp();
    }
  }

  private markPending(ids: readonly string[], on: boolean): void {
    const pending = { ...this.s.pending };
    for (const id of ids) {
      if (on) pending[id] = true;
      else delete pending[id];
    }
    this.patch({ pending });
  }

  // ----- the view: playhead, zoom, selection, panel, and the address -----

  private writeAddress(mode: "push" | "replace"): void {
    const search = buildSearch({ frame: this.s.playhead, zoom: this.s.zoom, clip: this.s.current, panel: this.s.panel });
    const url = `${window.location.pathname}${search}`;
    if (url === window.location.pathname + window.location.search) return;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }

  /** A click, Home, End, comma, period or Enter from the loupe: replaces the current history entry. */
  movePlayhead(frame: number, options: { write?: boolean } = {}): void {
    const clamped = Math.min(Math.max(0, frame), lastFrame(this.s));
    this.patch({ playhead: clamped });
    this.sendPlayhead(clamped);
    if (options.write !== false) this.writeAddress("replace");
  }

  private sendPlayhead(frame: number): void {
    const now = performance.now();
    if (this.playheadTimer !== null) window.clearTimeout(this.playheadTimer);
    this.playheadTimer = null;
    const wait = this.lastPlayheadSent + PLAYHEAD_INTERVAL_MS - now;
    if (wait <= 0) {
      this.lastPlayheadSent = now;
      this.socket.send({ type: "playhead", frame });
    } else {
      this.playheadTimer = window.setTimeout(() => {
        this.lastPlayheadSent = performance.now();
        this.socket.send({ type: "playhead", frame: this.s.playhead });
      }, wait);
    }
  }

  /** Sets the playhead without touching the address: playback uses this. */
  playTo(frame: number): void {
    this.patch({ playhead: frame });
    this.sendPlayhead(frame);
  }

  setZoom(zoom: number): void {
    const clamped = Math.min(5, Math.max(0, zoom));
    if (clamped === this.s.zoom) return;
    const next = { ...this.s, zoom: clamped };
    this.state.set({ ...next, first: firstForZoom(next) });
    this.writeAddress("push");
  }

  /** The first measurement places the canvas around the playhead; later resizes only change the width. */
  setCanvasWidth(width: number): void {
    if (width === this.s.canvasWidth && this.measured) return;
    const next = { ...this.s, canvasWidth: width };
    this.state.set(this.measured ? next : { ...next, first: firstForZoom(next) });
    this.measured = true;
  }

  scrollTo(first: number): void {
    this.patch({ first: Math.max(0, first) });
  }

  home(): void {
    const first = timelineOrder(this.s.clips, this.s.rows)[0];
    this.patch({ playhead: 0, first: 0 });
    this.sendPlayhead(0);
    if (first) this.setCurrent(first.id, "replace");
    this.writeAddress("replace");
    if (first) this.requestFocus(first.id);
  }

  end(): void {
    const last = timelineOrder(this.s.clips, this.s.rows).at(-1);
    const frame = lastFrame(this.s);
    const first = Math.max(0, frame + 1 - visibleFrames(this.s));
    this.patch({ playhead: frame, first });
    this.sendPlayhead(frame);
    if (last) this.setCurrent(last.id, "replace");
    this.writeAddress("replace");
    if (last) this.requestFocus(last.id);
  }

  setCurrent(id: string | null, mode: "push" | "replace" | "none" = "push"): void {
    if (this.s.current === id) return;
    this.patch({ current: id });
    if (mode !== "none") this.writeAddress(mode);
  }

  requestFocus(clip: string): void {
    this.focusSeq += 1;
    this.patch({ focusRequest: { clip, seq: this.focusSeq } });
  }

  toggleSelect(id: string): void {
    const selection = this.s.selection.includes(id) ? this.s.selection.filter((existing) => existing !== id) : [...this.s.selection, id];
    this.patch({ selection });
  }

  clearSelection(): void {
    this.patch({ selection: [] });
  }

  setPanel(panel: Panel): void {
    if (panel === this.s.panel) return;
    this.patch({ panel });
    this.writeAddress("push");
  }

  /** Back and forward restore the four parameters as on load. */
  restoreFromAddress(search: string): void {
    const address = parseAddress(search, lastFrame(this.s), new Set(this.s.clips.map((clip) => clip.id)));
    const next = { ...this.s, playhead: address.frame, zoom: address.zoom, current: address.clip, panel: address.panel };
    this.state.set({ ...next, first: firstForZoom(next) });
    if (address.clip) this.requestFocus(address.clip);
  }

  setSkim(skim: ProjectState["skim"]): void {
    this.patch({ skim });
  }

  setPlaying(playing: boolean): void {
    this.patch({ playing });
  }

  setRange(range: ProjectState["range"]): void {
    this.patch({ range });
  }

  aspectDimensions(): { width: number; height: number } {
    return ASPECTS[this.s.project.aspect_ratio];
  }

  async postComment(body: Record<string, unknown>): Promise<Comment> {
    const comment = await api.post<Comment>(`/api/projects/${this.projectId}/comments`, body);
    this.mergeComment(comment);
    return comment;
  }
}

function pendingIds(body: OpBody): string[] {
  if ("clip_id" in body) return [body.clip_id];
  if (body.type === "group") return body.clip_ids;
  return [];
}
