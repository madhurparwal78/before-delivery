import { PoolClient } from 'pg';
import { Author, PublishedPayload, VersionDto, VersionState } from '../../shared/api';
import { Graph } from '../../shared/graph';
import { pool, query } from '../db/pool';
import { fail } from '../http/errors';
import { publish } from '../realtime/bus';
import { getObject, putObject, storageKeys } from '../services/storage';
import { randomId } from '../util/crypto';
import { ZipEntry, writeZip } from '../util/zip';
import { toIso } from './time';

export interface VersionRow {
  id: string;
  workspace_id: string;
  scene_id: string;
  number: number;
  label: string;
  state: VersionState;
  seq: number;
  graph: Graph;
  hash: string;
  created_by_kind: 'member' | 'agent';
  created_by_id: string;
  created_by_name: string;
  publish_at: Date | null;
  published_at: Date | null;
  embed_id: string | null;
  thumbnail_stored: boolean;
  scheduled_by_id: string | null;
  created_at: Date;
}

const LEGAL_TRANSITIONS: Record<VersionState, VersionState[]> = {
  draft: ['in_review'],
  in_review: ['scheduled'],
  scheduled: ['in_review', 'published'],
  published: ['withdrawn'],
  withdrawn: [],
};

export function assertTransition(from: VersionState, to: VersionState): void {
  if (!LEGAL_TRANSITIONS[from].includes(to)) {
    throw fail.conflict('invalid_transition', { from, to });
  }
}

export async function versionDto(row: VersionRow): Promise<VersionDto> {
  const approvals = await query<{ member_id: string; member_name: string; at: Date }>(
    `SELECT member_id, member_name, at FROM approvals WHERE version_id = $1 ORDER BY at`,
    [row.id],
  );
  return {
    id: row.id,
    sceneId: row.scene_id,
    number: row.number,
    label: row.label,
    state: row.state,
    seq: row.seq,
    createdBy: { kind: row.created_by_kind, id: row.created_by_id, name: row.created_by_name },
    approvals: approvals.map((approval) => ({
      member: { kind: 'member', id: approval.member_id, name: approval.member_name },
      at: toIso(approval.at),
    })),
    publishAt: row.publish_at === null ? null : toIso(row.publish_at),
    publishedAt: row.published_at === null ? null : toIso(row.published_at),
    embedId: row.embed_id,
  };
}

export async function getVersion(versionId: string, workspaceId: string): Promise<VersionRow | null> {
  const rows = await query<VersionRow>(
    `SELECT * FROM versions WHERE id = $1 AND workspace_id = $2`,
    [versionId, workspaceId],
  );
  return rows[0] ?? null;
}

export async function announceVersion(row: VersionRow): Promise<void> {
  publish(row.scene_id, { event: 'version', data: await versionDto(row) });
}

export async function saveVersion(options: {
  workspaceId: string;
  sceneId: string;
  label: string;
  seq: number;
  graph: Graph;
  hash: string;
  author: Author;
}): Promise<VersionRow> {
  const id = randomId('ver');
  const snapshot = Buffer.from(
    JSON.stringify({ seq: options.seq, graph: options.graph, hash: options.hash }),
    'utf8',
  );
  await putObject(
    storageKeys.snapshot(options.workspaceId, options.sceneId, id),
    snapshot,
    'application/json',
  );
  const numbers = await query<{ next: number }>(
    `SELECT coalesce(max(number), 0) + 1 AS next FROM versions WHERE scene_id = $1`,
    [options.sceneId],
  );
  const number = numbers[0]?.next ?? 1;
  const rows = await query<VersionRow>(
    `INSERT INTO versions (id, workspace_id, scene_id, number, label, state, seq, graph, hash,
                           created_by_kind, created_by_id, created_by_name)
     VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7::jsonb, $8, $9, $10, $11)
     RETURNING *`,
    [
      id,
      options.workspaceId,
      options.sceneId,
      number,
      options.label,
      options.seq,
      JSON.stringify(options.graph),
      options.hash,
      options.author.kind,
      options.author.id,
      options.author.name,
    ],
  );
  return rows[0] as VersionRow;
}

export async function setVersionState(
  versionId: string,
  state: VersionState,
  patch: { publishAt?: Date | null; scheduledById?: string | null } = {},
  client?: PoolClient,
): Promise<VersionRow> {
  const runner = client ?? pool;
  const result = await runner.query<VersionRow>(
    `UPDATE versions
     SET state = $2,
         publish_at = CASE WHEN $3 THEN $4 ELSE publish_at END,
         scheduled_by_id = CASE WHEN $5 THEN $6 ELSE scheduled_by_id END
     WHERE id = $1
     RETURNING *`,
    [
      versionId,
      state,
      'publishAt' in patch,
      patch.publishAt ?? null,
      'scheduledById' in patch,
      patch.scheduledById ?? null,
    ],
  );
  return result.rows[0] as VersionRow;
}

export function publishedPayload(version: VersionRow, sceneName: string): PublishedPayload {
  return {
    scene: { name: sceneName },
    version: {
      number: version.number,
      label: version.label,
      publishedAt: version.published_at === null ? null : toIso(version.published_at),
    },
    graph: version.graph,
  };
}

export function referencedAssetIds(graph: Graph): string[] {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (node.assetId !== null) ids.add(node.assetId);
  }
  return [...ids];
}

const VIEWER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Orrery Studio export</title>
    <style>
      html, body { margin: 0; height: 100%; background: #f7f4ec; font-family: system-ui, sans-serif; }
      canvas { display: block; width: 100%; height: 100%; }
      p { padding: 16px; }
    </style>
  </head>
  <body>
    <canvas id="stage"></canvas>
    <script type="module">
      const response = await fetch('./scene.json');
      const payload = await response.json();
      const canvas = document.getElementById('stage');
      const gl = canvas.getContext('webgl');
      if (!gl) {
        document.body.innerHTML = '<p>Interactive 3D needs WebGL.</p>';
      } else {
        const resize = () => {
          canvas.width = canvas.clientWidth;
          canvas.height = canvas.clientHeight;
          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.clearColor(0.97, 0.96, 0.93, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        };
        window.addEventListener('resize', resize);
        resize();
        document.title = payload.scene.name + ' v' + payload.version.number;
      }
    </script>
  </body>
</html>
`;

export async function buildExportBundle(
  version: VersionRow,
  sceneName: string,
  assets: { id: string; contentType: string }[],
): Promise<Buffer> {
  const entries: ZipEntry[] = [
    {
      name: 'scene.json',
      bytes: Buffer.from(JSON.stringify(publishedPayload(version, sceneName), null, 2), 'utf8'),
    },
    { name: 'viewer.html', bytes: Buffer.from(VIEWER_HTML, 'utf8') },
  ];
  for (const asset of assets) {
    const bytes = await getObject(storageKeys.asset(version.workspace_id, asset.id));
    const extension =
      asset.contentType === 'image/png'
        ? 'png'
        : asset.contentType === 'image/jpeg'
          ? 'jpg'
          : 'glb';
    entries.push({ name: `assets/${asset.id}.${extension}`, bytes });
  }
  return writeZip(entries);
}
