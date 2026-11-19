import { SERVICE_LABELS } from './copy';
import { clear, el, row, table } from './dom';
import { icon } from './icons';
import { localDateOf, localTimeOf } from '../shared/tz';

export interface VisitLike {
  arrived_at: string;
  departed_at: string | null;
  services: string[];
  operator_signature: string;
  manager_name: string;
  gap_hours: number | null;
  gap_flagged: boolean;
}

export function siteStamp(instant: string | null, zone: string): string {
  if (instant === null) return '—';
  const at = Date.parse(instant);
  return `${localDateOf(zone, at)} ${localTimeOf(zone, at)}`;
}

export function gapCellText(visit: VisitLike): string {
  if (visit.gap_hours === null) return '—';
  const text = visit.gap_hours.toFixed(2);
  return visit.gap_flagged ? `Gap ${text} h — over 24 hours` : `${text} h`;
}

export function visitTable(name: string): {
  root: HTMLTableElement;
  draw: (visits: VisitLike[], zone: string) => void;
} {
  const built = table(name, [
    'Arrived',
    'Departed',
    'Services',
    'Operator signature',
    'Manager',
    'Gap',
  ]);
  const draw = (visits: VisitLike[], zone: string): void => {
    clear(built.body);
    for (const visit of visits) {
      built.body.append(
        row([
          { label: 'Arrived', content: siteStamp(visit.arrived_at, zone) },
          { label: 'Departed', content: siteStamp(visit.departed_at, zone) },
          {
            label: 'Services',
            content:
              visit.services.length === 0
                ? '—'
                : visit.services.map((service) => SERVICE_LABELS[service] ?? service).join(', '),
          },
          {
            label: 'Operator signature',
            content: visit.operator_signature === '' ? '—' : visit.operator_signature,
          },
          { label: 'Manager', content: visit.manager_name },
          { label: 'Gap', content: gapCellText(visit) },
        ]),
      );
    }
  };
  return { root: built.root, draw };
}

export function overdueNotice(): {
  element: HTMLElement;
  update: (overdue: boolean, lastDepartedAt: string | null, zone: string) => void;
} {
  const element = el('p', { class: 'overdue-notice' });
  element.hidden = true;
  const update = (overdue: boolean, lastDepartedAt: string | null, zone: string): void => {
    if (!overdue || lastDepartedAt === null) {
      element.hidden = true;
      clear(element);
      return;
    }
    const at = Date.parse(lastDepartedAt);
    clear(element);
    element.append(
      icon('flame'),
      document.createTextNode(
        `Overdue: last return ${localDateOf(zone, at)} ${localTimeOf(zone, at)}`,
      ),
    );
    element.hidden = false;
  };
  return { element, update };
}
