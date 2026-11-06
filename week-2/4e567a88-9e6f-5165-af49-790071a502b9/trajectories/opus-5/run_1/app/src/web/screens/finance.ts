import { ApiFailure, LedgerView, MeterView, RateView, TopupView, api } from '../api';
import { clear, el, num, table } from '../dom';
import { credits, localMinute, orgZoneName, rate as formatRate, shortDateTime, wholeCredits } from '../format';
import { Ribbon } from '../meter';
import { Shell, alertError, clearMessages, notice } from '../shell';
import { noteZoneFromPeriod, state, teamName } from '../state';

const RATE_PATTERN = /^\d{1,7}(\.\d{1,6})?$/;
const MOMENT_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

const STATUS_WORDS: Record<TopupView['status'], string> = { paid: 'Paid', pending: 'Pending', failed: 'Failed' };
const RATE_WORDS: Record<RateView['status'], string> = { past: 'Past', current: 'Current', scheduled: 'Scheduled' };

export function mountFinance(shell: Shell): () => void {
  const readOnly = state.member!.role !== 'finance';
  const ribbon = new Ribbon();
  const timers: number[] = [];

  const teamSelect = el('select', { class: 'control', 'aria-label': 'Team' });
  for (const team of state.teams) {
    teamSelect.append(el('option', { value: team.id, text: team.name }));
  }
  teamSelect.value = state.selectedTeamId;
  const creditsInput = el('input', {
    type: 'number',
    class: 'control',
    'aria-label': 'Credits',
    min: '100',
    max: '100000',
    step: '100',
    value: '1000',
    id: 'topup-credits',
  });
  const topUpButton = el('button', { type: 'submit', class: 'primary', text: 'Top up', disabled: readOnly });
  const topUpForm = el('form', { class: 'inline-form', 'aria-label': 'Top up credits' }, [
    el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Team' }), teamSelect]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'topup-credits', text: 'Credits' }),
      creditsInput,
    ]),
    topUpButton,
  ]);

  const modelSelect = el('select', { class: 'control', 'aria-label': 'Model' });
  for (const model of state.models) {
    modelSelect.append(el('option', { value: model.slug, text: model.name }));
  }
  const rateInput = el('input', {
    type: 'text',
    class: 'control',
    'aria-label': 'New rate (credits per unit)',
    id: 'new-rate',
  });
  const rateError = el('p', { class: 'field-error' });
  const momentInput = el('input', {
    type: 'text',
    class: 'control',
    'aria-label': 'Effective at',
    placeholder: '2026-11-02 09:00',
    id: 'effective-at',
  });
  const momentError = el('p', { class: 'field-error' });
  const scheduleButton = el('button', { type: 'submit', class: 'primary', text: 'Schedule', disabled: readOnly });
  const scheduleForm = el('form', { class: 'inline-form', 'aria-label': 'Schedule rate change' }, [
    el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Model' }), modelSelect]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'new-rate', text: 'New rate (credits per unit)' }),
      rateInput,
      rateError,
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'field-label', for: 'effective-at', text: 'Effective at' }),
      momentInput,
      momentError,
    ]),
    scheduleButton,
  ]);

  const topupsHolder = el('div', { class: 'table-holder' });
  const ledgerHolder = el('div', { class: 'table-holder' });
  const ratesHolder = el('div', { class: 'table-holder' });
  const ledgerExport = el('a', { class: 'export-link', href: '#', text: 'Export ledger CSV' });

  function selectedTeam(): string {
    return state.selectedTeamId;
  }

  async function loadTopups(): Promise<void> {
    const response = await api.get<{ topups: TopupView[] }>(`/api/topups?team=${encodeURIComponent(selectedTeam())}`);
    clear(topupsHolder);
    topupsHolder.append(
      el('h3', { class: 'section-heading', text: 'Top-ups' }),
      table(
        'Top-ups',
        ['Top-up', 'Credits', 'Amount (USD)', 'State', 'Reason', 'Invoice', 'Created'],
        response.topups.map((topup) => ({
          cells: [
            num(topup.id),
            num(wholeCredits(topup.credits)),
            num(topup.amount_usd),
            STATUS_WORDS[topup.status],
            topup.pending_reason ?? topup.failure_reason ?? '—',
            num(topup.kb_invoice_id ?? '—'),
            num(shortDateTime(topup.created_at)),
          ],
        })),
      ),
    );
  }

  async function loadLedger(): Promise<void> {
    const ledger = await api.get<LedgerView>(`/api/teams/${selectedTeam()}/ledger`);
    clear(ledgerHolder);
    const rows = ledger.movements.flatMap((movement) =>
      movement.entries.map((entry) => ({
        cells: [
          num(movement.id),
          movement.kind,
          num(shortDateTime(movement.created_at)),
          num(movement.job_id ?? movement.topup_id ?? '—'),
          num(movement.kb_invoice_id ?? '—'),
          entry.account,
          num(credits(entry.amount_micro)),
        ],
      })),
    );
    ledgerExport.setAttribute('href', `/api/teams/${selectedTeam()}/ledger.csv`);
    ledgerHolder.append(
      el('h3', { class: 'section-heading', text: 'Ledger' }),
      el('div', { class: 'toolbar' }, [ledgerExport]),
      table('Ledger', ['Movement', 'Kind', 'Created', 'Job or top-up', 'Invoice', 'Account', 'Credits'], rows),
    );
  }

  async function loadRates(): Promise<void> {
    const slug = modelSelect.value;
    const response = await api.get<{ rates: RateView[] }>(`/api/models/${slug}/rates`);
    clear(ratesHolder);
    ratesHolder.append(
      el('h3', { class: 'section-heading', text: 'Rate schedule' }),
      table(
        'Rate schedule',
        ['Rate', 'Credits per unit', 'Effective at', 'State', 'Actions'],
        response.rates.map((rate) => {
          const actions: Node[] = [];
          if (rate.status === 'scheduled' && !readOnly) {
            const withdraw = el('button', {
              type: 'button',
              class: 'secondary',
              text: 'Withdraw',
              'aria-label': `Withdraw rate ${rate.id}`,
            });
            withdraw.addEventListener('click', () => {
              notice('Withdrawing…');
              void api
                .del(`/api/models/${slug}/rates/${rate.id}`)
                .then(() => {
                  notice(`Scheduled rate ${rate.id} withdrawn.`);
                  void loadRates();
                })
                .catch((error: unknown) => {
                  if (!(error instanceof ApiFailure)) throw error;
                  alertError(
                    error.status === 409 ? 'That rate is already in effect and cannot be withdrawn.' : error.message,
                  );
                });
            });
            actions.push(withdraw);
          }
          return {
            cells: [
              num(rate.id),
              num(formatRate(rate.micro_per_unit)),
              num(rate.effective_at_local.replace('T', ' ').slice(0, 16)),
              RATE_WORDS[rate.status],
              el('div', { class: 'row-actions' }, actions),
            ],
          };
        }),
      ),
    );
  }

  async function loadMeter(): Promise<void> {
    const meter = await api.get<MeterView>(`/api/teams/${selectedTeam()}/meter`);
    noteZoneFromPeriod(meter.period.label, meter.period.starts_at);
    ribbon.update(meter, new Map());
  }

  topUpForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearMessages();
    const amount = Number.parseInt(creditsInput.value, 10);
    topUpButton.disabled = true;
    topUpButton.textContent = 'Recording payment…';
    void api
      .post<{ topup: TopupView }>('/api/topups', { team_id: teamSelect.value, credits: amount })
      .then((response) => {
        if (response.topup.status === 'paid') {
          notice(`Added ${wholeCredits(response.topup.credits)} credits to ${teamName(response.topup.team_id)}.`);
        } else {
          notice(
            `Billing is unreachable. Your top-up of ${wholeCredits(
              response.topup.credits,
            )} credits is pending; no credits have been added yet.`,
          );
        }
        void loadTopups();
        void loadLedger();
        void loadMeter();
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        if (error.status === 502) alertError('Billing declined the top-up; no credits were added.');
        else if (error.status === 422) alertError(Object.values(error.fields)[0] ?? error.message);
        else alertError(error.message);
        void loadTopups();
      })
      .finally(() => {
        topUpButton.disabled = readOnly;
        topUpButton.textContent = 'Top up';
      });
  });

  scheduleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearMessages();
    rateError.textContent = '';
    momentError.textContent = '';
    const rateText = rateInput.value.trim();
    const momentText = momentInput.value.trim();
    let valid = true;
    if (!RATE_PATTERN.test(rateText) || Number(rateText) < 0.000001 || Number(rateText) > 1000000) {
      rateError.textContent = 'Enter a rate from 0.000001 to 1000000 with at most six decimals.';
      valid = false;
    }
    if (!MOMENT_PATTERN.test(momentText)) {
      momentError.textContent = 'Use the format YYYY-MM-DD HH:MM.';
      valid = false;
    }
    if (!valid) {
      alertError('Fix the highlighted fields.');
      return;
    }
    const [whole, fraction = ''] = rateText.split('.');
    const microPerUnit = BigInt(whole ?? '0') * 1000000n + BigInt((fraction + '000000').slice(0, 6));
    const slug = modelSelect.value;
    scheduleButton.disabled = true;
    scheduleButton.textContent = 'Saving…';
    void api
      .post<{ rate: RateView }>(`/api/models/${slug}/rates`, {
        micro_per_unit: Number(microPerUnit),
        effective_at_local: `${momentText.replace(' ', 'T')}:00`,
      })
      .then((response) => {
        const model = state.models.find((candidate) => candidate.slug === slug);
        notice(
          `New rate for ${model?.name ?? slug} takes effect ${localMinute(response.rate.effective_at)} ${orgZoneName()}.`,
        );
        void loadRates();
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) throw error;
        if (error.status === 422) {
          rateError.textContent = error.fields['micro_per_unit'] ?? '';
          momentError.textContent = error.fields['effective_at_local'] ?? '';
          alertError('Fix the highlighted fields.');
        } else alertError(error.message);
      })
      .finally(() => {
        scheduleButton.disabled = readOnly;
        scheduleButton.textContent = 'Schedule';
      });
  });

  modelSelect.addEventListener('change', () => void loadRates());
  teamSelect.addEventListener('change', () => {
    state.selectedTeamId = teamSelect.value;
    void refresh();
  });

  async function refresh(): Promise<void> {
    await Promise.all([loadMeter(), loadTopups(), loadLedger(), loadRates()]);
  }

  shell.main.append(
    el('h1', { class: 'screen-title', text: 'Finance' }),
    ribbon.root,
    el('h3', { class: 'section-heading', text: 'Top up credits' }),
    topUpForm,
    topupsHolder,
    ledgerHolder,
    el('h3', { class: 'section-heading', text: 'Schedule rate change' }),
    scheduleForm,
    ratesHolder,
  );
  void refresh();
  timers.push(window.setInterval(() => void refresh(), 3000));
  return () => {
    for (const timer of timers) window.clearInterval(timer);
  };
}
