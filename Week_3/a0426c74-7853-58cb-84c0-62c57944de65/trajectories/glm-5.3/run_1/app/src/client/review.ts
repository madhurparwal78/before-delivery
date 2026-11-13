import { el } from './ui.js';
import type { ClientApi, ScreenSettings } from './screen_core.js';
import { DrawingScreenCore, PANEL_ORDER, type PanelName } from './screen_core.js';
import type { ResolvedEntity } from '../shared/geometry.js';
import { entityLabel } from './ui.js';

// The Review screen: one published version, read-only, with review controls.
export class ReviewScreen extends DrawingScreenCore {
  private readonly versionId: string;
  private readonly isViewLink: boolean;

  constructor(drawingId: string, versionId: string, api: ClientApi, me: string | null, settings: ScreenSettings, options: { viewLink?: boolean } = {}) {
    super(drawingId, api, me, settings, true);
    this.versionId = versionId;
    this.isViewLink = options.viewLink ?? false;
  }

  async load(): Promise<void> {
    const path = this.isViewLink ? `/api/links/${this.versionId}` : `/api/versions/${this.versionId}`;
    const { status, data } = await this.api<Record<string, unknown>>('GET', path);
    if (status === 410 || status === 404) {
      const message = String((data as { message?: string }).message ?? 'This link has expired.');
      this.root.replaceChildren(el('div', { class: 'surface note' }, el('p', { text: message })));
      return;
    }
    if (status === 401) {
      window.location.href = '/signin';
      return;
    }
    if (status !== 200) {
      this.root.replaceChildren(el('div', { class: 'surface note' }, el('p', { text: 'We couldn\u2019t find that version.' })));
      return;
    }
    const snapshot = (data as { snapshot?: { model?: { entities?: Record<string, ResolvedEntity>; order?: string[]; layers?: Record<string, never> } } }).snapshot;
    const entities = snapshot?.model?.entities ?? {};
    const order = snapshot?.model?.order ?? Object.keys(entities);
    this.state = {
      id: this.drawingId,
      name: `Version ${(data as { number?: number }).number ?? ''}`,
      folderId: String((data as { sheet_id?: string }).sheet_id ?? ''),
      role: 'view',
      revision: 0,
      nextHandle: 1,
      layers: (snapshot?.model?.layers ?? {}) as never,
      entities,
      order,
      blocks: {},
      dimStyles: {},
      parameters: [],
      constraints: [],
      xrefs: [],
      layerStates: [],
      currentLayer: '0',
      underlays: [],
      sheets: [],
    };
    this.versions = [{ ...(data as Record<string, unknown>) }];
    this.view = this.fitView(order, entities);
    this.renderAll();
    this.renderVersions();
    this.renderIssues();
    if (!this.isViewLink) {
      this.openSocket();
      await this.loadIssues();
    } else {
      this.openLinkSocket();
    }
  }

  private fitView(order: string[], entities: Record<string, ResolvedEntity>): { zoom: number; panX: number; panY: number } {
    if (!order.length) return { zoom: 1, panX: this.paneWidth / 2, panY: this.paneHeight / 2 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const handle of order) {
      const entity = entities[handle];
      if (!entity) continue;
      const box = boxOf(entity);
      minX = Math.min(minX, box.minX);
      minY = Math.min(minY, box.minY);
      maxX = Math.max(maxX, box.maxX);
      maxY = Math.max(maxY, box.maxY);
    }
    if (!Number.isFinite(minX)) return { zoom: 1, panX: this.paneWidth / 2, panY: this.paneHeight / 2 };
    const width = Math.max(maxX - minX, 1e-6);
    const height = Math.max(maxY - minY, 1e-6);
    const zoom = Math.max(0.05, Math.min(50, Math.min((this.paneWidth - 48) / width, (this.paneHeight - 48) / height)));
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;
    return { zoom: Number(zoom.toFixed(4)), panX: Number((this.paneWidth / 2 - centreX * zoom).toFixed(4)), panY: Number((this.paneHeight / 2 + centreY * zoom).toFixed(4)) };
  }

  private openLinkSocket(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${window.location.host}/api/links/${this.versionId}/live`);
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data) as { type: string; data?: Record<string, unknown> };
      if (message.type === 'link' && message.data?.expired) {
        this.root.replaceChildren(el('div', { class: 'surface note' }, el('p', { text: 'This link has expired.' })));
        socket.close();
      }
      if (message.type === 'link' && message.data?.revoked) {
        this.root.replaceChildren(el('div', { class: 'surface note' }, el('p', { text: 'This link was turned off.' })));
        socket.close();
      }
    });
  }
}

function boxOf(entity: ResolvedEntity): { minX: number; minY: number; maxX: number; maxY: number } {
  switch (entity.type) {
    case 'line': return { minX: Math.min(entity.x1, entity.x2), minY: Math.min(entity.y1, entity.y2), maxX: Math.max(entity.x1, entity.x2), maxY: Math.max(entity.y1, entity.y2) };
    case 'circle': return { minX: entity.cx - entity.r, minY: entity.cy - entity.r, maxX: entity.cx + entity.r, maxY: entity.cy + entity.r };
    case 'arc': return { minX: entity.cx - entity.r, minY: entity.cy - entity.r, maxX: entity.cx + entity.r, maxY: entity.cy + entity.r };
    case 'pline': {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const point of entity.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      return { minX, minY, maxX, maxY };
    }
    case 'insert': return { minX: entity.x, minY: entity.y, maxX: entity.x, maxY: entity.y };
    case 'hatch': return { minX: entity.seed_x, minY: entity.seed_y, maxX: entity.seed_x, maxY: entity.seed_y };
    case 'dimension': return { minX: entity.text_x, minY: entity.text_y, maxX: entity.text_x, maxY: entity.text_y };
  }
}

export { PANEL_ORDER, entityLabel };
export type { PanelName };
