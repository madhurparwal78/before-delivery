import type pg from 'pg';
import { contentHash, emptyContent, sortContent } from '../domain/layout.js';
import { newId } from '../domain/hash.js';
import { referenceContent } from '../domain/referenceLayout.js';
import { DEFAULT_STANDARDS } from '../domain/standards.js';

export type Template = 'reference' | 'empty';

export interface CreatedWorkspace {
  workspace: { id: string; name: string };
  layout: { id: string };
  version: { id: string } | null;
}

export async function createWorkspace(
  client: pg.PoolClient,
  name: string,
  template: Template,
  founderId: string,
): Promise<CreatedWorkspace> {
  const workspaceId = newId('ws');
  await client.query(`insert into workspaces (id, name, standards) values ($1, $2, $3)`, [
    workspaceId,
    name,
    JSON.stringify(DEFAULT_STANDARDS),
  ]);
  await client.query(
    `insert into memberships (workspace_id, user_id, role) values ($1, $2, 'founder')`,
    [workspaceId, founderId],
  );

  const layoutId = newId('lay');
  const content = template === 'reference' ? sortContent(referenceContent(1)) : emptyContent();
  await client.query(
    `insert into layouts (id, workspace_id, name, content, module_revisions) values ($1, $2, $3, $4, $5)`,
    [
      layoutId,
      workspaceId,
      `${name} Layout`,
      JSON.stringify(content),
      JSON.stringify(Object.fromEntries(content.modules.map((module) => [module.id, 0]))),
    ],
  );

  if (template === 'empty') {
    return { workspace: { id: workspaceId, name }, layout: { id: layoutId }, version: null };
  }

  const versionId = newId('ver');
  await client.query(
    `insert into layout_versions
       (id, layout_id, number, state, canonical_hash, content, label, saved_by, restored_from)
     values ($1, $2, 1, 'Published', $3, $4, 'Issue 1', 'Founder Fishplate', null)`,
    [versionId, layoutId, contentHash(content), JSON.stringify(content)],
  );
  return {
    workspace: { id: workspaceId, name },
    layout: { id: layoutId },
    version: { id: versionId },
  };
}
