import { q, q1 } from '../db.js';
import { dashboardObjects, layoutSheets } from '../../shared/dashboard.js';
import type { DashboardAction, DashboardDoc, LayoutNode } from '../../shared/types.js';

export interface DashboardSpec {
  layout: LayoutNode;
  floating: { sheet: string; x: number; y: number; w: number; h: number }[];
  phone_order: string[];
  phone_heights: Record<string, number>;
  actions: DashboardAction[];
}

export interface DashboardRecord {
  id: string;
  workbook_id: string;
  name: string;
  spec: DashboardSpec;
}

export async function loadDashboardRecord(dashboardId: string): Promise<DashboardRecord | null> {
  return q1<DashboardRecord>('SELECT id, workbook_id, name, spec FROM dashboards WHERE id = $1', [dashboardId]);
}

export async function sheetNames(workbookId: string): Promise<Map<string, string>> {
  const rows = await q<{ id: string; name: string }>(
    'SELECT id, name FROM sheets WHERE workbook_id = $1 AND owner_id IS NULL ORDER BY ord',
    [workbookId],
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function dashboardDoc(record: DashboardRecord): Promise<DashboardDoc> {
  const names = await sheetNames(record.workbook_id);
  return {
    id: record.id,
    name: record.name,
    workbook: record.workbook_id,
    layout: record.spec.layout,
    floating: record.spec.floating,
    phone_order: record.spec.phone_order,
    phone_heights: record.spec.phone_heights,
    actions: record.spec.actions,
    objects: dashboardObjects(record.spec.layout, record.spec.floating, names),
  };
}

export function dashboardSheetIds(spec: DashboardSpec): string[] {
  return [...layoutSheets(spec.layout), ...spec.floating.map((f) => f.sheet)];
}
