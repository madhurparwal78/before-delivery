import { getJson, type ApiErrorBody, type InspectionRecord } from '../api.js';
import { COPY } from '../copy.js';
import { el, oneDecimal, setStatus, twoDecimals } from '../dom.js';
import type { Page, PageContext } from '../main.js';

export async function renderInspect(context: PageContext, token: string): Promise<Page> {
  const result = await getJson<InspectionRecord & ApiErrorBody>(
    `/api/inspect/${encodeURIComponent(token)}`,
  );
  if (!result.ok) {
    const message =
      result.body.error === 'link_expired'
        ? COPY.linkExpired
        : result.body.error === 'link_revoked'
          ? COPY.linkRevoked
          : COPY.linkUnknown;
    return { element: el('div', { class: 'page inspect' }, [el('h1', { text: message })]) };
  }

  const record = result.body;
  const rows: HTMLElement[] = [];
  for (const crew of record.crew) {
    for (const day of crew.days) {
      rows.push(
        el('tr', {}, [
          el('td', { text: crew.name }),
          el('td', { text: crew.rank }),
          el('td', { text: day.ship_date }),
          el('td', { text: oneDecimal(day.rest_hours) }),
          el('td', { text: String(day.cell_count) }),
          el('td', { text: day.signed_at_utc ?? '' }),
          el('td', { text: day.countersigned_at_utc ?? '' }),
          el('td', {
            text: day.late_entries.length > 0 ? `${day.late_entries.length} ${COPY.lateEntry}` : '',
          }),
          el('td', { text: day.notes.map((note) => note.text).join(' ') }),
        ]),
      );
    }
  }

  const breachItems: HTMLElement[] = [];
  for (const crew of record.crew) {
    for (const breach of crew.breaches) {
      breachItems.push(
        el('li', {
          text: `${crew.name}: ${breach.rule} in the ${breach.window_hours}-hour window from ${breach.window_start_utc} to ${breach.window_end_utc}, judged under ${
            breach.rule_set === 'flag_exception' ? 'the flag exception rules' : 'the standard rules'
          }`,
        }),
      );
    }
  }

  const eventItems = record.events.map((event) =>
    el('li', {
      text: `${event.kind === 'drill' ? 'Drill' : 'Call-out'} from ${event.start_utc} to ${
        event.end_utc
      }: ${event.description}`,
    }),
  );
  const clockItems = record.clock_changes.map((change) =>
    el('li', {
      text: `Clock change ${change.label} at ${change.changes_at_utc}, ${change.kind}`,
    }),
  );
  const fixItems = record.fixes.map((fix) =>
    el('li', {
      text: `Position fix at ${fix.at_utc}: ${twoDecimals(fix.latitude)}, ${twoDecimals(
        fix.longitude,
      )}`,
    }),
  );

  const documentLink = el(
    'a',
    {
      href: `/api/inspect/${encodeURIComponent(token)}/document`,
      download: 'inspection-record.pdf',
    },
    ['Download inspection document'],
  );
  documentLink.addEventListener('click', (event) => {
    event.preventDefault();
    void (async () => {
      const response = await fetch(`/api/inspect/${encodeURIComponent(token)}/document`);
      if (response.status === 503) {
        setStatus(context.feedback, COPY.documentArchiveDown);
        return;
      }
      if (!response.ok) {
        setStatus(context.feedback, COPY.somethingWrong);
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = el('a', { href: url, download: 'inspection-record.pdf' });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    })();
  });

  const element = el('div', { class: 'page inspect' }, [
    el('h1', { text: 'Inspection record' }),
    el('p', {
      text: `${record.vessel.name}, ship's dates ${record.from_date} to ${record.to_date}.`,
    }),
    ...(rows.length === 0 ? [el('p', { text: COPY.inspectorNothingSealed })] : []),
    el('div', { class: 'scroll-x' }, [
      el('table', { 'aria-label': 'Sealed days' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col', text: 'Crew member' }),
            el('th', { scope: 'col', text: 'Rank' }),
            el('th', { scope: 'col', text: "Ship's date" }),
            el('th', { scope: 'col', text: 'Rest hours' }),
            el('th', { scope: 'col', text: 'Cells' }),
            el('th', { scope: 'col', text: 'Signed' }),
            el('th', { scope: 'col', text: 'Countersigned' }),
            el('th', { scope: 'col', text: 'Late entries' }),
            el('th', { scope: 'col', text: 'Notes' }),
          ]),
        ]),
        el('tbody', {}, rows),
      ]),
    ]),
    el('section', { 'aria-label': 'Voyage events', class: 'pane' }, [
      el('h2', { class: 'pane-label', text: 'Voyage events' }),
      el('ul', { class: 'plain-list' }, [...clockItems, ...fixItems, ...eventItems]),
      el('h3', { class: 'small-label', text: 'Breaches' }),
      el('ul', { class: 'plain-list' }, breachItems.length > 0 ? breachItems : [
        el('li', { text: COPY.noBreaches }),
      ]),
      ...(record.unsealed_dates.length > 0
        ? [
            el('p', {
              text: `Not sealed in this range: ${record.unsealed_dates.join(', ')}`,
            }),
          ]
        : []),
    ]),
    el('div', { class: 'actions' }, [documentLink]),
  ]);
  return { element };
}
