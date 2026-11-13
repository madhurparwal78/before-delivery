import type pg from 'pg';
import { query } from '../db/pool.ts';
import type { FieldKind, TemplateJson, TemplateStatus } from '../../shared/types.ts';

export type TemplateRow = {
  id: string;
  team_id: string;
  name: string;
  status: TemplateStatus;
  page_count: number;
  signer_count: number;
  original_sha256: string;
};

export type TemplateFieldRow = {
  signer: number;
  kind: FieldKind;
  label: string;
  required: boolean;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

const FIELD_SELECT = `SELECT signer, kind, label, required, page, x, y, w, h
  FROM template_fields WHERE template_id = $1 ORDER BY seq`;

export const templateJson = async (
  client: pg.PoolClient,
  templateId: string,
): Promise<TemplateJson> => {
  const header = await client.query<TemplateRow>(
    'SELECT id, team_id, name, status, page_count, signer_count, original_sha256 FROM templates WHERE id = $1',
    [templateId],
  );
  const row = header.rows[0];
  if (!row) throw new Error('template missing');
  const fields = await client.query<TemplateFieldRow>(FIELD_SELECT, [templateId]);
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    pageCount: row.page_count,
    signerCount: row.signer_count,
    fields: fields.rows,
  };
};

export const listTemplatesForTeam = async (
  teamId: string,
  sharedOnly: boolean,
): Promise<TemplateJson[]> => {
  const rows = await query<TemplateRow>(
    `SELECT id, team_id, name, status, page_count, signer_count, original_sha256
     FROM templates WHERE team_id = $1 ${sharedOnly ? "AND status = 'shared'" : ''}
     ORDER BY created_at DESC`,
    [teamId],
  );
  const out: TemplateJson[] = [];
  for (const row of rows) {
    const fields = await query<TemplateFieldRow>(FIELD_SELECT, [row.id]);
    out.push({
      id: row.id,
      name: row.name,
      status: row.status,
      pageCount: row.page_count,
      signerCount: row.signer_count,
      fields,
    });
  }
  return out;
};
