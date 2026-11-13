import { clear, el } from '../dom.js';
import { announce, ApiFailure, get, write } from '../state.js';
import { emptyBand, loadFailed, openDialog, showFormError } from '../widgets.js';

type Pipeline = { name: string; version: number; processors: unknown[] };

type Step = {
  step: number;
  processor: string;
  status: 'applied' | 'skipped' | 'failed' | 'dropped';
  event: Record<string, unknown>;
  changed: string[];
  text?: string;
};

type SimulationResult = {
  event: number;
  outcome: 'stored' | 'dropped' | 'failed';
  error?: string;
  steps: Step[];
};

export async function renderPipelines(main: HTMLElement): Promise<void> {
  let data: { pipelines: Pipeline[] };
  try {
    data = await get<{ pipelines: Pipeline[] }>('/api/pipelines');
  } catch {
    main.append(loadFailed(() => void renderPipelines(main)));
    return;
  }
  const newPipeline = el('button', {
    type: 'button',
    'aria-label': 'New pipeline',
    text: 'New pipeline',
    class: 'primary',
  });
  newPipeline.addEventListener('click', () => {
    openDialog({
      label: 'New pipeline',
      opener: newPipeline,
      content: (dialog) => {
        const name = el('input', { type: 'text', 'aria-label': 'Pipeline name', 'data-field': 'name' });
        const create = el('button', {
          type: 'button',
          'aria-label': 'Create pipeline',
          text: 'Create pipeline',
          class: 'primary',
        });
        const host = el('div', {});
        create.addEventListener('click', () => {
          void (async () => {
            try {
              await write('PUT', `/api/pipelines/${encodeURIComponent(name.value)}`, { processors: [] });
              dialog.close();
              clear(main);
              await renderPipelines(main);
            } catch (cause) {
              if (cause instanceof ApiFailure) showFormError(host, cause);
            }
          })();
        });
        return [el('h2', { text: 'New pipeline' }), host, name, create];
      },
    });
  });
  main.append(el('h1', { class: 'view-title', text: 'Pipelines' }));
  if (data.pipelines.length === 0) {
    main.append(emptyBand('No pipelines yet.', newPipeline));
    return;
  }
  main.append(
    newPipeline,
    el('table', { 'aria-label': 'Pipelines', class: 'data-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Pipeline' }),
          el('th', { scope: 'col', text: 'Version' }),
          el('th', { scope: 'col', text: 'Processors' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        data.pipelines.map((pipeline) =>
          el('tr', {}, [
            el('td', {}, [el('a', { href: `/pipelines/${pipeline.name}`, text: pipeline.name })]),
            el('td', { class: 'mono', text: String(pipeline.version) }),
            el('td', { class: 'mono', text: String(pipeline.processors.length) }),
          ]),
        ),
      ),
    ]),
  );
}

export async function renderPipeline(main: HTMLElement, params: Record<string, string>): Promise<void> {
  const name = params.name;
  let data: { pipelines: Pipeline[] };
  try {
    data = await get<{ pipelines: Pipeline[] }>('/api/pipelines');
  } catch {
    main.append(loadFailed(() => void renderPipeline(main, params)));
    return;
  }
  const pipeline = data.pipelines.find((item) => item.name === name);
  if (!pipeline) {
    main.append(el('h1', { class: 'view-title', text: 'Page not found.' }));
    return;
  }
  const versionLine = el('p', { class: 'mono', text: `Version ${pipeline.version}` });
  const area = el('textarea', {
    'aria-label': 'Processors JSON',
    'data-field': 'processors',
    class: 'mono',
    rows: '12',
    text: JSON.stringify(pipeline.processors, null, 2),
  });
  const save = el('button', {
    type: 'button',
    'aria-label': 'Save pipeline',
    text: 'Save pipeline',
    class: 'primary',
  });
  const host = el('div', {});
  const noticeHost = el('p', { class: 'notice-line' });
  save.addEventListener('click', () => {
    save.setAttribute('aria-busy', 'true');
    void (async () => {
      try {
        const processors = JSON.parse(area.value) as unknown[];
        const result = await write<{ version: number; message: string }>(
          'PUT',
          `/api/pipelines/${encodeURIComponent(name)}`,
          { processors },
        );
        versionLine.textContent = `Version ${result.version}`;
        noticeHost.textContent = result.message;
        announce(result.message);
      } catch (cause) {
        if (cause instanceof ApiFailure) showFormError(host, cause);
        else {
          showFormError(host, new ApiFailure(422, 'invalid', 'Check the highlighted fields.', {
            processors: 'Send a JSON list of processors.',
          }));
        }
      } finally {
        save.removeAttribute('aria-busy');
      }
    })();
  });
  main.append(
    el('h1', { class: 'view-title', text: `Pipeline ${name}` }),
    versionLine,
    el('a', { href: `/pipelines/${name}/simulate`, text: 'Simulate', 'aria-label': 'Simulate' }),
    el('div', { class: 'card' }, [host, area, save, noticeHost]),
  );
}

export function renderSimulate(main: HTMLElement, params: Record<string, string>): void {
  const name = params.name;
  const area = el('textarea', {
    'aria-label': 'Sample events',
    class: 'mono',
    rows: '6',
    text: '{"@timestamp":"2026-03-01T00:00:00.000Z","message":"from 10.0.0.9","host":"host-1"}',
  });
  const run = el('button', {
    type: 'button',
    'aria-label': 'Run simulation',
    text: 'Run simulation',
    class: 'primary',
  });
  const results = el('div', { class: 'simulation-results' });
  const region = el('div', { role: 'region', 'aria-label': 'Simulate', class: 'card' }, [
    area,
    run,
    results,
  ]);
  run.addEventListener('click', () => {
    run.setAttribute('aria-busy', 'true');
    void (async () => {
      clear(results);
      try {
        const data = await write<{ results: SimulationResult[] }>(
          'POST',
          `/api/pipelines/${encodeURIComponent(name)}/simulate`,
          { lines: area.value },
        );
        for (const result of data.results) {
          const group = el('div', { role: 'group', 'aria-label': `Event ${result.event}`, class: 'sim-event' }, [
            el('p', { class: 'mono', text: `Event ${result.event}: ${result.outcome}` }),
          ]);
          if (result.error) group.append(el('p', { class: 'failure-line', text: result.error }));
          for (const step of result.steps) {
            const stepGroup = el(
              'div',
              { role: 'group', 'aria-label': `Step ${step.step} ${step.processor}`, class: 'sim-step' },
              [el('p', { class: 'mono', text: `Step ${step.step} ${step.processor}: ${step.status}` })],
            );
            if (step.text) stepGroup.append(el('p', { text: step.text }));
            for (const field of step.changed) {
              stepGroup.append(
                el('p', { class: 'mono changed', 'data-changed': 'true', text: `${field} changed` }),
              );
            }
            stepGroup.append(el('pre', { class: 'mono', text: JSON.stringify(step.event, null, 2) }));
            group.append(stepGroup);
          }
          results.append(group);
        }
      } catch (cause) {
        if (cause instanceof ApiFailure) showFormError(results, cause);
      } finally {
        run.removeAttribute('aria-busy');
      }
    })();
  });
  main.append(el('h1', { class: 'view-title', text: `Simulate ${name}` }), region);
}
