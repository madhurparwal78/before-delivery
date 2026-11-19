import { api, type Cohort, type RosterRow, type SharedEntry } from '../api.js';
import { COPY, dollars, phaseLabel, rosterNight, statusLabel } from '../copy.js';
import { Dialog } from '../dialog.js';
import { h, setHidden, setText } from '../dom.js';
import { announce, statusRegion } from '../live.js';

const ROSTER_REFRESH_MS = 30_000;

const COLUMNS = [
  'Dreamer',
  'Status',
  'Night',
  'Recall',
  'Technique minutes',
  'WBTB nights',
  'Reality checks',
  'Inner awareness',
  'Action',
  'Form',
  'Context',
  'Actions',
] as const;

type LayoutMode = 'phone' | 'tablet' | 'desktop';

function layoutMode(): LayoutMode {
  const width = window.innerWidth;
  if (width < 768) return 'phone';
  if (width < 1200) return 'tablet';
  return 'desktop';
}

function rowValues(row: RosterRow): string[] {
  return [
    statusLabel(row.status),
    rosterNight(row.night_number),
    `${Math.round(row.recall_rate * 100)}%`,
    String(row.technique_minutes),
    String(row.wbtb_nights),
    String(row.reality_checks),
    String(row.sign_tallies.inner_awareness),
    String(row.sign_tallies.action),
    String(row.sign_tallies.form),
    String(row.sign_tallies.context),
  ];
}

export function coachScreen(): Node {
  let cohorts: Cohort[] = [];
  let selected: Cohort | null = null;
  let roster: RosterRow[] = [];
  let openShared: { entryId: string; dreamer: RosterRow } | null = null;
  let layout = layoutMode();

  const updates = statusRegion('Coach updates');
  const chooser = h('div', { class: 'chooser' });
  const newCohortToggle = h('button', { type: 'button', class: 'ghost', text: 'New cohort' });
  const cohortHeading = h('h2', {});
  const phaseNode = h('p', { class: 'phase muted' });
  const publishButton = h('button', { type: 'button', class: 'ghost', text: 'Publish cohort' });
  const closeButton = h('button', { type: 'button', class: 'ghost', text: 'Close cohort' });
  const digestButton = h('button', {
    type: 'button',
    class: 'ghost',
    text: 'Send weekly digest',
  });
  const cohortHeader = h('div', { class: 'cohort-header' }, [
    cohortHeading,
    phaseNode,
    h('div', { class: 'row' }, [publishButton, closeButton, digestButton]),
  ]);

  const tableHead = h('tr', {});
  for (const column of COLUMNS) {
    tableHead.append(h('th', { scope: 'col', text: column }));
  }
  const tableBody = h('tbody', {});
  const table = h('table', { 'aria-label': 'Roster', class: 'roster' }, [
    h('thead', {}, [tableHead]),
    tableBody,
  ]);
  const rosterView = h(
    'div',
    { role: 'region', 'aria-label': 'Roster view', tabindex: '0', class: 'roster-view' },
    [table],
  );
  const cards = h('div', { class: 'roster-cards' });

  const nameInput = h('input', { type: 'text', 'aria-label': 'Cohort name', id: 'cohort-name' });
  const firstNightInput = h('input', {
    type: 'text',
    'aria-label': 'First night',
    id: 'cohort-first-night',
    placeholder: 'YYYY-MM-DD',
  });
  const priceInput = h('input', {
    type: 'text',
    'aria-label': 'Seat price (USD)',
    id: 'cohort-price',
  });
  const seatsInput = h('input', {
    type: 'number',
    'aria-label': 'Seats',
    id: 'cohort-seats',
    min: '1',
    max: '50',
  });
  const nameError = h('p', { class: 'field-error' });
  const firstNightError = h('p', { class: 'field-error' });
  const priceError = h('p', { class: 'field-error' });
  const seatsError = h('p', { class: 'field-error' });
  const createButton = h('button', { type: 'submit', class: 'primary', text: 'Create cohort' });
  const newCohortForm = h('form', { 'aria-label': 'New cohort', class: 'new-cohort stack' }, [
    h('div', { class: 'field' }, [
      h('label', { for: 'cohort-name', text: 'Cohort name' }),
      nameInput,
      nameError,
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'cohort-first-night', text: 'First night' }),
      firstNightInput,
      firstNightError,
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'cohort-price', text: 'Seat price (USD)' }),
      priceInput,
      priceError,
    ]),
    h('div', { class: 'field' }, [
      h('label', { for: 'cohort-seats', text: 'Seats' }),
      seatsInput,
      seatsError,
    ]),
    createButton,
  ]);

  const sidebar = h('div', { class: 'coach-sidebar' }, [chooser, newCohortToggle, newCohortForm]);
  const detail = h('div', { class: 'coach-detail' }, [cohortHeader, updates, rosterView, cards]);
  const screen = h('section', { class: 'screen coach' }, [
    h('h1', { text: 'Cohorts' }),
    h('div', { class: 'coach-grid' }, [sidebar, detail]),
  ]);

  // Refund dialog
  const refundQuestion = h('p', {});
  const confirmRefund = h('button', { type: 'button', class: 'primary', text: 'Confirm refund' });
  const cancelRefund = h('button', { type: 'button', class: 'ghost', text: 'Cancel' });
  const refundDialog = new Dialog({ label: 'Refund seat', className: 'panel' });
  refundDialog.element.append(
    h('h2', { text: 'Refund seat' }),
    refundQuestion,
    h('div', { class: 'row' }, [confirmRefund, cancelRefund]),
  );
  screen.append(refundDialog.element);
  cancelRefund.addEventListener('click', () => {
    refundDialog.close();
  });

  // Shared entry dialog
  const sharedTitle = h('h2', {});
  const sharedText = h('p', { class: 'shared-text' });
  const sharedMemo = h('div', { class: 'shared-memo' });
  const closeShared = h('button', { type: 'button', class: 'ghost', text: 'Close' });
  const sharedDialog = new Dialog({
    label: 'Shared entry',
    className: 'panel',
    onClose: () => {
      openShared = null;
    },
  });
  sharedDialog.element.append(sharedTitle, sharedText, sharedMemo, closeShared);
  screen.append(sharedDialog.element);
  closeShared.addEventListener('click', () => {
    sharedDialog.close();
  });

  function cohortUrl(id: string): string {
    return `/coach?cohort=${id}`;
  }

  function renderChooser(): void {
    chooser.replaceChildren();
    if (layout === 'phone') {
      const select = h('select', { 'aria-label': 'Cohort', class: 'cohort-picker' });
      for (const cohort of cohorts) {
        const option = h('option', {
          value: cohort.id,
          text: cohort.name,
          selected: cohort.id === selected?.id,
        });
        select.append(option);
      }
      select.addEventListener('change', () => {
        choose(select.value, true);
      });
      chooser.append(select);
      return;
    }
    if (layout === 'tablet') {
      const list = h('div', { role: 'tablist', 'aria-label': 'Cohort list', class: 'tabs' });
      for (const cohort of cohorts) {
        const describedBy = `phase-${cohort.id}`;
        const tab = h(
          'button',
          {
            type: 'button',
            role: 'tab',
            'aria-label': cohort.name,
            'aria-describedby': describedBy,
            'aria-selected': cohort.id === selected?.id ? 'true' : 'false',
            class: 'tab',
          },
          [
            h('span', { class: 'tab-name', text: cohort.name }),
            h('span', {
              class: 'tab-phase muted',
              id: describedBy,
              text: phaseLabel(cohort.phase, cohort.week),
            }),
          ],
        );
        tab.addEventListener('click', () => {
          choose(cohort.id, true);
        });
        list.append(tab);
      }
      chooser.append(list);
      return;
    }
    const nav = h('nav', { 'aria-label': 'Cohort list', class: 'cohort-list' });
    for (const cohort of cohorts) {
      const describedBy = `phase-${cohort.id}`;
      const link = h(
        'a',
        {
          href: cohortUrl(cohort.id),
          'aria-label': cohort.name,
          'aria-describedby': describedBy,
          'aria-current': cohort.id === selected?.id ? 'page' : undefined,
          class: 'cohort-link',
        },
        [
          h('span', { class: 'link-name', text: cohort.name }),
          h('span', {
            class: 'link-phase muted',
            id: describedBy,
            text: phaseLabel(cohort.phase, cohort.week),
          }),
        ],
      );
      link.addEventListener('click', (event) => {
        event.preventDefault();
        choose(cohort.id, true);
      });
      nav.append(link);
    }
    chooser.append(nav);
  }

  function renderHeader(): void {
    if (selected === null) return;
    setText(cohortHeading, selected.name);
    setText(phaseNode, phaseLabel(selected.phase, selected.week));
    setHidden(publishButton, selected.phase !== 'draft');
    setHidden(closeButton, selected.phase !== 'technique');
    setHidden(digestButton, selected.phase !== 'baseline' && selected.phase !== 'technique');
  }

  function sharedButtons(row: RosterRow): HTMLElement[] {
    return row.shared_entries.map((shared) => {
      const button = h('button', {
        type: 'button',
        class: 'ghost read-shared',
        'aria-label': `Read shared entry ${shared.title}`,
        text: `Read shared entry ${shared.title}`,
        'data-entry': shared.entry_id,
      });
      button.addEventListener('click', () => {
        openSharedEntry(row, shared, button);
      });
      return button;
    });
  }

  function refundButton(row: RosterRow): HTMLElement | null {
    if (row.status !== 'active') return null;
    const button = h('button', {
      type: 'button',
      class: 'ghost refund',
      'aria-label': `Refund ${row.display_name}`,
      text: `Refund ${row.display_name}`,
    });
    button.addEventListener('click', () => {
      if (selected === null) return;
      setText(
        refundQuestion,
        `Refund ${row.display_name}'s seat of ${dollars(selected.price_cents)}?`,
      );
      confirmRefund.onclick = () => {
        void doRefund(row);
      };
      refundDialog.open(button, confirmRefund);
    });
    return button;
  }

  function renderRoster(): void {
    setHidden(rosterView, layout === 'phone');
    setHidden(cards, layout !== 'phone');
    if (layout === 'phone') renderCards();
    else renderTable();
    if (openShared !== null) {
      const dreamer = roster.find((row) => row.enrollment_id === openShared?.dreamer.enrollment_id);
      const stillShared = dreamer?.shared_entries.some(
        (shared) => shared.entry_id === openShared?.entryId,
      );
      if (stillShared !== true) {
        const target = openShared;
        sharedDialog.close();
        openShared = null;
        announce(updates, COPY.entryWithdrawn);
        const anchor =
          layout === 'phone'
            ? cards.querySelector<HTMLElement>(
                `[data-dreamer="${target.dreamer.enrollment_id}"] h3`,
              )
            : tableBody.querySelector<HTMLElement>(
                `[data-dreamer="${target.dreamer.enrollment_id}"] th`,
              );
        anchor?.focus();
      }
    }
  }

  function renderTable(): void {
    const wanted: HTMLElement[] = [];
    for (const row of roster) {
      let tr = tableBody.querySelector<HTMLElement>(`tr[data-dreamer="${row.enrollment_id}"]`);
      if (tr === null) {
        tr = h('tr', { 'data-dreamer': row.enrollment_id });
        tr.append(h('th', { scope: 'row', tabindex: '-1', text: row.display_name }));
        for (const _column of rowValues(row)) tr.append(h('td', {}));
        tr.append(h('td', { class: 'actions' }));
      }
      const cells = [...tr.querySelectorAll('td')];
      rowValues(row).forEach((value, index) => {
        const cell = cells[index];
        if (cell !== undefined) setText(cell, value);
      });
      const actions = cells[cells.length - 1];
      if (actions !== undefined) {
        const nextNames = [
          ...row.shared_entries.map((shared) => `Read shared entry ${shared.title}`),
          ...(row.status === 'active' ? [`Refund ${row.display_name}`] : []),
        ].join('|');
        if (actions.dataset['names'] !== nextNames) {
          actions.dataset['names'] = nextNames;
          const refund = refundButton(row);
          actions.replaceChildren(...sharedButtons(row), ...(refund === null ? [] : [refund]));
        }
      }
      wanted.push(tr);
    }
    for (const existing of [...tableBody.children]) {
      if (!wanted.includes(existing as HTMLElement)) tableBody.removeChild(existing);
    }
    wanted.forEach((node, index) => {
      const current = tableBody.children[index];
      if (current !== node) tableBody.insertBefore(node, current ?? null);
    });
  }

  function renderCards(): void {
    const wanted: HTMLElement[] = [];
    for (const row of roster) {
      let card = cards.querySelector<HTMLElement>(`article[data-dreamer="${row.enrollment_id}"]`);
      if (card === null) {
        card = h('article', {
          'data-dreamer': row.enrollment_id,
          'aria-label': row.display_name,
          class: 'roster-card',
        });
        card.append(h('h3', { tabindex: '-1', text: row.display_name }));
        for (const column of COLUMNS.slice(1, COLUMNS.length - 1)) {
          card.append(h('p', { class: 'line', 'data-label': column }));
        }
        card.append(h('div', { class: 'actions row' }));
      }
      const lines = [...card.querySelectorAll<HTMLElement>('.line')];
      rowValues(row).forEach((value, index) => {
        const line = lines[index];
        const label = COLUMNS[index + 1] ?? '';
        if (line !== undefined) setText(line, `${label}: ${value}`);
      });
      const actions = card.querySelector<HTMLElement>('.actions');
      if (actions !== null) {
        const nextNames = [
          ...row.shared_entries.map((shared) => `Read shared entry ${shared.title}`),
          ...(row.status === 'active' ? [`Refund ${row.display_name}`] : []),
        ].join('|');
        if (actions.dataset['names'] !== nextNames) {
          actions.dataset['names'] = nextNames;
          const refund = refundButton(row);
          actions.replaceChildren(...sharedButtons(row), ...(refund === null ? [] : [refund]));
        }
      }
      wanted.push(card);
    }
    for (const existing of [...cards.children]) {
      if (!wanted.includes(existing as HTMLElement)) cards.removeChild(existing);
    }
    wanted.forEach((node, index) => {
      const current = cards.children[index];
      if (current !== node) cards.insertBefore(node, current ?? null);
    });
  }

  function openSharedEntry(row: RosterRow, shared: SharedEntry, opener: HTMLElement): void {
    openShared = { entryId: shared.entry_id, dreamer: row };
    setText(sharedTitle, shared.title);
    setText(sharedText, shared.text);
    sharedMemo.replaceChildren();
    if (shared.has_memo && selected !== null) {
      sharedMemo.append(
        h('audio', {
          controls: true,
          'aria-label': 'Voice memo',
          preload: 'metadata',
          src: `/api/coach/cohorts/${selected.id}/shared/${shared.entry_id}/memo`,
        }),
      );
    }
    sharedDialog.open(opener, closeShared);
  }

  async function doRefund(row: RosterRow): Promise<void> {
    confirmRefund.disabled = true;
    const result = await api.refund(row.enrollment_id);
    confirmRefund.disabled = false;
    refundDialog.close();
    if (result.ok) {
      announce(updates, `Refunded ${row.display_name}.`);
      await loadRoster();
      await loadCohorts();
      return;
    }
    if (result.status === 503) announce(updates, COPY.refundBillingOutage);
    else if (result.errorCode === 'refund_window_closed') announce(updates, COPY.refundWindowClosed);
    else if (result.errorCode === 'not_refundable') announce(updates, COPY.refundComped);
    else if (result.errorCode === 'illegal_transition') announce(updates, COPY.refundAlready);
  }

  async function loadCohorts(): Promise<void> {
    const result = await api.coachCohorts();
    if (result.status === 401) {
      location.assign('/signin?next=%2Fcoach');
      return;
    }
    if (result.body === null) return;
    cohorts = result.body.cohorts;
    if (selected !== null) {
      const fresh = cohorts.find((cohort) => cohort.id === selected?.id);
      if (fresh !== undefined) selected = fresh;
    }
    renderChooser();
    renderHeader();
  }

  async function loadRoster(): Promise<void> {
    if (selected === null) return;
    const result = await api.roster(selected.id);
    if (result.status === 401) {
      location.assign('/signin?next=%2Fcoach');
      return;
    }
    if (result.body === null) return;
    selected = result.body.cohort;
    roster = result.body.dreamers;
    renderHeader();
    renderChooser();
    renderRoster();
    sizeRosterView();
  }

  function choose(cohortId: string, pushHistory: boolean): void {
    const cohort = cohorts.find((candidate) => candidate.id === cohortId);
    if (cohort === undefined) return;
    selected = cohort;
    if (pushHistory) history.pushState({}, '', cohortUrl(cohortId));
    renderChooser();
    renderHeader();
    roster = [];
    tableBody.replaceChildren();
    cards.replaceChildren();
    void loadRoster();
  }

  function selectFromAddress(pushHistory: boolean): void {
    const wanted = new URLSearchParams(location.search).get('cohort');
    const found = cohorts.find((cohort) => cohort.id === wanted);
    if (found !== undefined) {
      choose(found.id, pushHistory);
      return;
    }
    const earliest = [...cohorts].sort((left, right) =>
      left.starts_on === right.starts_on
        ? left.name.localeCompare(right.name)
        : left.starts_on < right.starts_on
          ? -1
          : 1,
    )[0];
    if (earliest === undefined) return;
    selected = earliest;
    history.replaceState({}, '', cohortUrl(earliest.id));
    if (wanted !== null) announce(updates, COPY.cohortUnavailable);
    renderChooser();
    renderHeader();
    void loadRoster();
  }

  publishButton.addEventListener('click', () => {
    void (async () => {
      if (selected === null) return;
      publishButton.disabled = true;
      const result = await api.publishCohort(selected.id);
      publishButton.disabled = false;
      if (result.ok) {
        announce(updates, COPY.cohortPublished);
        await loadCohorts();
        await loadRoster();
        return;
      }
      announce(updates, COPY.illegalTransition);
    })();
  });

  closeButton.addEventListener('click', () => {
    void (async () => {
      if (selected === null) return;
      closeButton.disabled = true;
      const result = await api.closeCohort(selected.id);
      closeButton.disabled = false;
      if (result.ok) {
        announce(updates, COPY.cohortClosed);
        await loadCohorts();
        await loadRoster();
        return;
      }
      announce(updates, COPY.illegalTransition);
    })();
  });

  digestButton.addEventListener('click', () => {
    void (async () => {
      if (selected === null) return;
      digestButton.disabled = true;
      announce(updates, COPY.sendingDigest);
      const result = await api.digest(selected.id);
      digestButton.disabled = false;
      if (result.ok && result.body !== null) {
        const digest = result.body.digest;
        announce(
          updates,
          digest.replayed
            ? `This week's digest was already sent to ${digest.to}.`
            : `Digest sent to ${digest.to}.`,
        );
        return;
      }
      if (result.status === 503) announce(updates, COPY.mailOutage);
      else announce(updates, COPY.illegalTransition);
    })();
  });

  newCohortToggle.addEventListener('click', () => {
    const hidden = newCohortForm.hasAttribute('hidden');
    setHidden(newCohortForm, !hidden);
    if (hidden) nameInput.focus();
  });

  newCohortForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      for (const node of [nameError, firstNightError, priceError, seatsError]) {
        node.textContent = '';
      }
      const price = priceInput.value.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(price)) {
        setText(priceError, COPY.priceFieldError);
        return;
      }
      createButton.disabled = true;
      const result = await api.createCohort({
        name: nameInput.value,
        starts_on: firstNightInput.value,
        price_cents: Math.round(Number(price) * 100),
        seats: Number(seatsInput.value === '' ? '0' : seatsInput.value),
      });
      createButton.disabled = false;
      if (result.ok && result.body !== null) {
        announce(updates, COPY.cohortCreated);
        newCohortForm.reset();
        await loadCohorts();
        choose(result.body.cohort.id, true);
        return;
      }
      if (result.errorCode === 'cohort_name_taken') {
        announce(updates, COPY.cohortNameTaken);
        return;
      }
      const fields = result.fieldErrors ?? {};
      if (fields['name'] !== undefined) setText(nameError, fields['name']);
      if (fields['starts_on'] !== undefined) setText(firstNightError, fields['starts_on']);
      if (fields['price_cents'] !== undefined) setText(priceError, fields['price_cents']);
      if (fields['seats'] !== undefined) setText(seatsError, fields['seats']);
    })();
  });

  function applyLayout(): void {
    const mode = layoutMode();
    if (mode !== layout) {
      layout = mode;
      renderChooser();
      tableBody.replaceChildren();
      cards.replaceChildren();
      renderRoster();
    }
    screen.setAttribute('data-layout', layout);
    setHidden(newCohortToggle, layout === 'desktop');
    if (layout === 'desktop') setHidden(newCohortForm, false);
    else setHidden(newCohortForm, true);
    sizeRosterView();
  }

  function sizeRosterView(): void {
    const top = rosterView.getBoundingClientRect().top;
    const available = window.innerHeight - top - 16;
    rosterView.style.height = `${Math.max(320, available)}px`;
  }

  window.addEventListener('resize', () => {
    applyLayout();
  });
  window.addEventListener('popstate', () => {
    if (location.pathname !== '/coach') return;
    const wanted = new URLSearchParams(location.search).get('cohort');
    const found = cohorts.find((cohort) => cohort.id === wanted);
    if (found !== undefined && found.id !== selected?.id) choose(found.id, false);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && navigator.onLine) void loadRoster();
  });
  const timer = window.setInterval(() => {
    if (!document.hidden && navigator.onLine) void loadRoster();
  }, ROSTER_REFRESH_MS);
  window.addEventListener('beforeunload', () => {
    window.clearInterval(timer);
  });

  void (async () => {
    await loadCohorts();
    selectFromAddress(false);
    applyLayout();
  })();

  return screen;
}
