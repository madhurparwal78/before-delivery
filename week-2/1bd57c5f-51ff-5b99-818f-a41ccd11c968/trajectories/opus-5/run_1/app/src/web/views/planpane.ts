import { COPY } from '../../shared/domain.js';
import { animate, button, el, prefersReducedMotion, svg } from '../lib/dom.js';
import type { JobData } from '../lib/jobstate.js';
import type { LocalItem, Room } from '../lib/types.js';

export type PlanViewport = { width: number; panX: number; panY: number };

export type PlanContext = {
  data: JobData;
  aspect: number;
  viewport: PlanViewport | null;
  placement: { itemId: string; x: number; y: number } | null;
  selectedItemId: string | null;
  onViewportChange: (viewport: PlanViewport) => void;
  onAspect: (aspect: number) => void;
  onSelectItem: (itemId: string) => void;
  onPlacementMove: (x: number, y: number) => void;
  onDropPin: () => void;
  onCancelPlacement: () => void;
  onDropOnPlan: (itemId: string, x: number, y: number) => void;
};

export type PlanPane = {
  root: HTMLElement;
  frameRoom: (roomId: string) => void;
  pinCentre: (itemId: string) => { x: number; y: number } | null;
  layout: () => void;
};

const FILL = 0.9;

function visibleItems(data: JobData): LocalItem[] {
  return data.items.filter((item) => item.pin !== null);
}

export function buildPlanPane(ctx: PlanContext): PlanPane {
  const sheet = el('div', { class: 'plansheet' });
  const canvas = el('div', { class: 'plancanvas' });
  const root = el('section', { class: 'planpane', role: 'region', 'aria-label': 'Plan' }, [sheet]);

  if (ctx.data.job.plan_url === null || ctx.data.planImage === null) {
    sheet.append(el('p', { class: 'planmissing' }, [COPY.planUnavailable]));
    return {
      root,
      frameRoom: () => undefined,
      pinCentre: () => null,
      layout: () => undefined,
    };
  }

  const image = el('img', {
    class: 'planimage',
    src: ctx.data.planImage,
    alt: `Floor plan of ${ctx.data.job.name}`,
    draggable: 'false',
  });
  const outlines = svg('svg', {
    class: 'planoutlines',
    viewBox: '0 0 1 1',
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  });
  for (const room of ctx.data.rooms) {
    outlines.append(
      svg('polygon', {
        points: room.outline.map((point) => `${point.x},${point.y}`).join(' '),
        class: 'roomoutline',
        'vector-effect': 'non-scaling-stroke',
      }),
    );
  }
  canvas.append(image, outlines);
  sheet.append(canvas);

  const labels: { node: HTMLElement; room: Room }[] = [];
  for (const room of ctx.data.rooms) {
    const node = el('span', { class: 'roomlabel', 'aria-hidden': 'true' }, [
      el('span', { class: 'roomlabelname' }, [room.name]),
      el('span', { class: 'num' }, [`${room.counts.verified}/${room.counts.total}`]),
    ]);
    labels.push({ node, room });
    canvas.append(node);
  }

  const pins: { node: HTMLElement; item: LocalItem }[] = [];
  for (const item of visibleItems(ctx.data).sort((a, b) => a.number - b.number)) {
    const verified = item.status === 'verified';
    const node = button(
      verified ? '✓' : String(item.local === true ? 'new' : item.number),
      {
        class: `planpin${verified ? ' verified' : ''}${
          ctx.selectedItemId === item.id ? ' selected' : ''
        }`,
        'aria-label': `Pin ${item.local === true ? 'new' : item.number}: ${item.title}`,
        'data-fk': `pin-${item.id}`,
      },
      () => ctx.onSelectItem(item.id),
    );
    pins.push({ node, item });
    canvas.append(node);
  }

  const crosshair = el('div', { class: 'crosshair', 'aria-hidden': 'true', 'data-crosshair': '' });
  if (ctx.placement !== null) canvas.append(crosshair);

  const fitButton = button('Fit plan', { class: 'fitplan', 'data-fk': 'fitplan' }, () => {
    applyViewport(fitViewport(), false);
  });
  root.append(fitButton);

  if (ctx.placement !== null) {
    const readout = el('div', { class: 'placement', role: 'status', 'aria-label': 'Pin placement' });
    const target = ctx.data.items.find((item) => item.id === ctx.placement!.itemId);
    readout.textContent = `Placing pin for item ${
      target?.local === true ? 'new' : (target?.number ?? '')
    }: ${Math.floor(ctx.placement.x * 100 + 0.5)}% across, ${Math.floor(
      ctx.placement.y * 100 + 0.5,
    )}% down.`;
    root.append(
      el('div', { class: 'placementbar' }, [
        readout,
        button('Drop pin', { 'data-fk': 'droppin' }, () => ctx.onDropPin()),
        button('Cancel placement', { 'data-fk': 'cancelplacement' }, () =>
          ctx.onCancelPlacement(),
        ),
      ]),
    );
  }

  const pointOf = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const box = image.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  };

  sheet.addEventListener('click', (event) => {
    if (ctx.placement === null) return;
    if ((event.target as HTMLElement).closest('.planpin') !== null) return;
    const point = pointOf(event);
    ctx.onPlacementMove(point.x, point.y);
  });

  sheet.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('text/snaglight-item') === true) event.preventDefault();
  });
  sheet.addEventListener('drop', (event) => {
    const itemId = event.dataTransfer?.getData('text/snaglight-item');
    if (itemId === undefined || itemId === '') return;
    event.preventDefault();
    const point = pointOf(event);
    ctx.onDropOnPlan(itemId, point.x, point.y);
  });

  const paneSize = (): { w: number; h: number } => {
    const box = sheet.getBoundingClientRect();
    return { w: box.width || 1, h: box.height || 1 };
  };

  const fitViewport = (): PlanViewport => {
    const pane = paneSize();
    const width = Math.min(pane.w, pane.h / ctx.aspect);
    return {
      width,
      panX: -(pane.w - width) / 2 / width,
      panY: -(pane.h - width * ctx.aspect) / 2 / (width * ctx.aspect),
    };
  };

  const place = (viewport: PlanViewport): void => {
    const width = viewport.width;
    const height = width * ctx.aspect;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.left = `${-viewport.panX * width}px`;
    canvas.style.top = `${-viewport.panY * height}px`;
    for (const entry of labels) {
      entry.node.style.left = `${entry.room.anchor.x * width}px`;
      entry.node.style.top = `${entry.room.anchor.y * height}px`;
    }
    for (const entry of pins) {
      entry.node.style.left = `${entry.item.pin!.x * width}px`;
      entry.node.style.top = `${entry.item.pin!.y * height}px`;
    }
    if (ctx.placement !== null) {
      crosshair.style.left = `${ctx.placement.x * width}px`;
      crosshair.style.top = `${ctx.placement.y * height}px`;
    }
  };

  const applyViewport = (target: PlanViewport, smooth: boolean): void => {
    const from = ctx.viewport ?? target;
    if (!smooth || prefersReducedMotion()) {
      ctx.viewport = target;
      place(target);
      ctx.onViewportChange(target);
      return;
    }
    animate(420, (progress) => {
      const step: PlanViewport = {
        width: from.width + (target.width - from.width) * progress,
        panX: from.panX + (target.panX - from.panX) * progress,
        panY: from.panY + (target.panY - from.panY) * progress,
      };
      ctx.viewport = step;
      place(step);
      if (progress === 1) ctx.onViewportChange(target);
    });
  };

  const frameRoom = (roomId: string): void => {
    const room = ctx.data.rooms.find((candidate) => candidate.id === roomId);
    if (room === undefined) return;
    const pane = paneSize();
    const bounds = room.bounds;
    const width = Math.min(
      pane.w / Math.max(bounds.w, 0.001),
      pane.h / Math.max(bounds.h * ctx.aspect, 0.001),
    ) * FILL;
    const height = width * ctx.aspect;
    applyViewport(
      {
        width,
        panX: bounds.x + bounds.w / 2 - pane.w / width / 2,
        panY: bounds.y + bounds.h / 2 - pane.h / height / 2,
      },
      true,
    );
  };

  const layout = (): void => {
    if (ctx.viewport === null) applyViewport(fitViewport(), false);
    else place(ctx.viewport);
  };

  const onLoad = (): void => {
    if (image.naturalWidth > 0) {
      const aspect = image.naturalHeight / image.naturalWidth;
      if (Math.abs(aspect - ctx.aspect) > 0.0001) {
        ctx.aspect = aspect;
        ctx.onAspect(aspect);
        ctx.viewport = null;
      }
    }
    layout();
  };
  if (image.complete) requestAnimationFrame(onLoad);
  else image.addEventListener('load', onLoad);

  return {
    root,
    frameRoom,
    pinCentre: (itemId: string) => {
      const entry = pins.find((candidate) => candidate.item.id === itemId);
      if (entry === undefined) return null;
      const box = entry.node.getBoundingClientRect();
      if (box.width === 0) return null;
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    },
    layout,
  };
}
