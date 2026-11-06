import {
  changeAnnouncedCopy,
  ERROR_COPY,
  PENDING_COPY,
  STATE_COPY,
} from '../../shared/copy';
import { get, request, RequestFailed } from '../api';
import { carry, takeCarried } from '../carry';
import { button, dataTable, definition, element, heading } from '../dom';
import { showDate, showDateTime, showMoney } from '../format';
import { Cleanup, navigate, RouteContext } from '../router';
import { Dialog, dialogActions } from '../ui/dialog';
import { Choice, Field, monoField, problemsSummary, selectField, textField } from '../ui/fields';
import { staffFrame } from '../ui/frame';
import { ActionNote } from '../ui/live';

interface ChangeBody {
  id: string;
  thresholdCents: number;
  takesEffectOn: string;
  takesEffectAt: string;
  announcedBy: string | null;
  announcedAt: string;
  state: string;
}

interface RuleBody {
  code: string;
  name: string;
  currency: string;
  ruleInForce: { thresholdCents: number; since: string } | null;
  changes: ChangeBody[];
}

function nextChange(rule: RuleBody): ChangeBody | null {
  return rule.changes.find((change) => change.state === 'scheduled') ?? null;
}

export async function rulesScreen(host: HTMLElement, context: RouteContext): Promise<Cleanup> {
  const slug = context.params.slug;
  const frame = await staffFrame(host, slug, 'rules');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const carried = takeCarried();
  if (carried !== null) note.say(carried);
  const tableHost = element('div', { className: 'table-host' });
  const ownPanel = element('div', { className: 'panel' });
  let rules: RuleBody[] = [];

  const paint = (): void => {
    tableHost.replaceChildren(
      dataTable<RuleBody>(
        'Jurisdiction rules',
        [
          {
            label: 'Jurisdiction',
            cell: (rule) =>
              element('a', {
                text: rule.name,
                className: 'control link',
                attributes: { href: `/w/${slug}/rules/${rule.code}` },
              }),
          },
          {
            label: 'Rule in force',
            cell: (rule) =>
              element('span', {
                className: 'mono',
                text:
                  rule.ruleInForce === null
                    ? 'No rule in force'
                    : showMoney(rule.currency, rule.ruleInForce.thresholdCents),
              }),
          },
          {
            label: 'Since',
            cell: (rule) =>
              element('span', {
                className: 'mono',
                text: rule.ruleInForce === null ? '' : showDate(rule.ruleInForce.since),
              }),
          },
          {
            label: 'Announced change',
            cell: (rule) => {
              const change = nextChange(rule);
              return element('span', {
                className: 'mono',
                text:
                  change === null
                    ? 'None'
                    : `${showMoney(rule.currency, change.thresholdCents)} from ${showDate(change.takesEffectOn)}`,
              });
            },
          },
        ],
        rules,
        STATE_COPY.emptyTable,
      ),
    );
    const own = rules.find((rule) => rule.code === frame.workspace.jurisdictionCode);
    ownPanel.replaceChildren(
      element('h2', { text: 'Your own rule' }),
      definition('Jurisdiction', own?.name ?? ''),
      definition(
        'Threshold in force',
        element('span', {
          className: 'mono',
          text:
            own?.ruleInForce === undefined || own.ruleInForce === null
              ? 'No rule in force'
              : showMoney(own.currency, own.ruleInForce.thresholdCents),
        }),
      ),
      definition(
        'Since',
        element('span', {
          className: 'mono',
          text:
            own?.ruleInForce === undefined || own.ruleInForce === null
              ? ''
              : showDate(own.ruleInForce.since),
        }),
      ),
    );
  };

  const refresh = async (): Promise<void> => {
    rules = (await get<{ jurisdictions: RuleBody[] }>(`/api/w/${slug}/rules`)).jurisdictions;
    paint();
  };
  await refresh();

  const choices: Choice[] = rules.map((rule) => ({ value: rule.code, label: rule.name }));
  const dialog = new Dialog(frame.layer, {
    name: 'Announce change',
    build: (controller) => {
      const jurisdiction = selectField(
        'Jurisdiction',
        'jurisdictionCode',
        choices,
        frame.workspace.jurisdictionCode,
      );
      const threshold = monoField('Threshold', 'thresholdCents');
      const takesEffectOn = textField('Takes effect on', 'takesEffectOn', frame.workspace.today);
      takesEffectOn.control.classList.add('mono');
      const problems = problemsSummary();
      const fields: Field[] = [jurisdiction, threshold, takesEffectOn];
      const send = (): void => {
        problems.clear();
        for (const field of fields) field.clearError();
        note.say(PENDING_COPY.announceChange, 'pending');
        const parsed = /^(0|[1-9][0-9]*)(\.([0-9]{1,2}))?$/.exec(threshold.control.value.trim());
        const cents =
          parsed === null
            ? null
            : Number.parseInt(parsed[1], 10) * 100 +
              Number.parseInt((parsed[3] ?? '0').padEnd(2, '0'), 10);
        void request<{ change: ChangeBody }>('POST', `/api/w/${slug}/rules/changes`, {
          jurisdictionCode: jurisdiction.control.value,
          thresholdCents: cents,
          takesEffectOn: takesEffectOn.control.value,
        })
          .then((body) => {
            const rule = rules.find((entry) => entry.code === jurisdiction.control.value);
            carry(
              changeAnnouncedCopy(rule?.name ?? '', showDate(body.change.takesEffectOn)),
            );
            controller.close();
            navigate(`/w/${slug}/rules/${jurisdiction.control.value}`);
          })
          .catch((error: unknown) => {
            if (!(error instanceof RequestFailed)) {
              note.say(ERROR_COPY.not_found, 'refused');
              return;
            }
            note.say(error.failure.message, 'refused');
            if (Object.keys(error.failure.fields).length > 0) {
              problems.show(error.failure.fields, fields);
            } else {
              problems.showOne(error.failure.message);
            }
            problems.focus();
          });
      };
      const submit = button('Announce', send, { className: 'control primary' });
      const cancel = button('Cancel', () => controller.close());
      return {
        body: [
          element('h2', { text: 'Announce change', className: 'dialog-title' }),
          problems.node,
          jurisdiction.node,
          threshold.node,
          takesEffectOn.node,
          dialogActions(submit, cancel),
        ],
        first: () => jurisdiction.control,
      };
    },
  });
  frame.dialogs.push(dialog);
  const announceButton = button('Announce change', () => dialog.open(announceButton), {
    className: 'control primary',
  });
  if (frame.member.role !== 'compliance_officer') {
    announceButton.setAttribute('disabled', 'disabled');
  }

  frame.work.append(
    heading(1, 'Rules'),
    element('div', { className: 'toolbar-row', children: [announceButton] }),
    note.node,
    tableHost,
  );
  frame.evidence.append(ownPanel);
  return () => frame.destroy();
}

export async function jurisdictionRulesScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<Cleanup> {
  const slug = context.params.slug;
  const frame = await staffFrame(host, slug, 'rules');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const carried = takeCarried();
  if (carried !== null) note.say(carried);
  let rule: RuleBody;
  try {
    rule = (await get<{ jurisdiction: RuleBody }>(`/api/w/${slug}/rules/${context.params.code}`))
      .jurisdiction;
  } catch (error) {
    frame.work.append(heading(1, 'Page not found'), element('p', { text: STATE_COPY.unknownPage }));
    if (!(error instanceof RequestFailed)) throw error;
    return () => frame.destroy();
  }
  frame.work.append(
    heading(1, `${rule.name} rules`),
    note.node,
    dataTable<ChangeBody>(
      'Rule history',
      [
        {
          label: 'Threshold',
          cell: (change) =>
            element('span', {
              text: showMoney(rule.currency, change.thresholdCents),
              className: 'mono',
            }),
        },
        {
          label: 'Takes effect on',
          cell: (change) =>
            element('span', { text: showDate(change.takesEffectOn), className: 'mono' }),
        },
        {
          label: 'Takes effect at',
          cell: (change) =>
            element('span', {
              text: showDateTime(change.takesEffectAt, frame.workspace),
              className: 'mono',
            }),
        },
        { label: 'Announced by', cell: (change) => change.announcedBy ?? 'Seeded rule book' },
        { label: 'State', cell: (change) => (change.state === 'in_force' ? 'In force' : 'Scheduled') },
      ],
      rule.changes,
      STATE_COPY.emptyTable,
    ),
  );
  return () => frame.destroy();
}

interface DailyBody {
  date: string;
  timeZone: string;
  startsAt: string;
  endsAt: string;
  hours: number;
  transfers: number;
  cases: Array<{
    reference: string;
    createdAt: string;
    asset: string;
    amount: string;
    fiatValueCents: number;
    currency: string;
    thresholdCents: number;
    counterpartyName: string | null;
    path: string;
    status: string;
  }>;
}

export async function dailyReportScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<Cleanup> {
  const slug = context.params.slug;
  const frame = await staffFrame(host, slug, 'reports/daily');
  if (frame === null) return () => undefined;
  const note = new ActionNote(frame.status);
  const dateField = textField('Business date', 'date', frame.workspace.today);
  dateField.control.classList.add('mono');
  const problems = problemsSummary();
  const facts = element('div', { className: 'facts' });
  const tableHost = element('div', { className: 'table-host' });

  const load = async (): Promise<void> => {
    try {
      const body = await get<DailyBody>(
        `/api/w/${slug}/reports/daily?date=${encodeURIComponent(dateField.control.value)}`,
      );
      facts.replaceChildren(
        definition('Starts', element('span', { text: body.startsAt, className: 'mono' })),
        definition('Ends', element('span', { text: body.endsAt, className: 'mono' })),
        definition('Length', element('span', { text: `${body.hours} hours`, className: 'mono' })),
      );
      tableHost.replaceChildren(
        dataTable<DailyBody['cases'][number]>(
          'Transfers',
          [
            { label: 'Reference', cell: (row) => element('span', { text: row.reference, className: 'mono' }) },
            {
              label: 'Created',
              cell: (row) =>
                element('span', {
                  text: showDateTime(row.createdAt, frame.workspace),
                  className: 'mono',
                }),
            },
            {
              label: 'Amount',
              cell: (row) => element('span', { text: `${row.asset} ${row.amount}`, className: 'mono' }),
            },
            {
              label: 'Fiat value',
              cell: (row) =>
                element('span', { text: showMoney(row.currency, row.fiatValueCents), className: 'mono' }),
            },
            {
              label: 'Threshold',
              cell: (row) =>
                element('span', { text: showMoney(row.currency, row.thresholdCents), className: 'mono' }),
            },
            { label: 'Counterparty', cell: (row) => row.counterpartyName ?? 'Self-hosted wallet' },
            { label: 'Status', cell: (row) => row.status },
          ],
          body.cases,
          STATE_COPY.dailyEmpty(showDate(body.date)),
        ),
      );
      if (body.cases.length === 0) note.say(STATE_COPY.dailyEmpty(showDate(body.date)));
      problems.clear();
    } catch (error) {
      if (error instanceof RequestFailed) {
        note.say(error.failure.message, 'refused');
        if (Object.keys(error.failure.fields).length > 0) {
          problems.show(error.failure.fields, [dateField]);
        } else {
          problems.showOne(error.failure.message);
        }
        return;
      }
      note.say(ERROR_COPY.not_found, 'refused');
    }
  };

  const showButton = button('Show report', () => void load(), { className: 'control primary' });
  frame.work.append(
    heading(1, 'Daily report'),
    problems.node,
    element('div', { className: 'toolbar-row', children: [dateField.node, showButton] }),
    note.node,
    facts,
    tableHost,
  );
  await load();
  return () => frame.destroy();
}
