import { h } from './dom.js';
import { get, post, patch, del } from './api.js';
import type { Grant, Person, LedgerEntry } from './api.js';
import { shell, page, navigate, announce, onSocketOpen, replaceAddress } from './app.js';
import { onEvent } from './socket.js';
import { fmtDate, fmtInstant } from './format.js';

const STATE_WORDS: Record<string, string> = {
  draft: 'Draft',
  board_queue: 'With the board',
  approved: 'Approved',
  offered: 'Offered',
  accepted: 'Accepted',
  expired: 'Expired',
};

// ---------- grants admin ----------

page('/admin/grants', ['founder_admin'], async (root, ctx) => {
  const person = ctx.person;
  const content = h('div', {});
  root.appendChild(shell(person, content));
  await draw();

  async function draw(): Promise<void> {
    const { grants } = await get<{ grants: Grant[] }>('/api/grants');
    const newBtn = h('button', { class: 'primary', id: 'new-grant' }, 'New grant') as HTMLButtonElement;
    newBtn.addEventListener('click', async () => {
      const g = await post<Grant>('/api/grants', { holder_id: null, options: null, strike: null, vesting_type: null, vesting_start: null }).catch(() => null);
      void g;
      navigate('/admin/grants/new-draft');
    });

    const table = h('table', { 'aria-label': 'Grants' },
      h('thead', null, h('tr', null, h('th', null, 'Grant'), h('th', null, 'Holder'), h('th', null, 'State'), h('th', null, ''))),
      h('tbody', null, ...grants.map((g) => h('tr', null,
        h('td', null, h('a', {
          href: `/admin/grants/${g.id}`,
          onclick: (ev: Event) => { ev.preventDefault(); navigate(`/admin/grants/${g.id}`); },
        }, g.id)),
        h('td', null, g.holder_name),
        h('td', null, STATE_WORDS[g.state] ?? g.state),
        h('td', null, g.state === 'approved'
          ? h('button', { class: 'primary', onclick: (ev: Event) => { void sendOffer(g.id, ev); } }, `Send offer ${g.id}`)
          : h('span', null)),
      ))),
    );

    content.replaceChildren(h('h1', null, 'Grants'), newBtn, table);

    onSocketOpen((open) => { newBtn.disabled = !open; });
  }

  async function sendOffer(grantId: string, ev: Event): Promise<void> {
    const btn = ev.target as HTMLButtonElement;
    try {
      const g = await post<Grant>(`/api/grants/${grantId}/offer`);
      announce(`Offer for ${grantId} sent. It lapses at ${fmtInstant(g.offer_expires_at!)}.`, `offer-${grantId}`);
      await draw();
    } catch (e) {
      const err = e as { message?: string };
      announce(err.message ?? '', `offer-fail-${grantId}`);
      void btn;
    }
  }
});

page('/admin/grants/new-draft', ['founder_admin'], async (root, ctx) => {
  await renderGrantForm(root, ctx.person, null);
});

page('/admin/grants/:id', ['founder_admin'], async (root, ctx) => {
  const person = ctx.person;
  try {
    const g = await get<Grant>(`/api/grants/${ctx.params.id}`);
    if (g.state !== 'draft') {
      // A non-draft grant opens its read view.
      const content = h('div', {},
        h('h1', null, `${g.id} — ${STATE_WORDS[g.state]}`),
        h('p', null, `${g.holder_name}, ${g.options.toLocaleString('en-US')} options at $${g.strike}`),
        h('p', null, `${g.vesting_type === 'standard' ? '4 years, 1-year cliff' : '4 years monthly, no cliff'}, from ${g.vesting_start ? fmtDate(g.vesting_start) : ''}`),
      );
      root.appendChild(shell(person, content));
      return;
    }
    await renderGrantForm(root, person, ctx.params.id!);
  } catch (e) {
    const err = e as { status?: number };
    if (err.status === 404) {
      root.appendChild(shell(person, h('section', { class: 'band black full-bleed' },
        h('h1', null, 'Not on your register'),
        h('p', null, "This record isn't on your register."))));
      return;
    }
    throw e;
  }
});

async function renderGrantForm(root: HTMLElement, person: Person, grantId: string | null): Promise<void> {
  const content = h('div', {});
  root.appendChild(shell(person, content));

  let draftVersion = 1;
  let currentGrant: Grant | null = null;
  if (grantId) {
    currentGrant = await get<Grant>(`/api/grants/${grantId}`);
    draftVersion = currentGrant.draft_version;
  }

  const holderSelect = h('select', { id: 'g-holder', 'aria-label': 'Holder' }) as HTMLSelectElement;
  const optionsInput = h('input', { type: 'text', id: 'g-options' }) as HTMLInputElement;
  const strikeInput = h('input', { type: 'text', id: 'g-strike' }) as HTMLInputElement;
  const startInput = h('input', { type: 'text', id: 'g-start' }) as HTMLInputElement;
  const savedNote = h('p', { class: 'saved-note' }, 'Draft saved');
  const errors: Record<string, HTMLElement> = {
    holder_id: h('p', { class: 'field-error', style: { display: 'none' } }),
    options: h('p', { class: 'field-error', style: { display: 'none' } }),
    strike: h('p', { class: 'field-error', style: { display: 'none' } }),
    vesting_type: h('p', { class: 'field-error', style: { display: 'none' } }),
    vesting_start: h('p', { class: 'field-error', style: { display: 'none' } }),
  };

  const { people } = await get<{ people: Person[] }>('/api/people');
  holderSelect.appendChild(h('option', { value: '' }, 'Choose an option holder'));
  const holders = people.filter((p) => p.role === 'option_holder').sort((a, b) => a.name.localeCompare(b.name));
  for (const p of holders) holderSelect.appendChild(h('option', { value: p.id }, p.name));

  const radioStandard = h('input', { type: 'radio', name: 'vesting_type', id: 'vt-standard', value: 'standard' }) as HTMLInputElement;
  const radioMonthly = h('input', { type: 'radio', name: 'vesting_type', id: 'vt-monthly', value: 'monthly' }) as HTMLInputElement;

  const submitBtn = h('button', { class: 'primary', id: 'submit-grant' }, 'Submit to board') as HTMLButtonElement;
  const deleteBtn = h('button', { class: 'secondary' }, 'Delete draft') as HTMLButtonElement;

  function fillFrom(grant: Grant): void {
    if (grant.vesting_start && startInput.value !== grant.vesting_start) startInput.value = grant.vesting_start;
    // Live pushes from another tab update fields without keyboard focus.
    if (document.activeElement !== optionsInput && grant.options) optionsInput.value = String(grant.options);
    if (document.activeElement !== strikeInput && grant.strike) strikeInput.value = grant.strike;
    if (document.activeElement !== holderSelect && grant.holder_id) holderSelect.value = grant.holder_id;
    if (document.activeElement !== radioStandard && document.activeElement !== radioMonthly && grant.vesting_type) {
      radioStandard.checked = grant.vesting_type === 'standard';
      radioMonthly.checked = grant.vesting_type === 'monthly';
    }
  }

  if (currentGrant) {
    fillFrom(currentGrant);
    if (currentGrant.vesting_start) startInput.value = currentGrant.vesting_start;
    draftVersion = currentGrant.draft_version;
  }

  function body(): Record<string, unknown> {
    const out: Record<string, unknown> = { draft_version: draftVersion };
    if (holderSelect.value) out.holder_id = holderSelect.value;
    if (optionsInput.value) out.options = Number(optionsInput.value);
    if (strikeInput.value) out.strike = strikeInput.value;
    const vtype = radioStandard.checked ? 'standard' : radioMonthly.checked ? 'monthly' : null;
    if (vtype) out.vesting_type = vtype;
    if (startInput.value) out.vesting_start = startInput.value;
    return out;
  }

  // Saves go one at a time, each carrying the previous draft_version.
  let saveChain: Promise<unknown> = Promise.resolve();
  let draftCreated = grantId;
  let saveTimer: number | null = null;

  function scheduleSave(): void {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { void runSave(); }, 600);
  }

  async function runSave(): Promise<void> {
    const chain = saveChain.then(async () => {
      if (!draftCreated) {
        // create the draft on the first field change
        const created = await post<Grant>('/api/grants', {
          holder_id: holderSelect.value || null,
          options: optionsInput.value ? Number(optionsInput.value) : null,
          strike: strikeInput.value || null,
          vesting_type: radioStandard.checked ? 'standard' : radioMonthly.checked ? 'monthly' : null,
          vesting_start: startInput.value || null,
        });
        draftCreated = created.id;
        draftVersion = created.draft_version;
        replaceAddress(`/admin/grants/${created.id}`);
        return;
      }
      const updated = await patch<Grant>(`/api/grants/${draftCreated}`, body());
      draftVersion = updated.draft_version;
      savedNote.textContent = 'Draft saved';
    }).catch(async (e) => {
      const err = e as { code?: string; fields?: Record<string, string>; body?: { grant?: Grant } };
      if (err.code === 'draft_outdated') {
        const latest = err.body?.grant;
        if (latest) {
          draftVersion = latest.draft_version;
          fillFrom(latest);
        }
        showOutdatedNotice();
        return;
      }
      if (err.fields) {
        // show beside fields but do not navigate away
        for (const [k, v] of Object.entries(err.fields)) {
          errors[k]!.textContent = v;
          errors[k]!.style.display = 'block';
        }
      }
    });
    saveChain = chain;
    await chain;
  }

  const outdatedNotice = h('section', { role: 'region', 'aria-label': 'Draft changed', class: 'strip', style: { display: 'none', background: '#141414' }, tabindex: '-1' },
    h('p', null, 'This draft changed in another tab. The latest version is shown.'),
    h('button', { class: 'secondary', id: 'keep-editing' }, 'Keep editing'),
  );

  function showOutdatedNotice(): void {
    outdatedNotice.style.display = '';
    outdatedNotice.querySelector<HTMLButtonElement>('#keep-editing')!.addEventListener('click', () => {
      outdatedNotice.style.display = 'none';
      const first = document.getElementById('g-options') as HTMLElement;
      first.focus();
    }, { once: true });
    outdatedNotice.focus();
  }

  for (const input of [holderSelect, optionsInput, strikeInput, startInput]) {
    input.addEventListener('input', scheduleSave);
    input.addEventListener('change', scheduleSave);
  }
  radioStandard.addEventListener('change', scheduleSave);
  radioMonthly.addEventListener('change', scheduleSave);

  async function submitToBoard(): Promise<void> {
    if (!draftCreated) {
      announce('Enter the grant before submitting it to the board.', 'submit-nodraft');
      return;
    }
    submitBtn.textContent = 'Sending';
    try {
      const g = await post<Grant>(`/api/grants/${draftCreated}/submit`);
      announce(`Grant ${g.id} sent to the board for approval.`, `submit-${g.id}`);
      navigate('/admin/grants', true);
    } catch (e) {
      submitBtn.textContent = 'Submit to board';
      const err = e as { code?: string; fields?: Record<string, string>; message?: string };
      if (err.code === 'valuation_lapsed') {
        announce(err.message ?? '', 'lapsed-submit');
        content.prepend(h('section', { class: 'band black', role: 'alert' }, err.message ?? ''));
        return;
      }
      if (err.fields) {
        let firstKey: string | null = null;
        for (const [k, v] of Object.entries(err.fields)) {
          errors[k]!.textContent = v;
          errors[k]!.style.display = 'block';
          if (!firstKey) firstKey = k;
        }
        const focusMap: Record<string, HTMLElement> = {
          holder_id: holderSelect,
          options: optionsInput,
          strike: strikeInput,
          vesting_type: radioStandard,
          vesting_start: startInput,
        };
        if (firstKey) focusMap[firstKey]!.focus();
      } else {
        announce(err.message ?? '', 'submit-fail');
      }
    }
  }

  submitBtn.addEventListener('click', () => { void submitToBoard(); });

  deleteBtn.addEventListener('click', async () => {
    if (!draftCreated) return;
    try {
      await del(`/api/grants/${draftCreated}`);
      navigate('/admin/grants', true);
    } catch (e) {
      const err = e as { message?: string };
      announce(err.message ?? '', 'delete-fail');
    }
  });

  const form = h('form', { class: 'narrow', 'aria-label': 'Issue grant', onsubmit: (ev: Event) => { ev.preventDefault(); void submitToBoard(); } },
    h('label', { for: 'g-holder' }, 'Holder'), holderSelect, errors.holder_id!,
    h('label', { for: 'g-options' }, 'Options'), optionsInput, errors.options!,
    h('label', { for: 'g-strike' }, 'Strike price'), strikeInput, errors.strike!,
    h('fieldset', { role: 'radiogroup', 'aria-label': 'Vesting type' },
      h('legend', null, 'Vesting type'),
      h('div', { class: 'radio-row' },
        h('label', { for: 'vt-standard' }, radioStandard, '4 years, 1-year cliff'),
        h('label', { for: 'vt-monthly' }, radioMonthly, '4 years monthly, no cliff'),
      ),
      errors.vesting_type!,
    ),
    h('label', { for: 'g-start' }, 'Vesting start'), startInput,
    h('p', { class: 'hint' }, 'YYYY-MM-DD'), errors.vesting_start!,
    savedNote,
    submitBtn,
    deleteBtn,
    outdatedNotice,
  );

  // Enter on any field submits.
  form.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.target as HTMLElement).tagName !== 'BUTTON') {
      ev.preventDefault();
      void submitToBoard();
    }
  });

  content.replaceChildren(h('h1', null, 'Issue grant'), form);

  // A lapsed valuation disables "Submit to board" while the form is open.
  onEvent((ev) => {
    if (ev.type === 'valuation_changed') {
      void refreshValuationState();
    }
  });

  async function refreshValuationState(): Promise<void> {
    try {
      const { valuations } = await get<{ valuations: Array<{ id: string; status: string; expires_on: string; fmv_per_share: string }> }>('/api/valuations');
      const current = valuations.find((v) => v.status === 'current');
      if (!current) {
        submitBtn.disabled = true;
        const band = document.getElementById('lapsed-band');
        if (!band) {
          const el = h('section', { class: 'band black', role: 'alert', id: 'lapsed-band' },
            `The current valuation lapsed. Record a new valuation before issuing grants.`);
          content.prepend(el);
          announce('The current valuation lapsed. Record a new valuation before issuing grants.', 'lapsed-notice');
        }
      } else {
        submitBtn.disabled = false;
        document.getElementById('lapsed-band')?.remove();
      }
    } catch {
      // leave the form as it is
    }
  }
  await refreshValuationState();

  // Live draft changes from another tab update fields but not the carried draft_version.
  onEvent((ev) => {
    const data = ev.data as Record<string, unknown> | null;
    if (ev.type === 'grant_state' && data?.grant_id === draftCreated) {
      void get<Grant>(`/api/grants/${draftCreated}`).then((g) => {
        if (g.state === 'draft') fillFrom(g);
      }).catch(() => undefined);
    }
    if (ev.type === 'draft_changed' && data?.grant_id === draftCreated) {
      void get<Grant>(`/api/grants/${draftCreated}`).then((g) => fillFrom(g)).catch(() => undefined);
    }
  });

  onSocketOpen((open) => {
    submitBtn.disabled = !open;
    deleteBtn.disabled = !open;
  });

  holderSelect.focus();
}

// ---------- valuations ----------

page('/admin/valuations', ['founder_admin'], async (root, ctx) => {
  const person = ctx.person;
  const content = h('div', {});
  root.appendChild(shell(person, content));

  const queryStatus = ctx.query.get('status') ?? 'all';

  async function draw(statusFilter: string): Promise<void> {
    const { valuations } = await get<{ valuations: Array<{ id: string; effective_on: string; expires_on: string; fmv_per_share: string; firm: string; status: string }> }>('/api/valuations');

    const radios: Record<string, HTMLInputElement> = {};
    for (const value of ['all', 'current', 'superseded', 'lapsed']) {
      const radio = h('input', { type: 'radio', name: 'status', id: `st-${value}`, value, ...(queryStatus === value ? { checked: true } : {}) }) as HTMLInputElement;
      radios[value] = radio;
      radio.addEventListener('change', () => {
        replaceAddress(`/admin/valuations?status=${value}`);
        void draw(value);
      });
    }

    const fieldset = h('fieldset', { role: 'radiogroup', 'aria-label': 'Show valuations' },
      h('legend', null, 'Show valuations'),
      h('div', { class: 'radio-row' },
        h('label', { for: 'st-all' }, radios.all!, 'All'),
        h('label', { for: 'st-current' }, radios.current!, 'Current'),
        h('label', { for: 'st-superseded' }, radios.superseded!, 'Superseded'),
        h('label', { for: 'st-lapsed' }, radios.lapsed!, 'Lapsed'),
      ),
    );

    const filtered = statusFilter === 'all' ? valuations : valuations.filter((v) => v.status === statusFilter);
    const tableBody = filtered.length > 0
      ? h('tbody', null, ...filtered.map((v) => h('tr', { 'data-valuation': v.id },
          h('td', { 'data-field': 'effective_on' }, fmtDate(v.effective_on)),
          h('td', null, fmtDate(v.expires_on)),
          h('td', { class: 'num' }, `$${v.fmv_per_share}`),
          h('td', null, v.firm),
          h('td', null, v.status === 'current' ? 'Current' : v.status === 'superseded' ? 'Superseded' : 'Lapsed'),
        )))
      : null;

    const table = h('table', { 'aria-label': 'Valuations' },
      h('thead', null, h('tr', null, h('th', null, 'Effective date'), h('th', null, 'Expiry date'), h('th', null, 'FMV per share'), h('th', null, 'Firm'), h('th', null, 'Status'))),
      tableBody ?? h('tbody', null, h('tr', null, h('td', { colspan: '5' }, 'No valuations with this status.'))),
    );

    const effectiveInput = h('input', { type: 'text', id: 'v-effective' }) as HTMLInputElement;
    const expiresInput = h('input', { type: 'text', id: 'v-expires' }) as HTMLInputElement;
    const fmvInput = h('input', { type: 'text', id: 'v-fmv' }) as HTMLInputElement;
    const firmInput = h('input', { type: 'text', id: 'v-firm' }) as HTMLInputElement;
    const errorFields: Record<string, HTMLElement> = {
      effective_on: h('p', { class: 'field-error', style: { display: 'none' } }),
      expires_on: h('p', { class: 'field-error', style: { display: 'none' } }),
      fmv_per_share: h('p', { class: 'field-error', style: { display: 'none' } }),
    };
    const recordBtn = h('button', { class: 'primary' }, 'Record valuation') as HTMLButtonElement;

    recordBtn.addEventListener('click', async () => {
      for (const el of Object.values(errorFields)) el.style.display = 'none';
      try {
        const v = await post<{ id: string; fmv_per_share: string; effective_on: string }>('/api/valuations', {
          effective_on: effectiveInput.value,
          expires_on: expiresInput.value,
          fmv_per_share: fmvInput.value,
          firm: firmInput.value,
        });
        announce(`Valuation recorded: fair market value $${v.fmv_per_share} from ${fmtDate(v.effective_on)}.`, `val-${v.id}`);
        replaceAddress('/admin/valuations?status=all');
        await draw('all');
        const row = document.querySelector<HTMLElement>(`tr[data-valuation="${v.id}"] [data-field="effective_on"]`);
        if (row) row.focus();
      } catch (e) {
        const err = e as { fields?: Record<string, string> };
        if (err.fields) {
          let firstKey: string | null = null;
          for (const [k, msg] of Object.entries(err.fields)) {
            if (errorFields[k]) {
              errorFields[k]!.textContent = msg;
              errorFields[k]!.style.display = 'block';
              if (!firstKey) firstKey = k;
            }
          }
          const focusMap: Record<string, HTMLElement> = { effective_on: effectiveInput, expires_on: expiresInput, fmv_per_share: fmvInput };
          if (firstKey) focusMap[firstKey]!.focus();
        }
      }
    });

    const form = h('form', { class: 'narrow', 'aria-label': 'Record valuation', onsubmit: (ev: Event) => { ev.preventDefault(); } },
      h('label', { for: 'v-effective' }, 'Effective date'), effectiveInput, errorFields.effective_on!,
      h('label', { for: 'v-expires' }, 'Expiry date'), expiresInput, errorFields.expires_on!,
      h('label', { for: 'v-fmv' }, 'Fair market value per share'), fmvInput, errorFields.fmv_per_share!,
      h('label', { for: 'v-firm' }, 'Valuation firm'), firmInput,
      recordBtn,
    );

    content.replaceChildren(h('h1', null, 'Valuations'), fieldset, table, form);
    onSocketOpen((open) => { recordBtn.disabled = !open; });
  }

  await draw(queryStatus);
});

// ---------- ledger ----------

page('/admin/ledger', ['founder_admin'], async (root, ctx) => {
  const person = ctx.person;
  const { entries } = await get<{ entries: LedgerEntry[] }>('/api/ledger');
  const table = h('table', { 'aria-label': 'Securities ledger' },
    h('thead', null, h('tr', null,
      h('th', null, 'When'), h('th', null, 'Holder'), h('th', null, 'Entry'), h('th', null, 'Class'),
      h('th', null, 'Shares'), h('th', null, 'Options'), h('th', null, 'Reference'))),
    h('tbody', null, ...entries.map((e) => h('tr', null,
      h('td', null, fmtInstant(e.at)),
      h('td', null, e.holder_name),
      h('td', null, e.kind),
      h('td', null, e.class),
      h('td', { class: 'num' }, e.shares_delta.toLocaleString('en-US')),
      h('td', { class: 'num' }, e.options_delta.toLocaleString('en-US')),
      h('td', null, e.reference),
    ))),
  );
  root.appendChild(shell(person, h('h1', null, 'Securities ledger'), table));
});

// ---------- people ----------

page('/admin/people', ['founder_admin'], async (root, ctx) => {
  const person = ctx.person;
  const content = h('div', {});
  root.appendChild(shell(person, content));

  async function draw(): Promise<void> {
    const { people } = await get<{ people: Person[] }>('/api/people');
    const table = h('table', { 'aria-label': 'People' },
      h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Role'), h('th', null, 'Access'))),
      h('tbody', null, ...people.map((p) => {
        const roleSelect = h('select', { 'aria-label': `Role for ${p.name}` }) as HTMLSelectElement;
        for (const [value, label] of [['option_holder', 'Option holder'], ['investor', 'Investor'], ['board_member', 'Board member']] as const) {
          roleSelect.appendChild(h('option', { value, ...(p.role === value ? { selected: true } : {}) }, label));
        }
        roleSelect.addEventListener('change', async () => {
          try {
            await patch(`/api/people/${p.id}`, { role: roleSelect.value });
            announce(`${p.name}'s role changed.`, `role-${p.id}`);
          } catch (e) {
            const err = e as { message?: string };
            announce(err.message ?? '', `role-fail-${p.id}`);
            await draw();
          }
        });

        const removeBtn = h('button', { class: 'secondary' }, `Remove access for ${p.name}`) as HTMLButtonElement;
        removeBtn.addEventListener('click', async () => {
          try {
            await post(`/api/people/${p.id}/remove-access`, {});
            announce(`Access removed for ${p.name}.`, `access-${p.id}`);
            await draw();
          } catch (e) {
            const err = e as { message?: string };
            announce(err.message ?? '', `access-fail-${p.id}`);
          }
        });

        const departBtn = h('button', { class: 'secondary' }, `Record departure for ${p.name}`) as HTMLButtonElement;
        departBtn.addEventListener('click', async () => {
          try {
            const r = await post<{ person: Person }>(`/api/people/${p.id}/departure`, {});
            announce(`Departure recorded for ${p.name}. Their exercise window ends at ${fmtInstant(r.person.departure!.window_ends_at!)}.`, `depart-${p.id}`);
            await draw();
          } catch (e) {
            const err = e as { message?: string };
            announce(err.message ?? '', `depart-fail-${p.id}`);
          }
        });

        return h('tr', null,
          h('td', null, p.name),
          h('td', null, roleSelect),
          h('td', null, p.access,
            p.role === 'option_holder' ? h('div', { style: { marginTop: '6px' } }, departBtn) : null,
            p.id !== person.id && p.access === 'active' ? h('div', { style: { marginTop: '6px' } }, removeBtn) : null,
          ),
        );
      })),
    );

    const nameInput = h('input', { type: 'text', id: 'p-name' }) as HTMLInputElement;
    const emailInput = h('input', { type: 'text', id: 'p-email' }) as HTMLInputElement;
    const roleSelect = h('select', { id: 'p-role', 'aria-label': 'Role' }) as HTMLSelectElement;
    for (const [value, label] of [['option_holder', 'Option holder'], ['investor', 'Investor'], ['board_member', 'Board member']] as const) {
      roleSelect.appendChild(h('option', { value }, label));
    }
    const passwordInput = h('input', { type: 'text', id: 'p-password' }) as HTMLInputElement;
    const addBtn = h('button', { class: 'primary' }, 'Add person') as HTMLButtonElement;

    addBtn.addEventListener('click', async () => {
      try {
        const r = await post<{ person: Person }>('/api/people', {
          name: nameInput.value, email: emailInput.value, role: roleSelect.value, password: passwordInput.value,
        });
        announce(`${r.person.name} added as ${roleLabel(r.person.role)}.`, `add-${r.person.id}`);
        await draw();
      } catch (e) {
        const err = e as { fields?: Record<string, string>; message?: string };
        announce(Object.values(err.fields ?? {})[0] ?? err.message ?? '', `add-fail`);
      }
    });

    const form = h('form', { class: 'narrow', 'aria-label': 'Add person', onsubmit: (ev: Event) => { ev.preventDefault(); } },
      h('label', { for: 'p-name' }, 'Name'), nameInput,
      h('label', { for: 'p-email' }, 'Email'), emailInput,
      h('label', { for: 'p-role' }, 'Role'), roleSelect,
      h('label', { for: 'p-password' }, 'Initial password'), passwordInput,
      addBtn,
    );

    content.replaceChildren(h('h1', null, 'People'), table, h('h2', null, 'Add person'), form);
    onSocketOpen((open) => {
      addBtn.disabled = !open;
      for (const b of content.querySelectorAll<HTMLButtonElement>('button')) b.disabled = !open;
      for (const s of content.querySelectorAll<HTMLSelectElement>('select[aria-label^="Role for"]')) s.disabled = !open;
    });
  }

  await draw();
});

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    founder_admin: 'Founder admin',
    board_member: 'Board member',
    option_holder: 'Option holder',
    leaver: 'Leaver',
    investor: 'Investor',
  };
  return labels[role] ?? role;
}
