import type {
  ClusterView,
  Freeze,
  FreezePolicyResponse,
  FreezePolicyVersion,
  GraphResponse,
  SessionResponse,
  SyncWindow,
  WeekDay,
  WindowDecision,
  WindowOpening,
} from '../../shared/types.js';
import { WEEK_DAYS, clusterTime, instantFromZonedLocal, localStamp, parseLocalStamp } from '../../shared/zone.js';
import { mayPerform } from '../../shared/authority.js';
import { ApiCallFailed, get, newRequestKey, send } from '../api.js';
import { copy, decisionSummary } from '../copy.js';
import { labelledField, openDialog } from '../dialog.js';
import { append, clear, el, mount, svgIcon } from '../dom.js';
import { icons } from '../icons.js';
import { announce, clearProblem, failureMessage, problem } from '../live.js';
import { navigate } from '../router.js';

const CLOCK_MS = 30_000;

/** The per-field messages a validation refusal carries, so each sits under its own field. */
function fieldErrors(cause: unknown): Record<string, string> {
  return cause instanceof ApiCallFailed ? (cause.failure.fields ?? {}) : {};
}
const DAY_LABELS: Record<WeekDay, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

function dayList(days: WeekDay[]): string {
  return WEEK_DAYS.filter((day) => days.includes(day))
    .map((day) => DAY_LABELS[day])
    .join(' ');
}

export async function renderWindows(slug: string, session: SessionResponse): Promise<void> {
  const graph = await get<GraphResponse>(`/api/projects/${slug}/graph`);
  const mayEdit = mayPerform(graph.role, 'manage_windows');

  const body = el('div', { class: 'sheetpage__body' });
  const railPanel = el('div', { class: 'rail', 'data-open': 'false' }, [
    el('div', { class: 'rail__brand' }, ['Keelson']),
    el('a', { class: 'rail__link', href: `/projects/${slug}` }, ['Stage graph']),
    el('div', { class: 'rail__spacer' }),
    el('div', { class: 'rail__person' }, [
      el('strong', {}, [session.user.name]),
      el('span', {}, [graph.role.replace(/_/g, ' ')]),
    ]),
  ]);
  const menuButton = el('button', { type: 'button', class: 'btn btn--quiet' }, [
    svgIcon(icons.menu),
    'Menu',
  ]);
  menuButton.addEventListener('click', () => {
    railPanel.setAttribute(
      'data-open',
      railPanel.getAttribute('data-open') === 'true' ? 'false' : 'true',
    );
  });
  mount(
    el('div', { class: 'sheetpage' }, [
      el('div', { class: 'topbar' }, [menuButton, el('span', { class: 'topbar__brand' }, ['Keelson'])]),
      railPanel,
      body,
    ]),
  );

  const clockSlots: { node: HTMLElement; timeZone: string }[] = [];

  async function refresh(): Promise<void> {
    const [{ clusters }, policy] = await Promise.all([
      get<{ clusters: ClusterView[] }>(`/api/projects/${slug}/clusters`),
      get<FreezePolicyResponse>(`/api/projects/${slug}/freeze-policy`),
    ]);
    const openings = new Map<string, WindowOpening[]>();
    for (const cluster of clusters) {
      const result = await get<{ openings: WindowOpening[] }>(
        `/api/projects/${slug}/clusters/${encodeURIComponent(cluster.name)}/window-openings?count=5`,
      );
      openings.set(cluster.name, result.openings);
    }
    paint(clusters, openings, policy);
  }

  function windowTable(cluster: ClusterView): HTMLElement {
    const rows = cluster.windows.map((window: SyncWindow) => {
      const cells = [
        el('td', { class: 'mono' }, [dayList(window.days)]),
        el('td', { class: 'mono' }, [window.start]),
        el('td', { class: 'mono' }, [window.end]),
        el('td', {}, [window.label]),
      ];
      if (mayEdit) {
        const remove = el(
          'button',
          { type: 'button', class: 'btn btn--quiet', 'aria-label': `Delete window ${window.label}` },
          ['Delete'],
        );
        remove.addEventListener('click', () => {
          if (remove.disabled) return;
          remove.disabled = true;
          clearProblem();
          announce(copy.removingWindow);
          void send(
            `/api/projects/${slug}/clusters/${encodeURIComponent(cluster.name)}/windows/${window.id}`,
            'DELETE',
          )
            .then(() => {
              announce(copy.windowRemoved, true);
              return refresh();
            })
            .catch((cause: unknown) => {
              announce('');
              problem(failureMessage(cause));
            })
            .finally(() => {
              remove.disabled = false;
            });
        });
        cells.push(el('td', {}, [remove]));
      }
      return el('tr', {}, cells);
    });

    const headers = [
      el('th', {}, ['Days']),
      el('th', {}, ['Opens']),
      el('th', {}, ['Closes']),
      el('th', {}, ['Label']),
    ];
    if (mayEdit) headers.push(el('th', {}, ['Remove']));

    return el('table', { 'aria-label': `Sync windows ${cluster.name}` }, [
      el('thead', {}, [el('tr', {}, headers)]),
      el(
        'tbody',
        {},
        rows.length > 0
          ? rows
          : [el('tr', {}, [el('td', { colspan: String(headers.length) }, ['No windows.'])])],
      ),
    ]);
  }

  function addWindowDialog(cluster: ClusterView, opener: HTMLElement): void {
    const boxes = WEEK_DAYS.map((day) => {
      const input = el('input', { type: 'checkbox', 'aria-label': DAY_LABELS[day], value: day });
      return { day, input, node: el('label', { class: 'check' }, [input, DAY_LABELS[day]]) };
    });
    const opens = labelledField({ label: 'Opens', value: '09:00' });
    const closes = labelledField({ label: 'Closes', value: '17:00' });
    const label = labelledField({ label: 'Label' });
    const confirm = el('button', { type: 'button', class: 'btn btn--primary' }, ['Save window']);
    const cancel = el('button', { type: 'button', class: 'btn btn--quiet' }, ['Cancel']);
    const dialog = openDialog({
      label: `Add window to ${cluster.name}`,
      heading: `Add window to ${cluster.name}`,
      opener,
      content: [
        el('div', { class: 'field' }, [
          el('label', {}, ['Days']),
          el('div', { class: 'freeze-row__stages' }, boxes.map((box) => box.node)),
        ]),
        opens.wrapper,
        closes.wrapper,
        label.wrapper,
      ],
      actions: [cancel, confirm],
    });
    cancel.addEventListener('click', () => dialog.close());

    confirm.addEventListener('click', () => {
      if (confirm.disabled) return;
      confirm.disabled = true;
      opens.setError(null);
      closes.setError(null);
      label.setError(null);
      dialog.clearError();
      clearProblem();
      announce(copy.savingWindow);
      void send<SyncWindow>(
        `/api/projects/${slug}/clusters/${encodeURIComponent(cluster.name)}/windows`,
        'POST',
        {
          label: label.input.value,
          days: boxes.filter((box) => (box.input as HTMLInputElement).checked).map((box) => box.day),
          start: opens.input.value,
          end: closes.input.value,
        },
      )
        .then(async () => {
          const result = await get<{ openings: WindowOpening[] }>(
            `/api/projects/${slug}/clusters/${encodeURIComponent(cluster.name)}/window-openings?count=1`,
          );
          const first = result.openings[0];
          dialog.close();
          announce(
            first
              ? copy.windowAdded(`${first.local_opens} ${cluster.time_zone}`)
              : copy.windowAddedNoOpenings,
            true,
          );
          await refresh();
        })
        .catch((cause: unknown) => {
          announce('');
          const message = failureMessage(cause);
          dialog.showError(message);
          problem(message);
          const fields = fieldErrors(cause);
          if (fields.start) opens.setError(fields.start);
          if (fields.end) closes.setError(fields.end);
          if (fields.label) label.setError(fields.label);
        })
        .finally(() => {
          confirm.disabled = false;
        });
    });
  }

  function clusterPanel(cluster: ClusterView, openings: WindowOpening[]): HTMLElement {
    const clock = el('span', { class: 'mono' }, [
      `Cluster time ${localStamp(new Date(), cluster.time_zone)} ${cluster.time_zone}`,
    ]);
    clockSlots.push({ node: clock, timeZone: cluster.time_zone });

    const add = el('button', { type: 'button', class: 'btn' }, ['Add window']);
    add.addEventListener('click', () => addWindowDialog(cluster, add));

    return el('section', { class: 'panel', 'aria-label': `Cluster ${cluster.name}` }, [
      el('h2', {}, [cluster.name]),
      el('p', { class: 'panel__meta' }, [`${cluster.time_zone} · `, clock]),
      windowTable(cluster),
      el('h3', {}, ['Next openings']),
      el(
        'ul',
        { class: 'openings', 'aria-label': `Next openings ${cluster.name}` },
        openings.length > 0
          ? openings.map((opening) =>
              el('li', {}, [
                `${opening.local_opens} ${cluster.time_zone} — ${opening.local_closes} · ${opening.label}`,
              ]),
            )
          : [el('li', {}, ['No openings scheduled.'])],
      ),
      mayEdit ? add : null,
    ]);
  }

  function checkInstantForm(clusters: ClusterView[]): HTMLElement {
    const stageSelect = el('select', { id: 'check-stage', 'aria-label': 'Stage' });
    append(
      stageSelect,
      graph.nodes.map((node) => el('option', { value: node.stage }, [`${node.stage} · ${node.time_zone}`])),
    );
    const localTime = labelledField({ label: 'Cluster local time', value: localStamp(new Date(), graph.nodes[0]?.time_zone ?? 'UTC') });
    const check = el('button', { type: 'submit', class: 'btn btn--primary' }, ['Check']);
    const result = el('p', {
      class: 'mono',
      role: 'status',
      'aria-live': 'polite',
      'aria-label': 'Window decision',
    });

    const form = el('form', { class: 'inline-form', 'aria-label': 'Check an instant' }, [
      el('div', { class: 'field' }, [el('label', { for: 'check-stage' }, ['Stage']), stageSelect]),
      localTime.wrapper,
      check,
    ]);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const stage = graph.nodes.find((node) => node.stage === stageSelect.value);
      if (!stage) return;
      const parsed = parseLocalStamp(localTime.input.value);
      if (!parsed) {
        localTime.setError('Use the form 2026-10-27 09:00.');
        return;
      }
      localTime.setError(null);
      clearProblem();
      announce(copy.checkingInstant);
      // The typed wall-clock time belongs to the cluster's zone, never the browser's.
      const instant = instantFromZonedLocal(parsed, stage.time_zone);
      void get<WindowDecision>(
        `/api/projects/${slug}/stages/${encodeURIComponent(stage.stage)}/window-decision?at=${encodeURIComponent(instant.toISOString())}`,
      )
        .then((decision) => {
          announce('');
          result.textContent = decisionSummary(decision);
        })
        .catch((cause: unknown) => {
          announce('');
          problem(failureMessage(cause));
        });
    });

    return el('section', { class: 'panel' }, [
      el('h2', {}, ['Check an instant']),
      el('p', { class: 'panel__meta' }, [
        `Times are read on the chosen stage's cluster clock. Clusters: ${clusters.map((cluster) => `${cluster.name} (${cluster.time_zone})`).join(', ')}`,
      ]),
      form,
      result,
    ]);
  }

  function freezeVersionDialog(policy: FreezePolicyResponse, opener: HTMLElement): void {
    const effective = labelledField({
      label: 'Effective from (UTC)',
      value: localStamp(new Date(Date.now() + 3_600_000), 'UTC'),
      hint: 'YYYY-MM-DD HH:mm in UTC',
    });
    const rows = el('div', {});
    const freezeRows: {
      name: ReturnType<typeof labelledField>;
      starts: ReturnType<typeof labelledField>;
      ends: ReturnType<typeof labelledField>;
      stages: { stage: string; input: HTMLInputElement }[];
    }[] = [];

    function addFreezeRow(): void {
      const name = labelledField({ label: 'Freeze name' });
      const starts = labelledField({ label: 'Starts (UTC)', hint: 'YYYY-MM-DD HH:mm' });
      const ends = labelledField({ label: 'Ends (UTC)', hint: 'YYYY-MM-DD HH:mm' });
      const stages = graph.nodes.map((node) => {
        const input = el('input', { type: 'checkbox', 'aria-label': node.stage, value: node.stage });
        return { stage: node.stage, input: input as HTMLInputElement, node };
      });
      freezeRows.push({ name, starts, ends, stages });
      rows.append(
        el('div', { class: 'freeze-row' }, [
          name.wrapper,
          starts.wrapper,
          ends.wrapper,
          el(
            'div',
            { class: 'freeze-row__stages' },
            stages.map((entry) => el('label', { class: 'check' }, [entry.input, entry.stage])),
          ),
        ]),
      );
    }
    addFreezeRow();

    const addFreeze = el('button', { type: 'button', class: 'btn' }, ['Add freeze']);
    addFreeze.addEventListener('click', () => addFreezeRow());
    const confirm = el('button', { type: 'button', class: 'btn btn--primary' }, ['Schedule version']);
    const cancel = el('button', { type: 'button', class: 'btn btn--quiet' }, ['Cancel']);
    const dialog = openDialog({
      label: 'New freeze policy version',
      heading: 'New freeze policy version',
      opener,
      content: [
        el('p', { class: 'evidence__caption' }, [
          `Based on version ${policy.in_force_version === 0 ? 1 : Math.max(...policy.versions.map((version) => version.version))}.`,
        ]),
        effective.wrapper,
        rows,
        addFreeze,
      ],
      actions: [cancel, confirm],
    });
    cancel.addEventListener('click', () => dialog.close());

    let key: string | null = null;
    confirm.addEventListener('click', () => {
      if (confirm.disabled) return;
      const basedOn = Math.max(...policy.versions.map((version) => version.version));
      const effectiveParsed = parseLocalStamp(effective.input.value);
      if (!effectiveParsed) {
        effective.setError('Use the form 2026-11-27 00:00.');
        return;
      }
      effective.setError(null);
      const freezes: Freeze[] = [];
      for (const row of freezeRows) {
        const starts = parseLocalStamp(row.starts.input.value);
        const ends = parseLocalStamp(row.ends.input.value);
        if (!row.name.input.value.trim()) continue;
        if (!starts || !ends) {
          row.starts.setError('Use the form 2026-11-27 00:00.');
          return;
        }
        freezes.push({
          name: row.name.input.value.trim(),
          stages: row.stages.filter((entry) => entry.input.checked).map((entry) => entry.stage),
          starts_at: instantFromZonedLocal(starts, 'UTC').toISOString(),
          ends_at: instantFromZonedLocal(ends, 'UTC').toISOString(),
        });
      }

      key = key ?? newRequestKey();
      confirm.disabled = true;
      dialog.clearError();
      clearProblem();
      announce(copy.scheduling);
      void send<FreezePolicyVersion>(`/api/projects/${slug}/freeze-policy/versions`, 'POST', {
        based_on_version: basedOn,
        effective_from: instantFromZonedLocal(effectiveParsed, 'UTC').toISOString(),
        freezes,
      })
        .then(async (created) => {
          key = null;
          dialog.close();
          announce(
            copy.versionScheduled(created.version, clusterTime(created.effective_from, 'UTC')),
            true,
          );
          await refresh();
        })
        .catch((cause: unknown) => {
          key = null;
          announce('');
          const message = failureMessage(cause, (failure) =>
            failure.code === 'stale_version' && failure.current_version !== undefined
              ? copy.staleBase(failure.current_version)
              : null,
          );
          dialog.showError(message);
          problem(message);
          const effectiveError = fieldErrors(cause).effective_from;
          if (effectiveError) effective.setError(effectiveError);
        })
        .finally(() => {
          confirm.disabled = false;
        });
    });
  }

  function freezePanel(policy: FreezePolicyResponse): HTMLElement {
    const newVersion = el('button', { type: 'button', class: 'btn' }, ['New freeze version']);
    newVersion.addEventListener('click', () => freezeVersionDialog(policy, newVersion));

    return el('section', { class: 'panel', 'aria-label': 'Freeze policy' }, [
      el('h2', {}, ['Freeze policy']),
      el(
        'ul',
        { class: 'policy-list', 'aria-label': 'Freeze policy versions' },
        policy.versions
          .slice()
          .sort((left, right) => right.version - left.version)
          .map((version) =>
            el('li', { 'data-in-force': version.version === policy.in_force_version ? 'true' : 'false' }, [
              el('strong', {}, [
                `Version ${version.version}`,
                version.version === policy.in_force_version ? ' — in force now' : '',
              ]),
              el('div', { class: 'mono' }, [
                `effective ${clusterTime(version.effective_from, 'UTC')} · ${version.created_by}`,
              ]),
              el(
                'div',
                {},
                version.freezes.length === 0
                  ? ['No freezes.']
                  : version.freezes.map((freeze) =>
                      el('div', { class: 'mono' }, [
                        `${freeze.name}: ${freeze.stages.join(', ')} · ${clusterTime(freeze.starts_at, 'UTC')} → ${clusterTime(freeze.ends_at, 'UTC')}`,
                      ]),
                    ),
              ),
            ]),
          ),
      ),
      mayPerform(graph.role, 'schedule_freeze_version') ? newVersion : null,
    ]);
  }

  function paint(
    clusters: ClusterView[],
    openings: Map<string, WindowOpening[]>,
    policy: FreezePolicyResponse,
  ): void {
    clockSlots.length = 0;
    clear(body);
    append(body, [
      el('h1', {}, ['Windows and freezes']),
      ...clusters.map((cluster) => clusterPanel(cluster, openings.get(cluster.name) ?? [])),
      checkInstantForm(clusters),
      freezePanel(policy),
    ]);
  }

  await refresh();
  window.setInterval(() => {
    for (const slot of clockSlots) {
      slot.node.textContent = `Cluster time ${localStamp(new Date(), slot.timeZone)} ${slot.timeZone}`;
    }
  }, CLOCK_MS);

  for (const link of body.querySelectorAll('a')) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      navigate(link.getAttribute('href') ?? '/');
    });
  }
}
