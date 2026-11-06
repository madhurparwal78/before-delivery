import { COPY, JOB_STAGE_LABELS } from '../../shared/domain.js';
import { sendJson } from '../lib/api.js';
import {
  animate,
  button,
  el,
  hasOpenDialog,
  openDialog,
  prefersReducedMotion,
  svg,
  trapFocus,
} from '../lib/dom.js';
import { JobState } from '../lib/jobstate.js';
import { announce, showTopBar, view } from '../lib/shell.js';
import type { LocalItem } from '../lib/types.js';
import { dropPin } from './actions.js';
import { renderNotFound, renderRoleEnded } from './account.js';
import {
  currentMode,
  freshUi,
  itemNumberText,
  withPending,
  type JobCtx,
  type LayoutMode,
  type TabKey,
  type Ui,
} from './jobctx.js';
import { buildPlanPane, type PlanPane } from './planpane.js';
import { accessTabPanel, buildList, roomOf, select } from './punchlist.js';
import { accessPanel, costsPanel, outboxPanel, peoplePanel, setupPanel } from './tabs.js';

const TAB_LABELS: Record<TabKey, string> = {
  punch: 'Punch list',
  setup: 'Setup',
  people: 'People & visits',
  costs: 'Costs',
  access: 'Access',
  outbox: 'Outbox',
};

let active: { state: JobState; ui: Ui; unsubscribe: () => void } | null = null;

export function leaveJob(): void {
  active?.unsubscribe();
  active?.state.stop();
  active = null;
}

export async function renderJob(
  jobId: string,
  selectedItemId: string | null,
  navigate: (path: string) => void,
): Promise<void> {
  showTopBar(true);
  if (active !== null && active.state.jobId !== jobId) leaveJob();
  if (active === null) {
    const state = new JobState(jobId);
    const ui = freshUi();
    const ctx: JobCtx = { state, ui, render: () => paint(ctx), navigate };
    const unsubscribe = state.onChange(() => paint(ctx));
    active = { state, ui, unsubscribe };
    await state.load();
    if (!state.isRoleEnded && !state.isSignedOut) {
      state.startStream();
      state.startBackground();
      void state.scheduleSync();
    }
    if (selectedItemId !== null) ui.selectedItemId = selectedItemId;
    installPlacementKeys(ctx);
    paint(ctx);
    return;
  }
  const ctx: JobCtx = {
    state: active.state,
    ui: active.ui,
    render: () => paint(ctx),
    navigate,
  };
  if (selectedItemId !== null) ctx.ui.selectedItemId = selectedItemId;
  paint(ctx);
}

/* ------------------------------------------------------------ focus memory */

type FocusMemory = { key: string; start: number | null; end: number | null } | null;

function captureFocus(): FocusMemory {
  const node = document.activeElement as HTMLElement | null;
  if (node === null) return null;
  const key = node.dataset?.fk;
  if (key === undefined) return null;
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
    return { key, start: node.selectionStart, end: node.selectionEnd };
  }
  return { key, start: null, end: null };
}

function restoreFocus(memory: FocusMemory): void {
  if (memory === null) return;
  const node = document.querySelector<HTMLElement>(`[data-fk="${CSS.escape(memory.key)}"]`);
  if (node === null) return;
  node.focus();
  if (
    memory.start !== null &&
    (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) &&
    node.type !== 'file'
  ) {
    try {
      node.setSelectionRange(memory.start, memory.end);
    } catch {
      // Some input types refuse a selection range; focus alone is enough.
    }
  }
}

/* ------------------------------------------------------------------- paint */

function paint(ctx: JobCtx): void {
  if (ctx.state.isSignedOut) {
    ctx.navigate('/signin?signedout=1');
    return;
  }
  if (ctx.state.isRoleEnded) {
    ctx.ui.codes = null;
    renderRoleEnded();
    return;
  }
  const data = ctx.state.data;
  if (data === null) {
    renderNotFound();
    return;
  }
  const memory = captureFocus();
  const root = view();
  const mode = currentMode();
  const job = data.job;
  const role = job.my_role;
  if (!job.access_codes_available) ctx.ui.codes = null;

  const header = el('div', { class: 'jobheader' }, [
    el('h1', {}, [job.name]),
    el('p', { class: 'stage' }, [JOB_STAGE_LABELS[job.status]]),
    el('p', { class: 'progress num' }, [`${job.progress.percent}% verified`]),
  ]);
  if (role === 'owner' || role === 'lead') {
    const review = data.items.filter((item) => item.pin_status === 'needs_review').length;
    if (review > 0) {
      header.append(el('p', { class: 'review num' }, [`${review} pins need review`]));
    }
  }
  if (role === 'owner') {
    const stageButtons = el('div', { class: 'stagebuttons' });
    if (job.status === 'active') {
      stageButtons.append(
        button('Start walkthrough', { 'data-fk': 'startwalkthrough' }, (event) => {
          void (async () => {
            const done = await withPending(
              event.currentTarget as HTMLButtonElement,
              () => sendJson('POST', `/api/jobs/${ctx.state.jobId}/actions`, { action: 'start_walkthrough' }),
              () => 'Walkthrough started.',
              (message) => message,
            );
            if (done !== null) await ctx.state.refresh();
            ctx.render();
          })();
        }),
      );
    }
    if (job.status === 'walkthrough') {
      stageButtons.append(
        button('Close out job', { 'data-fk': 'closeout' }, (event) =>
          openCloseOut(ctx, event.currentTarget as HTMLButtonElement),
        ),
      );
    }
    header.append(stageButtons);
  }

  const tabs: TabKey[] = ['punch'];
  if (role === 'owner') tabs.push('setup');
  if (role === 'owner' || role === 'lead') tabs.push('people');
  if (role === 'owner' || role === 'lead') tabs.push('costs');
  if (role === 'owner' || role === 'lead') tabs.push('access');
  if (role === 'owner') tabs.push('outbox');
  if (!tabs.includes(ctx.ui.tab)) ctx.ui.tab = 'punch';

  const tabList = el('div', { class: 'tablist', role: 'tablist' });
  for (const key of tabs) {
    const tab = el(
      'button',
      {
        type: 'button',
        role: 'tab',
        'aria-selected': ctx.ui.tab === key ? 'true' : 'false',
        tabindex: ctx.ui.tab === key ? '0' : '-1',
        'data-fk': `tab-${key}`,
      },
      [TAB_LABELS[key]],
    );
    tab.addEventListener('click', () => {
      ctx.ui.tab = key;
      ctx.render();
    });
    tabList.append(tab);
  }
  header.append(tabList);

  const panel = el('div', { class: 'tabpanel', role: 'tabpanel', 'aria-label': TAB_LABELS[ctx.ui.tab] });
  let plan: PlanPane | null = null;

  if (ctx.ui.tab === 'punch') {
    const list = buildList(ctx, { startPlacement: (itemId) => startPlacement(ctx, itemId) });
    const layout = el('div', { class: `punchlayout mode-${mode}` }, [list]);
    plan = buildPlanPane({
      data,
      aspect: ctx.ui.planAspect,
      viewport: ctx.ui.planViewport,
      placement: ctx.ui.placement,
      selectedItemId: ctx.ui.selectedItemId,
      onViewportChange: (viewport) => {
        ctx.ui.planViewport = viewport;
      },
      onAspect: (aspect) => {
        ctx.ui.planAspect = aspect;
      },
      onSelectItem: (itemId) => {
        select(ctx, itemId);
        const row = document.querySelector(`[data-item="${itemId}"]`);
        row?.scrollIntoView({ block: 'nearest' });
      },
      onPlacementMove: (x, y) => {
        if (ctx.ui.placement === null) return;
        ctx.ui.placement = { ...ctx.ui.placement, x, y };
        ctx.render();
      },
      onDropPin: () => void commitPlacement(ctx),
      onCancelPlacement: () => cancelPlacement(ctx),
      onDropOnPlan: (itemId, x, y) => {
        const item = data.items.find((candidate) => candidate.id === itemId);
        if (item !== undefined) void dropPin(ctx, item, { x, y }, null);
      },
    });

    if (mode === 'wide') {
      layout.append(plan.root);
    } else if (mode === 'rail') {
      const rail = el('div', { class: 'planrail' }, [plan.root]);
      rail.hidden = !ctx.ui.showPlan;
      const toggle = button(
        'Show plan',
        { 'aria-expanded': ctx.ui.showPlan ? 'true' : 'false', 'data-fk': 'showplan' },
        () => {
          ctx.ui.showPlan = !ctx.ui.showPlan;
          ctx.render();
        },
      );
      layout.append(toggle, rail);
    } else {
      const closeSheet = (): void => {
        ctx.ui.showPlan = false;
        ctx.render();
        document.querySelector<HTMLElement>('[data-fk="showplan"]')?.focus();
      };
      const sheet = el(
        'div',
        { class: 'plansheetdialog', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Plan' },
        [
          el('div', { class: 'sheethandle' }),
          plan.root,
          button('Close plan', { 'data-fk': 'closeplan' }, closeSheet),
        ],
      );
      sheet.hidden = !ctx.ui.showPlan;
      const toggle = button('Show plan', { class: 'showplanbar', 'data-fk': 'showplan' }, () => {
        ctx.ui.showPlan = true;
        ctx.render();
      });
      layout.append(toggle, sheet);
      trapFocus(sheet);
      sheet.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        closeSheet();
      });
      let swipeFrom: number | null = null;
      const handle = sheet.querySelector<HTMLElement>('.sheethandle')!;
      handle.addEventListener('pointerdown', (event) => {
        swipeFrom = event.clientY;
      });
      handle.addEventListener('pointerup', (event) => {
        if (swipeFrom !== null && event.clientY - swipeFrom > 24) closeSheet();
        swipeFrom = null;
      });
    }
    panel.append(layout);
  } else if (ctx.ui.tab === 'setup') {
    panel.append(setupPanel(ctx));
  } else if (ctx.ui.tab === 'people') {
    panel.append(peoplePanel(ctx));
  } else if (ctx.ui.tab === 'costs') {
    panel.append(costsPanel(ctx));
  } else if (ctx.ui.tab === 'access') {
    panel.append(accessPanel(ctx, accessTabPanel(ctx)));
  } else {
    panel.append(outboxPanel(ctx));
  }

  root.replaceChildren(el('section', { class: 'job' }, [header, panel]));
  restoreFocus(memory);

  if (plan !== null) {
    plan.layout();
    const framed = ctx.ui.pendingFrame;
    ctx.ui.pendingFrame = null;
    const planVisible = mode === 'wide' || (mode === 'rail' && ctx.ui.showPlan) || (mode === 'sheet' && ctx.ui.showPlan);
    if (framed !== null && planVisible) {
      plan.frameRoom(framed);
      runTether(ctx, plan, mode, framed);
    } else if (ctx.ui.selectedItemId !== null && planVisible) {
      runTether(ctx, plan, mode, null);
    }
  }
}

/* ------------------------------------------------------------ room tether */

function selectedItem(ctx: JobCtx): LocalItem | undefined {
  return ctx.state.data?.items.find((item) => item.id === ctx.ui.selectedItemId);
}

function runTether(ctx: JobCtx, plan: PlanPane, mode: LayoutMode, framed: string | null): void {
  document.querySelectorAll('.tetherlayer').forEach((node) => node.remove());
  const item = selectedItem(ctx);
  if (item === undefined || item.pin === null) return;
  if (mode === 'sheet') return;
  if (mode === 'rail' && !ctx.ui.showPlan) return;
  const row = document.querySelector<HTMLElement>(`[data-item="${item.id}"]`);
  if (row === null) return;

  const pinNode = document.querySelector<HTMLElement>(`[data-fk="pin-${item.id}"]`);
  if (prefersReducedMotion()) {
    pinNode?.classList.add('reducedring');
    return;
  }

  const layer = svg('svg', { class: 'tetherlayer', 'aria-hidden': 'true' });
  const line = svg('line', {
    class: 'tetherline',
    'data-tether': String(itemNumberText(item)),
  });
  layer.append(line);
  document.body.append(layer);

  const paintLine = (): void => {
    const rowBox = row.getBoundingClientRect();
    const centre = plan.pinCentre(item.id);
    if (centre === null || rowBox.width === 0) {
      layer.remove();
      return;
    }
    const summary = row.querySelector<HTMLElement>('.rowsummary');
    const summaryBox = (summary ?? row).getBoundingClientRect();
    line.setAttribute('x1', String(rowBox.right));
    line.setAttribute('y1', String(summaryBox.top + summaryBox.height / 2));
    line.setAttribute('x2', String(centre.x));
    line.setAttribute('y2', String(centre.y));
  };

  const start = (): void => {
    paintLine();
    const length = Math.hypot(
      Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')),
      Number(line.getAttribute('y2')) - Number(line.getAttribute('y1')),
    );
    line.style.strokeDasharray = `${length}`;
    animate(320, (progress) => {
      line.style.strokeDashoffset = String(length * (1 - progress));
      if (progress === 1) {
        line.style.strokeDasharray = '';
        line.style.strokeDashoffset = '';
        pinNode?.classList.add('pulsing');
        window.setTimeout(() => pinNode?.classList.remove('pulsing'), 340);
      }
    });
  };

  if (framed === null) start();
  else window.setTimeout(start, 440);

  const reposition = (): void => {
    if (!document.body.contains(layer)) return;
    paintLine();
  };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
}

/* ---------------------------------------------------------- pin placement */

function startPlacement(ctx: JobCtx, itemId: string): void {
  const item = ctx.state.data?.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) return;
  const room = roomOf(ctx, item);
  if (room === undefined) return;
  ctx.ui.selectedItemId = itemId;
  ctx.ui.showPlan = true;
  ctx.ui.placement = { itemId, x: room.anchor.x, y: room.anchor.y };
  ctx.render();
}

function cancelPlacement(ctx: JobCtx): void {
  const itemId = ctx.ui.placement?.itemId ?? null;
  ctx.ui.placement = null;
  ctx.render();
  if (itemId !== null) {
    document.querySelector<HTMLElement>(`[data-fk="row-${itemId}"]`)?.focus();
  }
}

async function commitPlacement(ctx: JobCtx): Promise<void> {
  const placement = ctx.ui.placement;
  if (placement === null) return;
  const item = ctx.state.data?.items.find((candidate) => candidate.id === placement.itemId);
  if (item === undefined) return;
  const ok = await dropPin(ctx, item, { x: placement.x, y: placement.y }, null);
  if (ok) {
    ctx.ui.placement = null;
    ctx.render();
    document.querySelector<HTMLElement>(`[data-fk="row-${placement.itemId}"]`)?.focus();
  }
}

function installPlacementKeys(ctx: JobCtx): void {
  document.addEventListener('keydown', (event) => {
    const placement = ctx.ui.placement;
    if (placement === null || hasOpenDialog()) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    let moved = false;
    let { x, y } = placement;
    if (event.key === 'ArrowLeft') {
      x = Math.max(0, x - step);
      moved = true;
    } else if (event.key === 'ArrowRight') {
      x = Math.min(1, x + step);
      moved = true;
    } else if (event.key === 'ArrowUp') {
      y = Math.max(0, y - step);
      moved = true;
    } else if (event.key === 'ArrowDown') {
      y = Math.min(1, y + step);
      moved = true;
    }
    if (moved) {
      event.preventDefault();
      ctx.ui.placement = { itemId: placement.itemId, x: round4(x), y: round4(y) };
      ctx.render();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void commitPlacement(ctx);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelPlacement(ctx);
    }
  });
  window.addEventListener('resize', () => ctx.render());
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function openCloseOut(ctx: JobCtx, opener: HTMLButtonElement): void {
  openDialog(
    'Close out job',
    (dialog) => {
      dialog.body.append(
        el('p', {}, ['Every plan revision and photo is deleted at close-out.']),
        button('Close out', {}, (event) => {
          void (async () => {
            const done = await withPending(
              event.currentTarget as HTMLButtonElement,
              () => sendJson('POST', `/api/jobs/${ctx.state.jobId}/actions`, { action: 'close_out' }),
              () => 'Job closed out.',
              (message) => message,
            );
            if (done !== null) {
              await ctx.state.refresh();
              dialog.close();
              ctx.render();
            }
          })();
        }),
      );
    },
    opener,
  );
}

export const OFFLINE_TEXT = COPY.offlineBanner;
export { announce };
