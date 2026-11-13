import { api, guard } from './api';
import { clear, el, formatServerTime, play, svgEl } from './dom';
import { connect, onLive } from './livesocket';
import type { ViewContext } from './main';
import { navigate } from './main';
import { announce, state } from './state';
import { emptyState } from './views_repo';

type Job = {
  id: number;
  name: string;
  stage: string;
  status: string;
  attempt: number;
  retried: boolean;
  layer: number;
  row: number;
  x: number;
  y: number;
  needs: string[];
  duration: string;
  start_at: string | null;
};

type Pipeline = {
  id: number;
  ref: string;
  sha: string;
  status: string;
  errors: string[];
  stages: { name: string; status: string }[];
  jobs: Job[];
};

export async function renderPipelines(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const result = await guard(() =>
    api.get<{ pipelines: { id: number; ref: string; status: string; sha: string }[] }>(
      `/api/projects/${projectId}/pipelines`,
    ),
  );
  ctx.main.append(el('h1', { text: 'Pipelines' }));
  if ((result?.pipelines ?? []).length === 0) {
    ctx.main.append(
      emptyState('// PIPELINES', 'No pipelines yet', 'Edit pipeline config', `/projects/${projectId}/-/ci/editor`),
    );
    return;
  }
  const list = el('ul', { role: 'list', class: 'rows dark mono' });
  for (const pipeline of result?.pipelines ?? []) {
    list.append(
      el('li', {}, [
        el('a', { href: `/projects/${projectId}/-/pipelines/${pipeline.id}`, text: `#${pipeline.id}` }),
        el('span', { text: ` ${pipeline.ref} ${pipeline.status}` }),
      ]),
    );
  }
  ctx.main.append(list);
}

export async function renderPipeline(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const pipelineId = Number(ctx.params.pipeline);
  connect(projectId);
  const host = el('div');
  ctx.main.append(host);
  const previous = new Map<number, string>();
  const reload = async (): Promise<void> => {
    const pipeline = await guard(() => api.get<Pipeline>(`/api/pipelines/${pipelineId}`));
    if (pipeline === null) return;
    clear(host);
    host.append(
      el('h1', { text: `Pipeline ${pipeline.id}` }),
      el('p', { class: 'mono', text: `[ ${pipeline.ref} ] ${pipeline.sha.slice(0, 7)} ${pipeline.status}` }),
    );
    for (const message of pipeline.errors) {
      host.append(el('p', { class: 'strip-error', text: message }));
    }
    const stages = el('ul', { role: 'list', 'aria-label': 'Stages', class: 'stages dark' });
    pipeline.stages.forEach((stage, index) => {
      stages.append(
        el('li', {
          role: 'listitem',
          'aria-label': `Stage ${index + 1} ${stage.name}, ${stage.status}`,
          class: 'stage-card',
        }, [
          el('p', { class: 'mono index', text: String(index + 1).padStart(2, '0') }),
          el('p', { class: 'name', text: stage.name }),
          el('p', { class: 'status', text: stage.status }),
        ]),
      );
    });
    host.append(stages);

    const graph = el('div', { role: 'group', 'aria-label': 'Pipeline graph', class: 'graph dark' });
    const width = Math.max(...pipeline.jobs.map((job) => job.x + 240), 400);
    const height = Math.max(...pipeline.jobs.map((job) => job.y + 120), 200);
    const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}` });
    const positions = new Map(pipeline.jobs.map((job) => [job.name, job]));
    for (const job of pipeline.jobs) {
      for (const need of job.needs) {
        const source = positions.get(need);
        if (source === undefined) continue;
        svg.append(
          svgEl('path', {
            'data-from': need,
            'data-to': job.name,
            fill: 'none',
            stroke: '#4b8f8c',
            d: `M ${source.x + 200} ${source.y + 32} C ${source.x + 220} ${source.y + 32} ${job.x - 20} ${job.y + 32} ${job.x} ${job.y + 32}`,
          }),
        );
      }
    }
    graph.append(svg);
    for (const job of pipeline.jobs) {
      const node = el('button', {
        type: 'button',
        'aria-label': `Job ${job.name}, stage ${job.stage}, ${job.status}, needs ${
          job.needs.length === 0 ? 'nothing' : job.needs.join(' and ')
        }`,
        class: 'graph-node',
        'data-job': job.name,
        'data-status': job.status,
        'data-x': String(job.x),
        'data-y': String(job.y),
        'data-layer': String(job.layer),
        'data-row': String(job.row),
        'data-retried': job.retried ? 'true' : 'false',
        style: `left:${job.x}px; top:${job.y}px; width:200px; height:64px;`,
      }, [job.name]);
      if (previous.get(job.id) !== undefined && previous.get(job.id) !== job.status) play(node, 'job-status');
      node.addEventListener('keydown', (event) => {
        const keys = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Enter'];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Enter') {
          navigate(`/projects/${projectId}/-/jobs/${job.id}`);
          return;
        }
        let target: Job | undefined;
        if (event.key === 'ArrowRight') {
          target = pipeline.jobs
            .filter((candidate) => candidate.needs.includes(job.name))
            .sort((a, b) => a.row - b.row)[0];
        } else if (event.key === 'ArrowLeft') {
          target = job.needs.map((need) => positions.get(need)).find((candidate) => candidate !== undefined);
        } else {
          const sameLayer = pipeline.jobs.filter((candidate) => candidate.layer === job.layer).sort((a, b) => a.row - b.row);
          const index = sameLayer.findIndex((candidate) => candidate.id === job.id);
          target = sameLayer[event.key === 'ArrowDown' ? index + 1 : index - 1];
        }
        if (target === undefined) return;
        const next = graph.querySelector<HTMLElement>(`[data-job="${target.name}"]`);
        if (next !== null) next.focus();
      });
      node.addEventListener('click', () => navigate(`/projects/${projectId}/-/jobs/${job.id}`));
      graph.append(node);
    }
    host.append(graph);

    const jobs = el('ul', { role: 'list', 'aria-label': 'Jobs', class: 'rows dark mono' });
    for (const job of pipeline.jobs) {
      const row = el('li', {
        role: 'listitem',
        'aria-label': `Job ${job.name}, stage ${job.stage}, ${job.status}, ${job.duration}`,
        'data-retried': job.retried ? 'true' : 'false',
      }, [
        el('a', { href: `/projects/${projectId}/-/jobs/${job.id}`, text: job.name }),
        el('span', { text: ` ${job.status} ${job.duration}` }),
        job.start_at === null
          ? null
          : el('span', { text: ` Starts at ${formatServerTime(job.start_at, state.me?.time_zone ?? 'UTC')}` }),
      ]);
      if (previous.get(job.id) !== undefined && previous.get(job.id) !== job.status) play(row, 'job-status');
      for (const [label, path] of [
        [`Play ${job.name}`, 'play'],
        ['Retry job', 'retry'],
        ['Cancel job', 'cancel'],
      ] as const) {
        const control = el('button', { type: 'button', 'aria-label': label }, [label]);
        control.addEventListener('click', () => {
          void (async () => {
            await guard(() => api.post(`/api/jobs/${job.id}/${path}`, {}, control as HTMLButtonElement));
            await reload();
          })();
        });
        row.append(control);
      }
      jobs.append(row);
    }
    host.append(jobs);
    for (const job of pipeline.jobs) previous.set(job.id, job.status);

    for (const [label, path] of [
      ['Retry pipeline', 'retry'],
      ['Cancel pipeline', 'cancel'],
    ] as const) {
      const control = el('button', { type: 'button', 'aria-label': label }, [label]);
      control.addEventListener('click', () => {
        void (async () => {
          await guard(() => api.post(`/api/pipelines/${pipelineId}/${path}`, {}, control as HTMLButtonElement));
          await reload();
        })();
      });
      host.append(control);
    }
  };
  await reload();
  onLive((message) => {
    const data = message.data as { announcement?: string };
    if (typeof data.announcement === 'string') announce(data.announcement);
    if (['pipeline', 'job'].includes(message.type)) void reload();
  });
}

export async function renderJob(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const jobId = Number(ctx.params.job);
  connect(projectId);
  const host = el('div');
  ctx.main.append(host);
  const reload = async (): Promise<void> => {
    const job = await guard(() =>
      api.get<{
        id: number;
        name: string;
        stage: string;
        status: string;
        failure_reason: string | null;
        artifacts: { path: string; expired: boolean }[];
        waiting: { deployment: number; given: number; required: number } | null;
      }>(`/api/jobs/${jobId}`),
    );
    if (job === null) return;
    const log = await guard(() => api.get<{ lines: string[] }>(`/api/jobs/${jobId}/log`));
    clear(host);
    host.append(
      el('div', { class: 'file-header strip-surface' }, [
        el('h1', { text: job.name }),
        el('p', { class: 'mono', text: `${job.stage} · ${job.status}` }),
      ]),
    );
    if (job.failure_reason !== null) {
      host.append(el('p', { class: 'strip-error', text: job.failure_reason }));
    }
    if (job.waiting !== null) {
      host.append(el('p', { text: `Waiting for approval: ${job.waiting.given} of ${job.waiting.required}` }));
    }
    const logNode = el('div', { role: 'log', 'aria-label': 'Job log', class: 'log dark mono', tabindex: '0' });
    for (const line of log?.lines ?? []) {
      logNode.append(el('p', { class: 'log-line', text: line }));
      const section = /^(\d+) sys section_start (\S+)$/.exec(line);
      if (section !== null) {
        logNode.append(
          el('button', { type: 'button', 'aria-label': `Toggle section ${section[2]}` }, [`Toggle section ${section[2]}`]),
        );
      }
    }
    host.append(logNode);
    for (const artifact of job.artifacts) {
      if (artifact.expired) continue;
      host.append(
        el('a', {
          href: `/api/jobs/${jobId}/artifacts/${artifact.path}`,
          'aria-label': `Download ${artifact.path}`,
          text: `Download ${artifact.path}`,
        }),
      );
    }
    const keep = el('button', { type: 'button', 'aria-label': 'Keep artifacts' }, ['Keep artifacts']);
    keep.addEventListener('click', () => {
      void (async () => {
        await guard(() => api.post(`/api/jobs/${jobId}/artifacts/keep`, {}, keep as HTMLButtonElement));
        await reload();
      })();
    });
    host.append(keep);
  };
  await reload();
  onLive((message) => {
    const data = message.data as { announcement?: string };
    if (typeof data.announcement === 'string') announce(data.announcement);
    if (['job', 'job_log', 'pipeline', 'deployment'].includes(message.type)) void reload();
  });
}

type Environment = {
  id: number;
  name: string;
  tier: string;
  state: string;
  auto_stop_at: string | null;
  deployments: {
    id: number;
    number: number;
    status: string;
    required: number;
    given: number;
    has_artifacts: boolean;
    approvals: { user: string; status: string; expired: boolean }[];
  }[];
};

export async function renderEnvironments(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  connect(projectId);
  const host = el('div');
  ctx.main.append(host);
  const reload = async (): Promise<void> => {
    const result = await guard(() =>
      api.get<{ environments: Environment[] }>(`/api/projects/${projectId}/environments`),
    );
    clear(host);
    host.append(el('h1', { text: 'Environments' }));
    if ((result?.environments ?? []).length === 0) {
      host.append(
        emptyState('// ENVIRONMENTS', 'No environments yet', 'Edit pipeline config', `/projects/${projectId}/-/ci/editor`),
      );
      return;
    }
    const list = el('ul', { role: 'list', 'aria-label': 'Environments', class: 'rows dark' });
    for (const environment of result?.environments ?? []) {
      const latest = environment.deployments[environment.deployments.length - 1];
      list.append(
        el('li', {
          role: 'listitem',
          'aria-label': `Environment ${environment.name}, ${environment.state}, deployment ${latest?.number ?? 0}`,
        }, [
          el('a', { href: `/projects/${projectId}/-/environments/${environment.id}`, text: environment.name }),
          el('span', { text: ` ${environment.state}` }),
          environment.auto_stop_at === null
            ? null
            : el('span', { text: ` Auto-stops at ${formatServerTime(environment.auto_stop_at, state.me?.time_zone ?? 'UTC')}` }),
        ]),
      );
    }
    host.append(list);
  };
  await reload();
  onLive((message) => {
    if (['environment', 'deployment'].includes(message.type)) void reload();
  });
}

export async function renderEnvironment(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const envId = Number(ctx.params.env);
  connect(projectId);
  const host = el('div');
  ctx.main.append(host);
  const reload = async (): Promise<void> => {
    const environment = await guard(() =>
      api.get<Environment>(`/api/projects/${projectId}/environments/${envId}`),
    );
    if (environment === null) return;
    clear(host);
    host.append(
      el('h1', { text: environment.name }),
      el('p', { text: environment.state }),
      environment.auto_stop_at === null
        ? el('p', { text: 'No auto-stop' })
        : el('p', { text: `Auto-stops at ${formatServerTime(environment.auto_stop_at, state.me?.time_zone ?? 'UTC')}` }),
    );
    for (const [label, path] of [
      ['Stop environment', 'stop'],
      ['Keep environment', 'keep'],
    ] as const) {
      const control = el('button', { type: 'button', 'aria-label': label }, [label]);
      control.addEventListener('click', () => {
        void (async () => {
          await guard(() => api.post(`/api/environments/${envId}/${path}`, {}, control as HTMLButtonElement));
          await reload();
        })();
      });
      host.append(control);
    }
    for (const deployment of environment.deployments) {
      const block = el('section', { class: 'card' }, [
        el('h2', { text: `Deployment ${deployment.number}` }),
        el('p', { text: deployment.status }),
      ]);
      if (deployment.status === 'awaiting_approval') {
        block.append(el('p', { text: `Waiting for approval: ${deployment.given} of ${deployment.required}` }));
        for (const [label, status] of [
          ['Approve deployment', 'approved'],
          ['Reject deployment', 'rejected'],
        ] as const) {
          const control = el('button', { type: 'button', 'aria-label': label }, [label]);
          control.addEventListener('click', () => {
            void (async () => {
              const result = await guard(() =>
                api.post<{ announcement: string }>(
                  `/api/projects/${projectId}/deployments/${deployment.id}/approvals`,
                  { status },
                  control as HTMLButtonElement,
                ),
              );
              if (result !== null) announce(result.announcement);
              await reload();
            })();
          });
          block.append(control);
        }
      }
      for (const approval of deployment.approvals) {
        block.append(
          el('p', { text: approval.expired ? 'This approval expired.' : `${approval.user} ${approval.status}` }),
        );
      }
      if (deployment.has_artifacts) {
        const rollback = el('button', { type: 'button', 'aria-label': `Roll back to deployment ${deployment.number}` }, [
          `Roll back to deployment ${deployment.number}`,
        ]);
        rollback.addEventListener('click', () => {
          void (async () => {
            await guard(() =>
              api.post(
                `/api/environments/${envId}/rollback`,
                { deployment: deployment.number },
                rollback as HTMLButtonElement,
              ),
            );
            await reload();
          })();
        });
        block.append(rollback);
      }
      host.append(block);
    }
  };
  await reload();
  onLive((message) => {
    const data = message.data as { announcement?: string };
    if (typeof data.announcement === 'string') announce(data.announcement);
    if (['environment', 'deployment', 'job'].includes(message.type)) void reload();
  });
}

export async function renderMetrics(ctx: ViewContext): Promise<void> {
  const projectId = Number(ctx.params.id);
  const zone = ctx.query.get('zone') ?? state.me?.time_zone ?? 'UTC';
  const days = ctx.query.get('days') ?? '30';
  const region = el('section', { role: 'region', 'aria-label': 'Delivery metrics', class: 'card' });
  const zoneSelect = el('select', { 'aria-label': 'Time zone' }, [
    ...['UTC', 'Europe/Lisbon', 'America/Bogota', 'Asia/Tokyo'].map((name) =>
      el('option', { value: name, text: name, selected: name === zone }),
    ),
  ]);
  const rangeSelect = el('select', { 'aria-label': 'Range' }, [
    el('option', { value: '7', text: '7 days', selected: days === '7' }),
    el('option', { value: '30', text: '30 days', selected: days === '30' }),
    el('option', { value: '90', text: '90 days', selected: days === '90' }),
  ]);
  const values = el('div');
  const load = async (): Promise<void> => {
    const result = await guard(() =>
      api.get<{ texts: string[] }>(
        `/api/projects/${projectId}/metrics?zone=${encodeURIComponent(zoneSelect.value)}&days=${rangeSelect.value}`,
      ),
    );
    clear(values);
    for (const text of result?.texts ?? []) values.append(el('p', { text }));
  };
  const change = (): void => {
    navigate(`/projects/${projectId}/-/metrics?zone=${encodeURIComponent(zoneSelect.value)}&days=${rangeSelect.value}`);
  };
  zoneSelect.addEventListener('change', change);
  rangeSelect.addEventListener('change', change);
  region.append(el('h2', { text: 'Delivery metrics' }), zoneSelect, rangeSelect, values);
  ctx.main.append(el('h1', { text: 'Delivery metrics' }), region);
  await load();
}
