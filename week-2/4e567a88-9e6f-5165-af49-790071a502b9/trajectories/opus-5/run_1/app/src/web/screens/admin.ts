import { ApiFailure, MeterView, PolicyView, api } from '../api';
import { clear, el, num } from '../dom';
import { Ribbon } from '../meter';
import { Shell, alertError, clearMessages, notice } from '../shell';
import { noteZoneFromPeriod, state } from '../state';

const TIME_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
];

const TEAM_OPTIONS: [string, string][] = [
  ['allowed', 'Allowed'],
  ['blocked', 'Blocked'],
  ['inherit', 'Inherit'],
];

const ORG_OPTIONS: [string, string][] = [
  ['allowed', 'Allowed'],
  ['blocked', 'Blocked'],
];

function select(label: string, options: [string, string][], value: string, disabled: boolean): HTMLSelectElement {
  const node = el('select', { class: 'control', 'aria-label': label, disabled });
  for (const [optionValue, optionLabel] of options) {
    node.append(el('option', { value: optionValue, text: optionLabel }));
  }
  node.value = value;
  return node;
}

export function mountAdmin(shell: Shell): () => void {
  const readOnly = state.member!.role !== 'admin';
  const ribbon = new Ribbon();
  const formHolder = el('div', { class: 'policy-holder' });
  const versionsHolder = el('div', { class: 'versions-holder' });
  const timers: number[] = [];

  function renderPolicy(policy: PolicyView): void {
    clear(formHolder);
    const form = el('form', { class: 'policy-form', 'aria-label': 'Org policy' });
    const zoneSelect = select(
      'Time zone',
      TIME_ZONES.map((zone) => [zone, zone] as [string, string]),
      policy.timezone,
      readOnly,
    );
    const retentionSelect = select(
      'Retention',
      [
        ['7', '7 days'],
        ['30', '30 days'],
        ['90', '90 days'],
      ],
      String(policy.retention_days),
      readOnly,
    );
    form.append(
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Time zone' }), zoneSelect]),
        el('div', { class: 'field' }, [el('label', { class: 'field-label', text: 'Retention' }), retentionSelect]),
      ]),
    );

    interface TeamControls {
      id: string;
      concurrency: HTMLInputElement;
      visibility: HTMLSelectElement;
      soft: HTMLInputElement;
      hard: HTMLInputElement;
      defaults: { api: HTMLSelectElement; playground: HTMLSelectElement };
      access: Record<string, { api: HTMLSelectElement; playground: HTMLSelectElement }>;
    }

    const teamControls: TeamControls[] = [];
    for (const team of policy.teams) {
      const concurrency = el('input', {
        type: 'number',
        class: 'control',
        'aria-label': 'Concurrency',
        min: '1',
        max: '20',
        value: String(team.concurrency),
        disabled: readOnly,
      });
      const visibility = select(
        'Payload visibility',
        [
          ['team', 'Team'],
          ['restricted', 'Restricted'],
        ],
        team.payload_visibility,
        readOnly,
      );
      const soft = el('input', {
        type: 'number',
        class: 'control',
        'aria-label': 'Soft cap (credits)',
        min: '0',
        max: '10000000',
        value: String(team.soft_cap_credits),
        disabled: readOnly,
      });
      const hard = el('input', {
        type: 'number',
        class: 'control',
        'aria-label': 'Hard cap (credits)',
        min: '0',
        max: '10000000',
        value: String(team.hard_cap_credits),
        disabled: readOnly,
      });
      const defaultApi = select('Default for API', TEAM_OPTIONS, team.context_defaults.api, readOnly);
      const defaultPlayground = select(
        'Default for playground',
        TEAM_OPTIONS,
        team.context_defaults.playground,
        readOnly,
      );
      const access: TeamControls['access'] = {};
      const modelRows: Node[] = [];
      for (const model of state.models) {
        const entry = team.model_access[model.slug] ?? { api: 'inherit', playground: 'inherit' };
        const apiSelect = select(`${model.name} API`, TEAM_OPTIONS, entry.api, readOnly);
        const playgroundSelect = select(`${model.name} playground`, TEAM_OPTIONS, entry.playground, readOnly);
        access[model.slug] = { api: apiSelect, playground: playgroundSelect };
        modelRows.push(
          el('div', { class: 'field-row' }, [
            el('div', { class: 'field' }, [
              el('label', { class: 'field-label', text: `${model.name} API` }),
              apiSelect,
            ]),
            el('div', { class: 'field' }, [
              el('label', { class: 'field-label', text: `${model.name} playground` }),
              playgroundSelect,
            ]),
          ]),
        );
      }
      form.append(
        el('fieldset', { class: 'team-group', role: 'group', 'aria-label': team.name }, [
          el('legend', { text: team.name }),
          el('div', { class: 'field-row' }, [
            el('div', { class: 'field' }, [
              el('label', { class: 'field-label', text: 'Concurrency' }),
              concurrency,
            ]),
            el('div', { class: 'field' }, [
              el('label', { class: 'field-label', text: 'Payload visibility' }),
              visibility,
            ]),
            el('div', { class: 'field' }, [
              el('label', { class: 'field-label', text: 'Soft cap (credits)' }),
              soft,
            ]),
            el('div', { class: 'field' }, [
              el('label', { class: 'field-label', text: 'Hard cap (credits)' }),
              hard,
            ]),
          ]),
          el('div', { class: 'field-row' }, [
            el('div', { class: 'field' }, [
              el('label', { class: 'field-label', text: 'Default for API' }),
              defaultApi,
            ]),
            el('div', { class: 'field' }, [
              el('label', { class: 'field-label', text: 'Default for playground' }),
              defaultPlayground,
            ]),
          ]),
          ...modelRows,
        ]),
      );
      teamControls.push({
        id: team.id,
        concurrency,
        visibility,
        soft,
        hard,
        defaults: { api: defaultApi, playground: defaultPlayground },
        access,
      });
    }

    const orgAccess: Record<string, { api: HTMLSelectElement; playground: HTMLSelectElement }> = {};
    const orgRows: Node[] = [];
    for (const model of state.models) {
      const entry = policy.org_model_access[model.slug] ?? { api: 'allowed', playground: 'allowed' };
      const apiSelect = select(`${model.name} API`, ORG_OPTIONS, entry.api, readOnly);
      const playgroundSelect = select(`${model.name} playground`, ORG_OPTIONS, entry.playground, readOnly);
      orgAccess[model.slug] = { api: apiSelect, playground: playgroundSelect };
      orgRows.push(
        el('div', { class: 'field-row' }, [
          el('div', { class: 'field' }, [el('label', { class: 'field-label', text: `${model.name} API` }), apiSelect]),
          el('div', { class: 'field' }, [
            el('label', { class: 'field-label', text: `${model.name} playground` }),
            playgroundSelect,
          ]),
        ]),
      );
    }
    form.append(
      el('fieldset', { class: 'team-group', role: 'group', 'aria-label': 'Org model access' }, [
        el('legend', { text: 'Org model access' }),
        ...orgRows,
      ]),
    );

    const saveButton = el('button', { type: 'submit', class: 'primary', text: 'Save policy', disabled: readOnly });
    form.append(el('div', { class: 'form-actions' }, [saveButton]));

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearMessages();
      saveButton.disabled = true;
      saveButton.textContent = 'Saving…';
      const document_ = {
        version: policy.version,
        timezone: zoneSelect.value,
        retention_days: Number.parseInt(retentionSelect.value, 10),
        org_model_access: Object.fromEntries(
          Object.entries(orgAccess).map(([slug, controls]) => [
            slug,
            { api: controls.api.value, playground: controls.playground.value },
          ]),
        ),
        teams: teamControls.map((controls) => ({
          id: controls.id,
          name: state.teams.find((team) => team.id === controls.id)?.name ?? '',
          concurrency: Number.parseInt(controls.concurrency.value, 10),
          payload_visibility: controls.visibility.value,
          soft_cap_credits: Number.parseInt(controls.soft.value, 10),
          hard_cap_credits: Number.parseInt(controls.hard.value, 10),
          context_defaults: {
            api: controls.defaults.api.value,
            playground: controls.defaults.playground.value,
          },
          model_access: Object.fromEntries(
            Object.entries(controls.access).map(([slug, entry]) => [
              slug,
              { api: entry.api.value, playground: entry.playground.value },
            ]),
          ),
        })),
      };
      void api
        .put<{ policy: PolicyView }>('/api/policy', document_)
        .then((response) => {
          state.policy = response.policy;
          notice(`Policy saved as version ${response.policy.version}.`);
          renderPolicy(response.policy);
          void loadVersions();
        })
        .catch((error: unknown) => {
          if (!(error instanceof ApiFailure)) throw error;
          if (error.status === 412) {
            alertError(
              `Someone saved a newer policy (version ${error.detail.current_version ?? 0}). Reload to see it before saving again.`,
            );
          } else if (error.status === 422) {
            alertError(Object.values(error.fields)[0] ?? error.message);
          } else alertError(error.message);
        })
        .finally(() => {
          saveButton.disabled = readOnly;
          saveButton.textContent = 'Save policy';
        });
    });

    formHolder.append(form);
  }

  async function loadVersions(): Promise<void> {
    const response = await api.get<{ versions: { version: number; saved_by: { id: string; name: string }; saved_at: string }[] }>(
      '/api/policy/versions',
    );
    clear(versionsHolder);
    const list = el('ul', { class: 'versions', role: 'list', 'aria-label': 'Policy versions' });
    for (const version of response.versions) {
      list.append(
        el('li', {}, [
          num(`Version ${version.version}`),
          el('span', { text: ` · ${version.saved_by.name} · ` }),
          num(version.saved_at.replace('T', ' ').slice(0, 16)),
        ]),
      );
    }
    versionsHolder.append(el('h3', { class: 'section-heading', text: 'Policy versions' }), list);
  }

  async function loadMeter(): Promise<void> {
    const meter = await api.get<MeterView>(`/api/teams/${state.selectedTeamId}/meter`);
    noteZoneFromPeriod(meter.period.label, meter.period.starts_at);
    ribbon.update(meter, new Map());
  }

  async function load(): Promise<void> {
    const response = await api.get<{ policy: PolicyView }>('/api/policy');
    state.policy = response.policy;
    renderPolicy(response.policy);
    await Promise.all([loadVersions(), loadMeter()]);
  }

  shell.main.append(
    el('h1', { class: 'screen-title', text: 'Admin' }),
    ribbon.root,
    formHolder,
    versionsHolder,
  );
  void load();
  timers.push(window.setInterval(() => void loadMeter(), 3000));
  return () => {
    for (const timer of timers) window.clearInterval(timer);
  };
}
