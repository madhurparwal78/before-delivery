import type { Queryable } from "./db.ts";
import { rows } from "./db.ts";
import { listAssets } from "./assets.ts";
import { loadDocument } from "./documents.ts";
import type { AssetDoc, Person, Role, SetDocument, ShowBundle } from "../shared/types.ts";

interface ShaderVersionEntry {
  number: number;
  source: string;
  restored_from: number | null;
  sha256: string;
  size: number;
  author: Person;
  created_at: string;
}

interface WorkingSet {
  doc: SetDocument;
  assets: AssetDoc[];
  shaderVersions: Map<string, ShaderVersionEntry[]>;
}

interface ShaderVersionRow {
  layer_id: string;
  number: number;
  source: string;
  restored_from: number | null;
  sha256: string;
  size: number;
  user_id: string;
  display_name: string;
  created_at: Date;
}

async function readShaderVersions(q: Queryable, setId: string): Promise<Map<string, ShaderVersionEntry[]>> {
  const found = await rows<ShaderVersionRow>(
    q,
    `SELECT v.layer_id, v.number, v.source, v.restored_from, v.sha256, v.size, u.id AS user_id, u.display_name, v.created_at
     FROM shader_versions v JOIN users u ON u.id = v.author_id WHERE v.set_id = $1 ORDER BY v.layer_id, v.number`,
    [setId],
  );
  const grouped = new Map<string, ShaderVersionEntry[]>();
  for (const row of found) {
    const list = grouped.get(row.layer_id) ?? [];
    list.push({
      number: row.number, source: row.source, restored_from: row.restored_from, sha256: row.sha256, size: row.size,
      author: { user_id: row.user_id, display_name: row.display_name }, created_at: row.created_at.toISOString(),
    });
    grouped.set(row.layer_id, list);
  }
  return grouped;
}

export async function readWorkingSet(q: Queryable, setId: string, role: Role): Promise<WorkingSet> {
  return {
    doc: await loadDocument(q, setId, role),
    assets: await listAssets(q, setId),
    shaderVersions: await readShaderVersions(q, setId),
  };
}

/** The assets a layer, material or script of the working set uses: the ones whose dependents count is above zero. */
export function referencedAssets(workingSet: WorkingSet): AssetDoc[] {
  return workingSet.assets.filter((asset) => asset.dependents.count > 0);
}

export function showBundle(workingSet: WorkingSet): ShowBundle {
  const { doc } = workingSet;
  return {
    format: "afterglass-show/1",
    set: { name: doc.set.name, bpm: doc.set.bpm, active_camera_id: doc.set.active_camera_id },
    layers: doc.layers,
    keys: doc.keys,
    graph: doc.graph,
    shaders: doc.layers.flatMap((layer) => {
      const latest = layer.shader_version === null ? undefined : workingSet.shaderVersions.get(layer.id)?.find((entry) => entry.number === layer.shader_version);
      return latest ? [{ layer_id: layer.id, version: latest.number, source: latest.source }] : [];
    }),
    scripts: doc.scripts,
    assets: referencedAssets(workingSet).map(({ id, name, kind, size, sha256 }) => ({ id, name, kind, size, sha256 })),
  };
}

export function exportManifest(workingSet: WorkingSet): Record<string, unknown> {
  const { doc } = workingSet;
  return {
    format: "afterglass-export/1",
    set: { name: doc.set.name, bpm: doc.set.bpm, active_camera_id: doc.set.active_camera_id },
    layers: doc.layers,
    keys: doc.keys,
    graph: doc.graph,
    shaders: doc.layers.flatMap((layer) => {
      const versions = workingSet.shaderVersions.get(layer.id);
      return versions ? [{ layer_id: layer.id, versions: versions.map(({ number, source, restored_from }) => ({ number, source, restored_from })) }] : [];
    }),
    scripts: doc.scripts,
    assets: workingSet.assets
      .filter((asset) => asset.status === "ready")
      .map(({ id, name, kind, size, sha256 }) => ({ id, name, kind, size, sha256 })),
  };
}
