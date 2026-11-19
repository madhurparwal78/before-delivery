// Group scores: the site tree, every window's grains and each month's totals.

import { get, put } from '../api.js';
import { announce, clear, el, liveRegion } from '../dom.js';
import { commas, percent } from '../format.js';
import { linkTo, navigate, pushQuery, replaceQuery } from '../router.js';

const GRAIN_WORDS = ['MONTH', 'WEEK', 'DAY', 'HOUR'];
const ASSIGNABLE = ['Awaiting meters', 'Reconciling', 'Returned'];
const PERCENT_MESSAGE = 'Enter a percent from 0.00 to 100.00 with at most two decimals.';

function basisPoints(text) {
  // A typed percent to basis points, digit by digit, with no binary floating point.
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = (match[2] || '').padEnd(2, '0');
  const bp = whole * 100 + Number(fraction);
  if (bp > 10000) return null;
  return bp;
}

export async function mount({ container, query }) {
  let windows = [];
  let rollups = [];
  let firms = [];
  let sites = [];
  let openSites = new Set();
  let filter = query.site || null;

  const tree = el('ul', { role: 'tree', 'aria-label': 'Sites', className: 'tree' });
  const totalsBody = el('tbody');
  const totals = el('table', { 'aria-label': 'Group totals' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Month' }),
        el('th', { scope: 'col', text: 'Windows' }),
        el('th', { scope: 'col', text: 'Consumed' }),
        el('th', { scope: 'col', text: 'Month' }),
        el('th', { scope: 'col', text: 'Week' }),
        el('th', { scope: 'col', text: 'Day' }),
        el('th', { scope: 'col', text: 'Hour' }),
        el('th', { scope: 'col', text: 'Residual' }),
      ]),
    ]),
    totalsBody,
  ]);
  const scoresBody = el('tbody');
  const scores = el('table', { 'aria-label': 'Site scores' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: 'Window' }),
        el('th', { scope: 'col', text: 'State' }),
        el('th', { scope: 'col', text: 'Month' }),
        el('th', { scope: 'col', text: 'Week' }),
        el('th', { scope: 'col', text: 'Day' }),
        el('th', { scope: 'col', text: 'Hour' }),
        el('th', { scope: 'col', text: 'Target' }),
        el('th', { scope: 'col', text: 'Residual' }),
        el('th', { scope: 'col', text: 'Verifier firm' }),
      ]),
    ]),
    scoresBody,
  ]);
  const policies = el('div', { className: 'stack' });
  const showEvery = el('button', { type: 'button', text: 'Show every site' });
  showEvery.addEventListener('click', () => {
    filter = null;
    replaceQuery('/group');
    paint();
  });
  container.append(
    el('div', { className: 'panel stack' }, [
      el('h1', { text: 'EVERY SITE. EVERY GRAIN.' }),
      liveRegion('Group status', 'status'),
    ]),
    el('div', { className: 'group-grid' }, [
      el('div', { className: 'panel panel--mustard stack' }, [tree, showEvery]),
      el('div', { className: 'stack' }, [
        el('div', { className: 'panel panel--white' }, [
          el('div', { className: 'table-wrap' }, [totals]),
        ]),
        el('div', { className: 'panel panel--white' }, [
          el('div', { className: 'table-wrap' }, [scores]),
        ]),
        policies,
      ]),
    ])
  );

  // -------------------------------------------------------------------- tree

  let treeFocus = null;

  function visibleItems() {
    return Array.from(tree.querySelectorAll('[role="treeitem"]'));
  }

  function paintTree() {
    clear(tree);
    sites.forEach((site) => {
      const open = openSites.has(site.id);
      const item = el('li', { role: 'none' });
      const label = el('div', {
        role: 'treeitem',
        tabindex: '-1',
        'aria-expanded': String(open),
        'aria-selected': String(filter === site.id),
        'aria-label': site.name,
        text: site.name,
        dataset: { site: site.id },
      });
      item.append(label);
      if (open) {
        const children = windows
          .filter((row) => row.site.id === site.id)
          .map((row) =>
            el('li', { role: 'none' }, [
              el('div', {
                role: 'treeitem',
                tabindex: '-1',
                'aria-label': `${site.name} ${row.month}`,
                text: `${site.name} ${row.month}`,
                dataset: { window: row.id, site: site.id },
              }),
            ])
          );
        item.append(el('ul', { role: 'group' }, children));
      }
      tree.append(item);
    });
    const items = visibleItems();
    if (!items.length) return;
    const wanted = items.find((item) => item.dataset.site === treeFocus) || items[0];
    items.forEach((item) => item.setAttribute('tabindex', item === wanted ? '0' : '-1'));
    items.forEach((item) => {
      item.addEventListener('click', () => activate(item));
      item.addEventListener('keydown', (event) => treeKey(event, item));
    });
  }

  function activate(item) {
    if (item.dataset.window) {
      navigate(`/windows/${item.dataset.window}`);
      return;
    }
    const site = item.dataset.site;
    if (openSites.has(site)) openSites.delete(site);
    else openSites.add(site);
    filter = openSites.has(site) ? site : null;
    treeFocus = site;
    pushQuery(filter ? `/group?site=${encodeURIComponent(filter)}` : '/group');
    paint();
    const count = shownWindows().length;
    announce('Group status', `${count} windows shown.`);
  }

  function treeKey(event, item) {
    const items = visibleItems();
    const index = items.indexOf(item);
    const move = (next) => {
      if (!next) return;
      items.forEach((node) => node.setAttribute('tabindex', '-1'));
      next.setAttribute('tabindex', '0');
      next.focus();
      treeFocus = next.dataset.site;
    };
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(items[index + 1]);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(items[index - 1]);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(items[0]);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(items[items.length - 1]);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (item.dataset.window) return;
      if (item.getAttribute('aria-expanded') === 'false') activate(item);
      else move(items[index + 1]);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (item.dataset.window) {
        move(items.find((node) => node.dataset.site === item.dataset.site && !node.dataset.window));
      } else if (item.getAttribute('aria-expanded') === 'true') {
        activate(item);
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(item);
    }
  }

  // ------------------------------------------------------------------ tables

  function shownWindows() {
    return filter ? windows.filter((row) => row.site.id === filter) : windows;
  }

  function paintTables() {
    clear(totalsBody);
    rollups.forEach((row) =>
      totalsBody.append(
        el('tr', {}, [
          el('td', { text: row.month }),
          el('td', { text: String(row.window_count) }),
          el('td', { text: `${commas(row.consumed_wh)} Wh` }),
          el('td', { text: `${percent(row.scores.month_bp)}%` }),
          el('td', { text: `${percent(row.scores.week_bp)}%` }),
          el('td', { text: `${percent(row.scores.day_bp)}%` }),
          el('td', { text: `${percent(row.scores.hour_bp)}%` }),
          el('td', {
            text:
              row.residual_emissions_g === null
                ? 'unknown'
                : `${commas(row.residual_emissions_g)} g CO2`,
          }),
        ])
      )
    );
    clear(scoresBody);
    shownWindows().forEach((row) => {
      const firmCell = el('td', {});
      if (ASSIGNABLE.includes(row.state)) {
        const select = el(
          'select',
          { id: `firm-${row.id}` },
          firms.map((firm) =>
            el('option', {
              value: firm.id,
              text: firm.name,
              selected: row.verifier_firm && row.verifier_firm.id === firm.id ? true : null,
            })
          )
        );
        select.setAttribute('aria-label', 'Verifier firm');
        const assign = el('button', { type: 'button', text: 'Assign' });
        assign.addEventListener('click', async () => {
          const answer = await put(`/api/windows/${row.id}/verifier`, {
            firm_id: select.value,
          });
          if (answer.cancelled) return;
          if (answer.status !== 200) {
            announce('Group status', answer.error ? answer.error.message : '');
            return;
          }
          announce('Group status', 'Verifier firm assigned.');
          await load();
        });
        firmCell.append(select, assign);
      } else {
        firmCell.textContent = row.verifier_firm ? row.verifier_firm.name : 'none';
      }
      scoresBody.append(
        el('tr', {}, [
          el('td', {}, [linkTo(`/windows/${row.id}`, `${row.site.name} ${row.month}`)]),
          el('td', { text: row.state }),
          el('td', { text: `${percent(row.scores.month_bp)}%` }),
          el('td', { text: `${percent(row.scores.week_bp)}%` }),
          el('td', { text: `${percent(row.scores.day_bp)}%` }),
          el('td', { text: `${percent(row.scores.hour_bp)}%` }),
          el('td', { text: row.target.met ? 'On target' : 'Off target' }),
          el('td', {
            text:
              row.residual_emissions_g === null
                ? 'unknown'
                : `${commas(row.residual_emissions_g)} g CO2`,
          }),
          firmCell,
        ])
      );
    });
  }

  function paintPolicies() {
    clear(policies);
    sites.forEach((site) => {
      const grain = el(
        'select',
        { id: `grain-${site.id}` },
        GRAIN_WORDS.map((word) =>
          el('option', {
            value: word,
            text: word,
            selected: site.target_grain === word ? true : null,
          })
        )
      );
      const value = el('input', { type: 'text', id: `target-${site.id}` });
      value.value = percent(site.target_bp);
      const save = el('button', { type: 'button', text: 'Save policy' });
      const alertRegion = el('div', {
        role: 'alert',
        'aria-live': 'assertive',
        'aria-label': 'Problems to fix',
        className: 'problems',
      });
      save.addEventListener('click', async () => {
        clear(alertRegion);
        const bp = basisPoints(value.value);
        if (bp === null) {
          alertRegion.append(el('p', { text: PERCENT_MESSAGE }));
          return;
        }
        const answer = await put(`/api/sites/${site.id}/policy`, {
          target_grain: grain.value,
          target_bp: bp,
        });
        if (answer.cancelled) return;
        if (answer.status !== 200) {
          alertRegion.append(
            el('p', { text: answer.error ? answer.error.message : PERCENT_MESSAGE })
          );
          return;
        }
        announce('Group status', `Policy saved for ${site.name}.`);
        await load();
      });
      policies.append(
        el(
          'div',
          {
            role: 'region',
            'aria-label': `${site.name} policy`,
            className: 'panel panel--white stack',
            dataset: { formRoot: 'true' },
          },
          [
            el('h3', { text: site.name }),
            alertRegion,
            el('div', { className: 'field' }, [
              el('label', { for: `grain-${site.id}`, text: 'Target grain' }),
              grain,
            ]),
            el('div', { className: 'field' }, [
              el('label', { for: `target-${site.id}`, text: 'Target percent' }),
              value,
            ]),
            save,
          ]
        )
      );
    });
  }

  function paint() {
    paintTree();
    paintTables();
    paintPolicies();
  }

  async function load() {
    const [groupAnswer, firmAnswer] = await Promise.all([
      get('/api/group/scores'),
      get('/api/firms'),
    ]);
    if (groupAnswer.status !== 200) return;
    windows = groupAnswer.data.windows;
    rollups = groupAnswer.data.rollups;
    if (firmAnswer.status === 200) firms = firmAnswer.data.firms;
    const frozen = ['Signed', 'Sealed', 'Restated'];
    const seen = new Map();
    windows.forEach((row) => {
      const current = seen.get(row.site.id);
      const policy = {
        id: row.site.id,
        name: row.site.name,
        target_grain: row.target.grain,
        target_bp: row.target.bp,
        frozen: frozen.includes(row.state),
      };
      // The site's live policy shows on any window that has not been signed.
      if (!current || (current.frozen && !policy.frozen)) seen.set(row.site.id, policy);
    });
    sites = Array.from(seen.values()).sort((left, right) =>
      left.name < right.name ? -1 : 1
    );
    if (filter && !sites.some((site) => site.id === filter)) filter = null;
    if (filter) openSites.add(filter);
    paint();
  }

  await load();
  return {
    refresh: load,
    query(next) {
      filter = next.site || null;
      if (filter) openSites.add(filter);
      paint();
    },
  };
}
