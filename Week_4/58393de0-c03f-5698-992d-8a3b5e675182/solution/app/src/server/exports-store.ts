import type { ExportFormat, ExportRecord, ExportUnit } from "../shared/types";

export interface ExportRow {
  id: string;
  ownerId: string;
  projectId: string | null;
  fileName: string;
  format: ExportFormat;
  unit: ExportUnit;
  bytes: number;
  triangleCount: number | null;
  bbox: { x: number; y: number; z: number } | null;
  objectKey: string;
  createdAt: Date;
}

export const EXPORT_COLUMNS = `e.id, e.owner_id AS "ownerId", e.project_id AS "projectId", e.file_name AS "fileName", e.format, e.unit,
  e.bytes, e.triangle_count AS "triangleCount", e.bbox, e.object_key AS "objectKey", e.created_at AS "createdAt"`;

export function exportView(row: ExportRow): ExportRecord {
  return {
    id: row.id, projectId: row.projectId, ownerId: row.ownerId, fileName: row.fileName, format: row.format, unit: row.unit,
    bytes: row.bytes, triangleCount: row.triangleCount, bbox: row.bbox, createdAt: row.createdAt.toISOString(),
    downloadUrl: `/api/exports/${row.id}/download`,
  };
}

export const exportKey = (ownerId: string, exportId: string, fileName: string): string => `exports/${ownerId}/${exportId}/${fileName}`;
