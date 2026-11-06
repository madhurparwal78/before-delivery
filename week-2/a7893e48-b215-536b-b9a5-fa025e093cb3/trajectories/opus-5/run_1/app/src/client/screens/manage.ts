import type {
  BinderLink,
  Dashboard,
  PolicyVersion,
  RenterSummary,
  Utilisation,
} from '../../shared/types.js';
import { api, firstFieldMessage } from '../api.js';
import { state } from '../app.js';
import { copy, hours, money } from '../copy.js';
import { clear, el, setStatus, statusRegion } from '../dom.js';

function todayIn(zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/\//g, '-');
}

function sitePicker(label: string): HTMLSelectElement {
  return el(
    'select',
    { class: 'select', 'aria-label': label },
    state.sites.map((site) => el('option', { value: site.id }, [site.name])),
  );
}

export function manageScreen(host: HTMLElement): void {
  const status = statusRegion('Manager status');
  const firstSite = state.sites[0];
  const defaultSiteId = firstSite?.id ?? '';
  const defaultDate = todayIn(firstSite?.time_zone ?? 'UTC');

  const totals = el('div', { role: 'region', 'aria-label': 'Site totals', class: 'panel totals' });
  const search = el('input', { type: 'search', class: 'input', 'aria-label': 'Search renters' });
  const results = el('ul', { class: 'renter-results', 'aria-label': 'Renter results' });
  const reportSite = sitePicker('Report site');
  const reportDay = el('input', {
    type: 'text',
    class: 'input mono',
    'aria-label': 'Report day',
    value: defaultDate,
  });
  const utilisationBody = el('tbody');
  const utilisationTable = el('table', { class: 'data-table', 'aria-label': 'Station utilisation' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Station']),
        el('th', { scope: 'col' }, ['Booked hours']),
        el('th', { scope: 'col' }, ['Day hours']),
        el('th', { scope: 'col' }, ['Utilisation']),
      ]),
    ]),
    utilisationBody,
  ]);
  const csvLink = el('a', { class: 'link', href: '#', download: '' }, ['Download CSV']);

  const policySite = sitePicker('Policy site');
  const noticeHours = el('input', {
    type: 'number',
    class: 'input mono',
    'aria-label': 'Notice hours',
    min: 1,
    max: 168,
    value: 48,
  });
  const effectiveFrom = el('input', {
    type: 'text',
    class: 'input mono',
    'aria-label': 'Effective from',
    value: defaultDate,
  });
  const schedulePolicy = el('button', { type: 'button', class: 'button primary' }, ['Schedule policy']);
  const policyBody = el('tbody');
  const policyTable = el('table', { class: 'data-table', 'aria-label': 'Policy versions' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Notice']),
        el('th', { scope: 'col' }, ['Effective from']),
        el('th', { scope: 'col' }, ['Scheduled by']),
      ]),
    ]),
    policyBody,
  ]);

  const binderSite = sitePicker('Binder site');
  const binderFrom = el('input', { type: 'text', class: 'input mono', 'aria-label': 'Binder from', value: defaultDate });
  const binderTo = el('input', { type: 'text', class: 'input mono', 'aria-label': 'Binder to', value: defaultDate });
  const createBinder = el('button', { type: 'button', class: 'button primary' }, ['Create binder link']);
  const binderBody = el('tbody');
  const binderTable = el('table', { class: 'data-table', 'aria-label': 'Binder links' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Link']),
        el('th', { scope: 'col' }, ['Range']),
        el('th', { scope: 'col' }, ['Expires']),
        el('th', { scope: 'col' }, ['State']),
        el('th', { scope: 'col' }, ['Actions']),
      ]),
    ]),
    binderBody,
  ]);

  async function loadTotals(): Promise<void> {
    const result = await api.get<Dashboard>('/api/dashboard');
    clear(totals);
    totals.append(el('h2', {}, ['Site totals']));
    if (!result.ok) return;
    for (const site of [...result.data.sites, null]) {
      const figures =
        site === null
          ? { name: 'All sites', ...result.data.totals, local_date: '' }
          : site;
      totals.append(
        el('div', { class: 'totals-card' }, [
          el('h3', {}, [figures.name]),
          el('p', { class: 'mono' }, [`Bookings today ${figures.bookings_today}`]),
          el('p', { class: 'mono' }, [
            `Booked hours today ${hours(figures.booked_minutes_today)} h`,
          ]),
          el('p', { class: 'mono' }, [`Unpaid balances ${money(figures.unpaid_balance_cents)}`]),
          el('p', { class: 'mono' }, [
            `Documents expiring in 14 days ${figures.expiring_documents}`,
          ]),
        ]),
      );
    }
  }

  let searchTimer = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void runSearch(), 300);
  });

  async function runSearch(): Promise<void> {
    const result = await api.get<{ renters: RenterSummary[] }>(
      `/api/renters?q=${encodeURIComponent(search.value.trim())}`,
    );
    clear(results);
    if (!result.ok) return;
    for (const renter of result.data.renters) {
      const site = state.sites.find((entry) => entry.id === renter.home_site_id);
      results.append(
        el('li', {}, [
          el('span', { class: 'renter-business' }, [renter.business]),
          el('span', {}, [renter.name]),
          el('span', { class: 'mono' }, [renter.email]),
          el('span', {}, [site?.name ?? renter.home_site_id]),
        ]),
      );
    }
  }

  async function loadUtilisation(): Promise<void> {
    const result = await api.get<Utilisation>(
      `/api/sites/${reportSite.value}/utilisation?date=${reportDay.value.trim()}`,
    );
    clear(utilisationBody);
    csvLink.setAttribute(
      'href',
      `/api/sites/${reportSite.value}/utilisation.csv?date=${reportDay.value.trim()}`,
    );
    if (!result.ok) {
      setStatus(status, firstFieldMessage(result.error));
      return;
    }
    for (const station of result.data.stations) {
      utilisationBody.append(
        el('tr', {}, [
          el('td', {}, [station.name]),
          el('td', { class: 'mono' }, [`${hours(station.booked_minutes)} h`]),
          el('td', { class: 'mono' }, [`${hours(result.data.day_minutes)} h`]),
          el('td', { class: 'mono' }, [`${station.utilisation_percent.toFixed(1)}%`]),
        ]),
      );
    }
  }

  async function loadPolicies(): Promise<void> {
    const result = await api.get<{ versions: PolicyVersion[] }>(
      `/api/sites/${policySite.value}/policies`,
    );
    clear(policyBody);
    if (!result.ok) return;
    for (const version of result.data.versions) {
      policyBody.append(
        el('tr', {}, [
          el('td', { class: 'mono' }, [`${version.notice_hours} h`]),
          el('td', { class: 'mono' }, [version.effective_from]),
          el('td', {}, [version.created_by_name]),
        ]),
      );
    }
  }

  async function loadBinderLinks(): Promise<void> {
    const result = await api.get<{ links: BinderLink[] }>(
      `/api/sites/${binderSite.value}/binder-links`,
    );
    clear(binderBody);
    if (!result.ok) return;
    for (const link of result.data.links) {
      const regenerate = el('button', { type: 'button', class: 'button' }, ['Regenerate']);
      const revoke = el('button', { type: 'button', class: 'button' }, ['Revoke']);
      regenerate.addEventListener('click', () => {
        setStatus(status, copy.saving);
        void api.post(`/api/binder-links/${link.id}/regenerate`, {}).then(async (outcome) => {
          setStatus(status, outcome.ok ? copy.binderRegenerated : outcome.error.message);
          await loadBinderLinks();
        });
      });
      revoke.addEventListener('click', () => {
        setStatus(status, copy.saving);
        void api.delete(`/api/binder-links/${link.id}`).then(async (outcome) => {
          setStatus(status, outcome.ok ? copy.binderRevoked : outcome.error.message);
          await loadBinderLinks();
        });
      });
      binderBody.append(
        el('tr', {}, [
          el('td', {}, [
            el('a', { class: 'link mono', href: link.url, target: '_blank', rel: 'noreferrer' }, [
              link.url,
            ]),
          ]),
          el('td', { class: 'mono' }, [`${link.from} → ${link.to}`]),
          el('td', { class: 'mono' }, [link.expires_at.replace('T', ' ').slice(0, 16)]),
          el('td', {}, [link.revoked ? 'Revoked' : 'Live']),
          el('td', {}, [el('div', { class: 'row-actions' }, [regenerate, revoke])]),
        ]),
      );
    }
  }

  reportSite.addEventListener('change', () => void loadUtilisation());
  reportDay.addEventListener('change', () => void loadUtilisation());
  policySite.addEventListener('change', () => void loadPolicies());
  binderSite.addEventListener('change', () => void loadBinderLinks());

  schedulePolicy.addEventListener('click', () => {
    setStatus(status, copy.scheduling);
    void api
      .post<{ version: PolicyVersion }>(`/api/sites/${policySite.value}/policies`, {
        notice_hours: Number(noticeHours.value),
        effective_from: effectiveFrom.value.trim(),
      })
      .then(async (result) => {
        if (!result.ok) {
          setStatus(
            status,
            result.status === 409 ? copy.policyDateTaken : firstFieldMessage(result.error),
          );
          return;
        }
        setStatus(
          status,
          copy.policyScheduled(result.data.version.notice_hours, result.data.version.effective_from),
        );
        await loadPolicies();
      });
  });

  createBinder.addEventListener('click', () => {
    setStatus(status, copy.saving);
    void api
      .post<{ link: BinderLink }>(`/api/sites/${binderSite.value}/binder-links`, {
        from: binderFrom.value.trim(),
        to: binderTo.value.trim(),
      })
      .then(async (result) => {
        if (!result.ok) {
          setStatus(status, firstFieldMessage(result.error));
          return;
        }
        setStatus(status, copy.binderReady);
        await loadBinderLinks();
      });
  });

  reportSite.value = defaultSiteId;
  policySite.value = defaultSiteId;
  binderSite.value = defaultSiteId;

  host.append(
    el('div', { class: 'manage-grid' }, [
      totals,
      el('section', { class: 'panel' }, [
        el('h2', {}, ['Renter search']),
        el('div', { class: 'field' }, [
          el('label', { class: 'field-label' }, ['Search renters']),
          search,
        ]),
        results,
      ]),
      el('section', { class: 'panel' }, [
        el('h2', {}, ['Station utilisation']),
        el('div', { class: 'inline-fields' }, [
          el('div', { class: 'field inline' }, [
            el('label', { class: 'field-label' }, ['Report site']),
            reportSite,
          ]),
          el('div', { class: 'field inline' }, [
            el('label', { class: 'field-label' }, ['Report day']),
            reportDay,
          ]),
        ]),
        el('div', { class: 'table-frame' }, [utilisationTable]),
        csvLink,
      ]),
      el('section', { class: 'panel' }, [
        el('h2', {}, ['Cancellation policy']),
        el('div', { class: 'inline-fields' }, [
          el('div', { class: 'field inline' }, [
            el('label', { class: 'field-label' }, ['Policy site']),
            policySite,
          ]),
          el('div', { class: 'field inline' }, [
            el('label', { class: 'field-label' }, ['Notice hours']),
            noticeHours,
          ]),
          el('div', { class: 'field inline' }, [
            el('label', { class: 'field-label' }, ['Effective from']),
            effectiveFrom,
          ]),
          schedulePolicy,
        ]),
        el('div', { class: 'table-frame' }, [policyTable]),
      ]),
      el('section', { class: 'panel' }, [
        el('h2', {}, ['Binder links']),
        el('div', { class: 'inline-fields' }, [
          el('div', { class: 'field inline' }, [
            el('label', { class: 'field-label' }, ['Binder site']),
            binderSite,
          ]),
          el('div', { class: 'field inline' }, [
            el('label', { class: 'field-label' }, ['Binder from']),
            binderFrom,
          ]),
          el('div', { class: 'field inline' }, [
            el('label', { class: 'field-label' }, ['Binder to']),
            binderTo,
          ]),
          createBinder,
        ]),
        el('div', { class: 'table-frame' }, [binderTable]),
      ]),
      el('section', { class: 'panel status-panel' }, [status]),
    ]),
  );

  void loadTotals();
  void runSearch();
  void loadUtilisation();
  void loadPolicies();
  void loadBinderLinks();
}
