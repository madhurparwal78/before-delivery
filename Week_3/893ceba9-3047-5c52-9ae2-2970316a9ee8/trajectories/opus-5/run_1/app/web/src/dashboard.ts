// The owner's dashboard: wordmark strip, analytics band and project cards.

import { DeskError, Project, WorkspaceStats, api } from './api';
import { labelledField, openModal } from './dialog';
import { el, reducedMotion } from './dom';
import { announce, announceAcross, clearProblem, failureCopy, problem, showFieldErrors } from './feedback';
import { navigate } from './router';
import { desk, setNewProjectDialog } from './shell';

export async function renderDashboard(screen: HTMLElement): Promise<void> {
  const stats = await api.get<WorkspaceStats>('/api/workspace/stats');
  const projects = desk.projects;

  screen.append(
    el('div', { class: 'content-column' }, [el('h1', { text: 'Your desk' })]),
    wordmarkStrip(projects),
    analyticsBand(stats),
    el('div', { class: 'content-column' }, [
      el('div', { class: 'project-grid' }, projects.map(projectCard)),
    ]),
  );
  setNewProjectDialog(openNewProject);
}

function wordmarkStrip(projects: Project[]): HTMLElement {
  const clients = Array.from(new Set(projects.map((project) => project.client)));
  const track = el('div', { class: 'wordmark-track' }, clients.map((client) =>
    el('span', { class: 'wordmark', text: client }),
  ));
  const strip = el('div', { class: 'wordmark-strip' }, [track]);
  const section = el('section', { class: 'band tinted', role: 'region', 'aria-label': 'Client apps' }, [
    el('div', { class: 'content-column' }, [
      el('p', { class: 'strip-line', text: `Client apps on this desk: ${projects.length}` }),
      strip,
    ]),
  ]);
  window.requestAnimationFrame(() => startMarquee(strip, track));
  return section;
}

// startMarquee scrolls the strip only when the wordmarks overflow it, pausing
// on hover or focus and stopping for good after two passes.
function startMarquee(strip: HTMLElement, track: HTMLElement): void {
  if (reducedMotion() || track.scrollWidth <= strip.clientWidth) return;
  track.classList.add('scrolling');
  let passes = 0;
  track.addEventListener('animationiteration', () => {
    passes += 1;
    if (passes >= 2) track.classList.remove('scrolling');
  });
  const pause = (): void => track.classList.add('paused');
  const resume = (): void => track.classList.remove('paused');
  strip.addEventListener('mouseenter', pause);
  strip.addEventListener('mouseleave', resume);
  strip.addEventListener('focusin', pause);
  strip.addEventListener('focusout', resume);
}

function analyticsBand(stats: WorkspaceStats): HTMLElement {
  const columns: [string, number][] = [
    ['Exact matches reused', stats.exact_matches_reused],
    ['Conflicts open', stats.conflicts_open],
    ['Below MQM threshold', stats.below_threshold],
    ['Publishes confirmed', stats.publishes_confirmed],
  ];
  const art = el('div', { class: 'analytics-art', 'aria-hidden': 'true' });
  art.innerHTML = `<svg viewBox="0 0 1200 240" preserveAspectRatio="none" focusable="false">
    <rect width="1200" height="240" fill="#fdf0e7"/>
    <rect x="120" width="260" height="240" fill="#fbdcea"/>
    <rect x="620" width="300" height="240" fill="#e7dcfb"/>
    <rect x="980" width="220" height="240" fill="#fde4d3"/>
  </svg>`;
  return el('section', { class: 'band analytics', role: 'region', 'aria-label': 'Workspace analytics' }, [
    art,
    el('div', { class: 'content-column' }, [
      el('div', { class: 'card analytics-card' }, [
        el('div', { class: 'stat-columns' }, columns.map(([caption, value]) =>
          el('div', { class: 'stat-column' }, [
            el('p', { class: 'stat-value', text: String(value) }),
            el('p', { class: 'stat-caption', text: caption }),
          ]),
        )),
        el('div', { class: 'centred' }, [
          el('a', { class: 'link-arrow', href: '/audit' }, [
            'Open audit log',
            el('span', { class: 'arrow', 'aria-hidden': 'true', text: '\u2192' }),
          ]),
        ]),
      ]),
    ]),
  ]);
}

function projectCard(project: Project): HTMLElement {
  const branches = (project.branches ?? []).filter((branch) => !branch.is_main);
  return el('article', { class: 'card project-card' }, [
    el('h2', { text: project.name }),
    el('p', { class: 'muted', text: project.client }),
    el('dl', { class: 'facts' }, [
      el('dt', { text: 'Source' }),
      el('dd', { text: project.source_language }),
      el('dt', { text: 'Targets' }),
      el('dd', { text: project.target_languages.join(', ') }),
      el('dt', { text: 'Repository' }),
      el('dd', { text: project.repository }),
      el('dt', { text: 'Open branches' }),
      el('dd', { class: 'tabular', text: String(branches.length) }),
      el('dt', { text: 'MQM threshold' }),
      el('dd', { class: 'tabular', text: String(project.mqm_threshold) }),
    ]),
    el('a', { class: 'button outline', href: `/projects/${project.slug}`, text: `Open ${project.name}` }),
  ]);
}

export function openNewProject(opener: HTMLElement | null): void {
  openModal({
    name: 'New project',
    opener,
    body: (handle) => {
      const slug = el('input', { type: 'text', 'data-field': 'slug' });
      const name = el('input', { type: 'text', 'data-field': 'name' });
      const client = el('input', { type: 'text', 'data-field': 'client' });
      const source = el('input', { type: 'text', 'data-field': 'source_language', value: 'en' });
      const targets = el('input', { type: 'text', 'data-field': 'target_languages' });
      const repository = el('input', { type: 'text', 'data-field': 'repository' });
      const threshold = el('input', {
        type: 'number',
        'data-field': 'mqm_threshold',
        min: '0',
        max: '100',
        value: '90',
        role: 'spinbutton',
      });
      const create = el('button', { type: 'submit', class: 'button primary', text: 'Create project' });
      const form = el('form', {
        onsubmit: async (event: Event) => {
          event.preventDefault();
          clearProblem();
          create.disabled = true;
          announce('Creating project.');
          try {
            const project = await api.post<Project>('/api/projects', {
              slug: slug.value.trim(),
              name: name.value.trim(),
              client: client.value.trim(),
              source_language: source.value.trim(),
              target_languages: targets.value.split(',').map((code) => code.trim()).filter(Boolean),
              repository: repository.value.trim(),
              mqm_threshold: Number(threshold.value),
            });
            announceAcross(`Created ${project.name}.`);
            handle.close();
            desk.projects = await api
              .get<{ projects: Project[] }>('/api/projects')
              .then((answer) => answer.projects);
            navigate(`/projects/${project.slug}`);
          } catch (error) {
            create.disabled = false;
            announce('');
            if (error instanceof DeskError) {
              const message = failureCopy(error);
              problem(message);
              showFieldErrors(
                form,
                error.info.fields ?? (error.info.code === 'slug_taken' ? { slug: message } : undefined),
              );
            }
          }
        },
      }, [
        el('h2', { text: 'New project' }),
        labelledField('Slug', slug),
        labelledField('Project name', name),
        labelledField('Client', client),
        labelledField('Source language', source),
        labelledField('Target languages', targets),
        labelledField('Repository', repository),
        labelledField('MQM threshold', threshold),
        el('div', { class: 'dialog-actions' }, [
          create,
          el('button', {
            type: 'button',
            class: 'button quiet',
            text: 'Cancel',
            onclick: () => handle.close(),
          }),
        ]),
      ]);
      return [form];
    },
  });
}
