import {
  AssetDto,
  Author,
  BatchResultDto,
  CommentDto,
  LockDto,
  OpDto,
  SceneResponse,
  VersionDto,
} from '../../shared/api';
import { Graph, canonicalGraphJson, cloneGraph } from '../../shared/graph';
import { RawOp, applyOp } from '../../shared/ops';
import { api } from '../api';

export async function hashGraph(graph: Graph): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalGraphJson(graph));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface PresenceEntry {
  author: Author;
  selection: string | null;
}

export class EditorModel {
  scene: SceneResponse;
  ops: OpDto[] = [];
  latestSeq = 0;
  playhead = 0;
  selection: string | null = null;
  stateId = 'rest';
  locks = new Map<string, Author>();
  presence: PresenceEntry[] = [];
  comments: CommentDto[] = [];
  versions: VersionDto[] = [];
  assets: AssetDto[] = [];
  self: Author | null = null;
  private graph0: Graph;
  private graphs = new Map<number, Graph>();
  private modelAssetIds = new Set<string>();

  constructor(scene: SceneResponse, graph0: Graph) {
    this.scene = scene;
    this.graph0 = graph0;
    this.latestSeq = scene.latestSeq;
    this.playhead = scene.latestSeq;
    this.graphs.set(0, graph0);
    this.graphs.set(scene.latestSeq, scene.graph);
  }

  setAssets(assets: AssetDto[]): void {
    this.assets = assets;
    this.modelAssetIds = new Set(
      assets.filter((asset) => asset.kind === 'model').map((asset) => asset.id),
    );
  }

  /** Graph after operation N, computed from the log the server sent. */
  graphAt(seq: number): Graph {
    const cached = this.graphs.get(seq);
    if (cached) return cached;
    let nearest = 0;
    for (const key of this.graphs.keys()) {
      if (key <= seq && key > nearest) nearest = key;
    }
    const graph = cloneGraph(this.graphs.get(nearest) ?? this.graph0);
    for (const op of this.ops) {
      if (op.seq <= nearest || op.seq > seq) continue;
      applyOp(graph, { type: op.type, payload: op.payload }, `ops[${op.seq}]`, {
        modelAssetIds: this.modelAssetIds,
      });
    }
    this.graphs.set(seq, graph);
    return graph;
  }

  latestGraph(): Graph {
    return this.graphAt(this.latestSeq);
  }

  addOps(ops: OpDto[]): void {
    for (const op of ops) {
      if (this.ops.some((existing) => existing.seq === op.seq)) continue;
      this.ops.push(op);
    }
    this.ops.sort((a, b) => a.seq - b.seq);
    this.latestSeq = this.ops.length > 0 ? Math.max(this.latestSeq, this.ops[this.ops.length - 1]!.seq) : this.latestSeq;
  }

  applyLocal(ops: RawOp[]): Graph {
    const graph = cloneGraph(this.latestGraph());
    ops.forEach((op, index) => {
      applyOp(graph, op, `ops[${index}]`, { modelAssetIds: this.modelAssetIds });
    });
    return graph;
  }

  setLocks(locks: LockDto[]): void {
    this.locks.clear();
    for (const lock of locks) this.locks.set(lock.nodeId, lock.holder);
  }

  lockHolder(nodeId: string): Author | null {
    const holder = this.locks.get(nodeId);
    if (!holder) return null;
    if (this.self && holder.kind === this.self.kind && holder.id === this.self.id) return null;
    return holder;
  }

  async refreshOps(): Promise<void> {
    const after = this.ops.length > 0 ? this.ops[this.ops.length - 1]!.seq : 0;
    const data = await api.get<{ ops: OpDto[]; latestSeq: number }>(
      `/api/scenes/${this.scene.id}/ops?after=${after}&limit=1000`,
    );
    this.addOps(data.ops);
    this.latestSeq = data.latestSeq;
  }

  opAt(seq: number): OpDto | undefined {
    return this.ops.find((op) => op.seq === seq);
  }

  noteBatch(result: BatchResultDto): void {
    this.latestSeq = result.latestSeq;
  }
}

export async function loadEditorModel(sceneId: string): Promise<EditorModel> {
  const scene = await api.get<SceneResponse>(`/api/scenes/${sceneId}`);
  const graph0 = await api.get<{ graph: Graph }>(`/api/scenes/${sceneId}/graph?at=0`);
  const model = new EditorModel(scene, graph0.graph);
  const [ops, locks, comments, versions, assets, me] = await Promise.all([
    api.get<{ ops: OpDto[]; latestSeq: number }>(`/api/scenes/${sceneId}/ops?limit=1000`),
    api.get<{ locks: LockDto[] }>(`/api/scenes/${sceneId}/locks`),
    api.get<{ comments: CommentDto[] }>(`/api/scenes/${sceneId}/comments`),
    api.get<{ versions: VersionDto[] }>(`/api/scenes/${sceneId}/versions`),
    api.get<{ assets: AssetDto[] }>('/api/assets'),
    api.get<{ member?: { id: string; name: string } }>('/api/me'),
  ]);
  model.addOps(ops.ops);
  model.latestSeq = ops.latestSeq;
  model.playhead = ops.latestSeq;
  model.setLocks(locks.locks);
  model.comments = comments.comments;
  model.versions = versions.versions;
  model.setAssets(assets.assets);
  if (me.member) model.self = { kind: 'member', id: me.member.id, name: me.member.name };
  return model;
}
