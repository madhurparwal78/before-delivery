import { h } from './dom.js';
import { get, post } from './api.js';
import type { ScenarioResult } from './api.js';
import { shell, page, announce, onSocketOpen, replaceAddress } from './app.js';
import { onEvent } from './socket.js';

interface SavedScenario {
  id: string;
  name: string;
  pre_money: string;
  investment: string;
  target_pool_percent: string;
  saved_at: string;
}

page('/admin/scenario', ['founder_admin'], async (root, ctx) => {
  const person = ctx.person;
  const content = h('div', {});
  root.appendChild(shell(person, content));

  const preInput = h('input', { type: 'text', id: 's-pre' }) as HTMLInputElement;
  const invInput = h('input', { type: 'text', id: 's-inv' }) as HTMLInputElement;
  const poolInput = h('input', { type: 'text', id: 's-pool' }) as HTMLInputElement;

  const errors: Record<string, HTMLElement> = {
    pre_money: h('p', { class: 'field-error', style: { display: 'none' } }),
    investment: h('p', { class: 'field-error', style: { display: 'none' } }),
    target_pool_percent: h('p', { class: 'field-error', style: { display: 'none' } }),
  };

  const values: Record<string, HTMLElement> = {};
  const resultLabels: Array<[string, string]> = [
    ['pool_top_up', 'Pool top-up'],
    ['price_per_share', 'Price per share'],
    ['new_shares', 'New shares'],
    ['fully_diluted_after', 'Post-money fully diluted'],
    ['new_investor_percent', 'New investor'],
    ['pool_after_percent', 'Pool after'],
    ['dilution_percent', 'Dilution'],
    ['investment_used', 'Investment used'],
    ['price_to_fmv', 'Price vs fair market value'],
  ];
  const resultRegion = h('section', { role: 'region', 'aria-label': 'Scenario result' },
    h('h2', null, 'Scenario result'),
    ...resultLabels.map(([key, label]) => {
      const valueEl = h('span', { class: 'num' }, '—');
      values[key] = valueEl;
      return h('div', { class: 'value' }, h('div', { class: 'label' }, label), valueEl);
    }),
  );

  const nameInput = h('input', { type: 'text', id: 's-name' }) as HTMLInputElement;
  const saveBtn = h('button', { class: 'primary' }, 'Save scenario') as HTMLButtonElement;
  const savedList = h('ul', { role: 'list', 'aria-label': 'Saved scenarios', style: { listStyle: 'none', padding: 0 } });

  let announcedKey = '';

  function applyResult(r: ScenarioResult, settledInputs: string): void {
    values.pool_top_up!.textContent = r.pool_top_up.toLocaleString('en-US');
    values.price_per_share!.textContent = `$${r.price_per_share}`;
    values.new_shares!.textContent = r.new_shares.toLocaleString('en-US');
    values.fully_diluted_after!.textContent = r.fully_diluted_after.toLocaleString('en-US');
    values.new_investor_percent!.textContent = `${r.new_investor_percent}%`;
    values.pool_after_percent!.textContent = `${r.pool_after_percent}%`;
    values.dilution_percent!.textContent = `${r.dilution_percent}%`;
    values.investment_used!.textContent = `$${r.investment_used}`;
    values.price_to_fmv!.textContent = r.price_to_fmv !== null ? `${r.price_to_fmv}×` : 'No current valuation';
    if (announcedKey !== settledInputs) {
      announcedKey = settledInputs;
      announce(`Scenario updated: price per share $${r.price_per_share}.`, `scenario-${settledInputs}`);
    }
  }

  function greyResult(): void {
    resultRegion.style.opacity = '0.5';
  }

  let computeTimer: number | null = null;

  async function compute(): Promise<void> {
    const pre = preInput.value;
    const inv = invInput.value;
    const pool = poolInput.value;
    try {
      const r = await post<ScenarioResult>('/api/scenarios/round', {
        pre_money: pre, investment: inv, target_pool_percent: pool,
      });
      for (const el of Object.values(errors)) el.style.display = 'none';
      resultRegion.style.opacity = '1';
      applyResult(r, `${pre}|${inv}|${pool}`);
      replaceAddress(`/admin/scenario?pre=${encodeURIComponent(pre)}&investment=${encodeURIComponent(inv)}&pool=${encodeURIComponent(pool)}`);
    } catch (e) {
      const err = e as { fields?: Record<string, string> };
      if (err.fields) {
        greyResult();
        for (const el of Object.values(errors)) el.style.display = 'none';
        for (const [k, v] of Object.entries(err.fields)) {
          if (errors[k]) {
            errors[k]!.textContent = v;
            errors[k]!.style.display = 'block';
          }
        }
      }
    }
  }

  for (const input of [preInput, invInput, poolInput]) {
    input.addEventListener('input', () => {
      if (computeTimer) window.clearTimeout(computeTimer);
      computeTimer = window.setTimeout(() => { void compute(); }, 400);
    });
  }

  async function drawSaved(): Promise<void> {
    const { scenarios } = await get<{ scenarios: SavedScenario[] }>('/api/scenarios/saved');
    savedList.replaceChildren(...scenarios.map((s) => {
      const li = h('li', { style: { marginBottom: '8px' } });
      const link = h('a', { href: `/admin/scenario?pre=${encodeURIComponent(s.pre_money)}&investment=${encodeURIComponent(s.investment)}&pool=${encodeURIComponent(s.target_pool_percent)}`, 'data-scenario': s.id }, s.name);
      link.addEventListener('click', (ev) => {
        ev.preventDefault();
        history.pushState({}, '', link.getAttribute('href')!);
        preInput.value = s.pre_money;
        invInput.value = s.investment;
        poolInput.value = s.target_pool_percent;
        void compute();
      });
      li.appendChild(link);
      return li;
    }));
  }

  saveBtn.addEventListener('click', async () => {
    try {
      const r = await post<{ scenario: SavedScenario }>('/api/scenarios/saved', {
        name: nameInput.value, pre_money: preInput.value, investment: invInput.value, target_pool_percent: poolInput.value,
      });
      announce(`Scenario ${r.scenario.name} saved.`, `save-${r.scenario.id}`);
      await drawSaved();
    } catch (e) {
      const err = e as { fields?: Record<string, string>; message?: string };
      announce(Object.values(err.fields ?? {})[0] ?? err.message ?? '', 'save-fail');
    }
  });

  const form = h('form', { class: 'narrow', 'aria-label': 'Round scenario', onsubmit: (ev: Event) => { ev.preventDefault(); } },
    h('label', { for: 's-pre' }, 'Pre-money valuation'), preInput, errors.pre_money!,
    h('label', { for: 's-inv' }, 'New investment'), invInput, errors.investment!,
    h('label', { for: 's-pool' }, 'Target pool after the round'), poolInput, errors.target_pool_percent!,
  );

  const saveForm = h('form', { class: 'narrow', 'aria-label': 'Save scenario', onsubmit: (ev: Event) => { ev.preventDefault(); } },
    h('label', { for: 's-name' }, 'Scenario name'), nameInput, saveBtn,
  );

  content.replaceChildren(h('h1', null, 'Round scenario'), form, resultRegion, saveForm, savedList);

  // Fill from the address: reload, Back and a second tab show the same inputs and result.
  const pre = ctx.query.get('pre');
  const inv = ctx.query.get('investment');
  const pool = ctx.query.get('pool');
  if (pre !== null) preInput.value = pre;
  if (inv !== null) invInput.value = inv;
  if (pool !== null) poolInput.value = pool;
  if (pre !== null || inv !== null || pool !== null) {
    await compute();
  }

  await drawSaved();

  onSocketOpen((open) => { saveBtn.disabled = !open; });

  // A saved scenario from any open scenario page appears here within a second.
  onEvent((ev) => {
    if (ev.type === 'scenario_saved') {
      void drawSaved();
    }
    if (ev.type === 'valuation_changed') {
      void compute();
    }
  });
});
