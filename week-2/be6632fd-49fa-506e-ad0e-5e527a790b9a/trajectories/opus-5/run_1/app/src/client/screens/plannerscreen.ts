import { STATUS_COPY } from '../../domain/copy.ts';
import type { DropType } from '../../domain/golive.ts';
import { MARKETS, marketCity } from '../../domain/markets.ts';
import {
  formatCopenhagenInstant,
  formatInstant,
  formatMarketTime,
  parseInstant,
} from '../../domain/time.ts';
import { Dial, openingsForState } from '../dial.ts';
import { openDialog, setFocusAfterSuccess } from '../dialogs.ts';
import { request } from '../net.ts';
import { control, numberOf, onAction, onOpen, pageData, valueOf } from '../ui.ts';

interface PlannerData {
  screen: 'planner';
  dropId: string;
  dropName: string;
  status: string;
  type: DropType;
  date: string;
  time: string;
  step: number;
}

interface RestockAnswer {
  weekday: string;
  copenhagenTime: string;
  nextInstants: string[];
}

export function startPlannerScreen(): void {
  const data = pageData<PlannerData>();
  const root = document.querySelector<HTMLElement>('[data-dial="root"]');
  const slider = document.querySelector<HTMLElement>('[data-dial-slider]');
  if (root === null || slider === null) return;

  const dial = new Dial(
    { root, slider, onChange: () => undefined },
    { date: data.date, time: data.time, type: data.type, step: data.step },
  );

  control('dropDate')?.addEventListener('input', (event) => {
    dial.setDate((event.target as HTMLInputElement).value.trim());
  });
  for (const radio of document.querySelectorAll<HTMLInputElement>(
    '[data-field-control="dropType"]',
  )) {
    radio.addEventListener('change', () => dial.setType(radio.value as DropType));
  }

  const timingBody = (): Record<string, unknown> => {
    const state = dial.current;
    return state.type === 'rolling'
      ? { type: 'rolling', localGoLive: `${state.date}T${state.time}` }
      : { type: 'simultaneous', copenhagenGoLive: `${state.date}T${state.time}` };
  };

  onAction(
    'save-time',
    async () =>
      request(`/api/drops/${encodeURIComponent(data.dropId)}`, {
        method: 'PATCH',
        body: timingBody(),
      }),
    {
      region: 'Planner status',
      success: () => {
        const { openings } = openingsForState(dial.current);
        const copenhagen = openings?.find((opening) => opening.market === 'copenhagen') ?? null;
        return STATUS_COPY.goLiveSaved(
          copenhagen === null ? '' : formatCopenhagenInstant(copenhagen.instantMs),
        );
      },
      own: (failure) => (failure.code === 'drop_locked' ? STATUS_COPY.dropLocked : null),
      map: (path) => (path === 'copenhagenGoLive' || path === 'localGoLive' ? 'dropDate' : path),
    },
  );

  onAction(
    'schedule-drop',
    async () =>
      request(`/api/drops/${encodeURIComponent(data.dropId)}/schedule`, { method: 'POST' }),
    {
      region: 'Planner status',
      success: STATUS_COPY.dropScheduled,
      own: (failure) => (failure.code === 'drop_not_draft' ? STATUS_COPY.notDraft : null),
    },
  );

  onOpen('open-withdraw', (button) => openDialog('Withdraw drop', button));
  setFocusAfterSuccess('Withdraw drop', () =>
    document.querySelector<HTMLElement>('h1.page-heading'),
  );
  onAction(
    'withdraw-drop',
    async () =>
      request(`/api/drops/${encodeURIComponent(data.dropId)}/withdraw`, {
        method: 'POST',
        body: { reason: valueOf('reason') },
      }),
    {
      region: 'Planner status',
      dialog: 'Withdraw drop',
      success: STATUS_COPY.dropWithdrawn,
    },
  );

  onOpen('open-vip', (button) => openDialog('Add VIP members', button));
  onAction(
    'add-vip',
    async () => {
      const market = valueOf('vipMarket');
      const members = parseVipList(control('vipList')?.value ?? '');
      const answer = await request<{ items: unknown[] }>(
        `/api/drops/${encodeURIComponent(data.dropId)}/waitlist/vip`,
        { method: 'POST', body: { market, members } },
      );
      return { count: answer.items.length, market };
    },
    {
      region: 'Planner status',
      dialog: 'Add VIP members',
      success: (result) => {
        const answer = result as { count: number; market: string };
        return STATUS_COPY.vipAdded(answer.count, marketCity(answer.market as never));
      },
    },
  );

  onAction(
    'save-restock',
    async () => {
      const pieces: Record<string, number> = {};
      for (const market of MARKETS) pieces[market] = numberOf(`restock.${market}`);
      return request<RestockAnswer>(
        `/api/drops/${encodeURIComponent(data.dropId)}/restocks`,
        {
          method: 'POST',
          body: {
            firstRestock: `${valueOf('firstRestockDate')}T${valueOf('restockTime')}`,
            pieces,
          },
        },
      );
    },
    {
      region: 'Planner status',
      success: (result) => {
        const answer = result as RestockAnswer;
        return STATUS_COPY.restockSaved(answer.weekday, answer.copenhagenTime);
      },
      map: (path) => (path === 'firstRestock' ? 'firstRestockDate' : path.replace('pieces.', 'restock.')),
      after: (result) => renderNextRestocks((result as RestockAnswer).nextInstants),
    },
  );
}

function parseVipList(value: string): { name: string; email: string }[] {
  const members: { name: string; email: string }[] = [];
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const match = /^(.*?)\s*<([^>]+)>$/.exec(trimmed);
    if (match === null) {
      members.push({ name: trimmed, email: '' });
      continue;
    }
    members.push({ name: (match[1] ?? '').trim(), email: (match[2] ?? '').trim() });
  }
  return members;
}

function renderNextRestocks(instants: readonly string[]): void {
  const body = document.querySelector<HTMLElement>('[data-next-restocks]');
  if (body === null) return;
  body.replaceChildren(
    ...instants.map((value, index) => {
      const instant = parseInstant(value) ?? 0;
      const row = document.createElement('tr');
      for (const text of [
        String(index + 1),
        formatMarketTime(instant, 'copenhagen'),
        formatMarketTime(instant, 'london'),
        formatMarketTime(instant, 'new_york'),
        formatInstant(instant),
      ]) {
        const cell = document.createElement('td');
        cell.className = 'mono';
        cell.textContent = text;
        row.append(cell);
      }
      return row;
    }),
  );
}
