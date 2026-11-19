import { request } from '../api';
import { COPY, hours, money } from '../copy';
import { button, clear, el, labelled, row, table } from '../dom';
import { StatusRegion, showFieldError } from '../status';
import type { MemberSearchJson, ReportJson } from '../../shared/types';

export function renderReports(container: HTMLElement): void {
  const status = new StatusRegion('Report status');
  const utilisation = table('Utilisation by site', [
    'Site',
    'Scheduled hours',
    'Used hours',
    'Forfeited hours',
    'Overage',
  ]);
  const month = el('input', { type: 'text', 'aria-label': 'Month', id: 'report-month' });
  const memberBox = el('input', {
    type: 'text',
    role: 'combobox',
    'aria-label': 'Member',
    'aria-expanded': 'false',
    'aria-autocomplete': 'list',
    autocomplete: 'off',
    id: 'report-member',
  });
  const results = el('ul', { role: 'listbox', 'aria-label': 'Members', class: 'listbox' });
  results.hidden = true;
  const show = button('Show report', { class: 'primary' });
  const download = el('a', { class: 'inline-link', text: 'Download CSV', href: '#' });

  container.append(
    el('div', { class: 'rail' }, [
      el('div', { class: 'rail-row' }, [
        el('div', { class: 'field field-inline' }, [
          el('label', { for: 'report-month', text: 'Month' }),
          month,
        ]),
        el('div', { class: 'field field-inline' }, [
          el('label', { for: 'report-member', text: 'Member' }),
          memberBox,
        ]),
        show,
      ]),
      results,
    ]),
    utilisation.root,
    download,
    status.element,
  );

  let chosenMemberId: string | null = null;
  let reportGeneration = 0;
  let searchGeneration = 0;

  function drawReport(report: ReportJson): void {
    clear(utilisation.body);
    for (const site of report.sites) {
      utilisation.body.append(
        row([
          { label: 'Site', content: site.site_name },
          { label: 'Scheduled hours', content: hours(site.scheduled_hours) },
          { label: 'Used hours', content: hours(site.used_hours) },
          { label: 'Forfeited hours', content: hours(site.forfeited_hours) },
          { label: 'Overage', content: `$${money(site.overage_cents)}` },
        ]),
      );
    }
    utilisation.body.append(
      row([
        { label: 'Site', content: 'Total' },
        { label: 'Scheduled hours', content: hours(report.totals.scheduled_hours) },
        { label: 'Used hours', content: hours(report.totals.used_hours) },
        { label: 'Forfeited hours', content: hours(report.totals.forfeited_hours) },
        { label: 'Overage', content: `$${money(report.totals.overage_cents)}` },
      ]),
    );
  }

  function csvHref(monthValue: string, memberId: string | null): string {
    const base = `/api/reports/utilisation.csv?month=${encodeURIComponent(monthValue)}`;
    return memberId === null ? base : `${base}&member_id=${encodeURIComponent(memberId)}`;
  }

  function loadFromAddress(): void {
    const params = new URLSearchParams(window.location.search);
    const monthValue = params.get('month');
    const memberId = params.get('member');
    month.value = monthValue ?? '';
    chosenMemberId = memberId;
    if (monthValue === null) {
      clear(utilisation.body);
      memberBox.value = '';
      return;
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthValue)) {
      clear(utilisation.body);
      showFieldError(month, COPY.monthInvalid);
      status.write(COPY.monthInvalid);
      return;
    }
    runReport(monthValue, memberId);
  }

  function runReport(monthValue: string, memberId: string | null): void {
    reportGeneration += 1;
    const generation = reportGeneration;
    status.write(COPY.loadingReport);
    const query =
      memberId === null
        ? `/api/reports/utilisation?month=${encodeURIComponent(monthValue)}`
        : `/api/reports/utilisation?month=${encodeURIComponent(monthValue)}&member_id=${encodeURIComponent(memberId)}`;
    void request<ReportJson>(query).then((result) => {
      if (generation !== reportGeneration) return;
      if (result.ok) {
        drawReport(result.data);
        month.value = result.data.month;
        memberBox.value = result.data.member === null ? '' : result.data.member.business_name;
        chosenMemberId = result.data.member === null ? null : result.data.member.id;
        download.setAttribute('href', csvHref(result.data.month, chosenMemberId));
        status.write(COPY.showingMonth(result.data.month));
        return;
      }
      if (result.error.code === 'not_found' && memberId !== null) {
        status.write(COPY.memberNotInTenant);
        memberBox.value = '';
        chosenMemberId = null;
        reportGeneration += 1;
        const nested = reportGeneration;
        void request<ReportJson>(
          `/api/reports/utilisation?month=${encodeURIComponent(monthValue)}`,
        ).then((unfiltered) => {
          if (nested !== reportGeneration || !unfiltered.ok) return;
          drawReport(unfiltered.data);
          download.setAttribute('href', csvHref(monthValue, null));
        });
        return;
      }
      if (result.error.code === 'validation') {
        clear(utilisation.body);
        showFieldError(month, COPY.monthInvalid);
        status.write(COPY.monthInvalid);
        return;
      }
      if (result.status === 401) return;
      status.write(result.status === 0 ? COPY.offline : COPY.internal);
    });
  }

  memberBox.addEventListener('input', () => {
    const term = memberBox.value;
    chosenMemberId = null;
    searchGeneration += 1;
    const generation = searchGeneration;
    if (term.length < 2) {
      results.hidden = true;
      memberBox.setAttribute('aria-expanded', 'false');
      clear(results);
      return;
    }
    void request<{ members: MemberSearchJson[] }>(
      `/api/members?q=${encodeURIComponent(term)}`,
    ).then((result) => {
      if (generation !== searchGeneration || !result.ok) return;
      clear(results);
      for (const member of result.data.members) {
        const option = el('li', {
          role: 'option',
          'aria-selected': 'false',
          tabindex: '-1',
          class: 'listbox-option',
          text: member.business_name,
        });
        option.addEventListener('click', () => {
          chosenMemberId = member.id;
          memberBox.value = member.business_name;
          results.hidden = true;
          memberBox.setAttribute('aria-expanded', 'false');
        });
        results.append(option);
      }
      results.hidden = result.data.members.length === 0;
      memberBox.setAttribute('aria-expanded', results.hidden ? 'false' : 'true');
    });
  });

  memberBox.addEventListener('keydown', (event) => {
    const options = Array.from(results.querySelectorAll('[role="option"]')) as HTMLElement[];
    if (event.key === 'Escape') {
      results.hidden = true;
      memberBox.setAttribute('aria-expanded', 'false');
      return;
    }
    if (options.length === 0) return;
    const index = options.findIndex((option) => option.getAttribute('aria-selected') === 'true');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next =
        event.key === 'ArrowDown'
          ? Math.min(options.length - 1, index + 1)
          : Math.max(0, index - 1);
      options.forEach((option, position) =>
        option.setAttribute('aria-selected', position === next ? 'true' : 'false'),
      );
      return;
    }
    if (event.key === 'Enter' && index >= 0) {
      event.preventDefault();
      (options[index] as HTMLElement).click();
    }
  });

  show.addEventListener('click', () => {
    const monthValue = month.value;
    const path =
      chosenMemberId === null
        ? `/reports?month=${encodeURIComponent(monthValue)}`
        : `/reports?month=${encodeURIComponent(monthValue)}&member=${encodeURIComponent(chosenMemberId)}`;
    window.history.pushState({}, '', path);
    loadFromAddress();
  });

  loadFromAddress();
}
