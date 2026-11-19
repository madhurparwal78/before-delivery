import { getJson, requestJson, sendMultipart } from '../shared/api.ts';
import { clear, el } from '../shared/dom.ts';
import { ICONS, icon } from '../shared/icons.ts';
import { operatorTimeZone } from '../shared/timeZone.ts';
import { wallTimeToInstant } from '../shared/wallTime.ts';
import { formatDateTime } from '../../shared/dates.ts';
import { CREDIT_LABELS, LAYERS, LAYER_LABELS, type Layer, type ProjectStatus } from '../../shared/projectStatus.ts';
import { openDialog } from './dialog.ts';
import type { ConsoleLink, ConsoleProject } from './types.ts';

const STEM_LIMIT = 20_000_000;

type Field = { wrapper: HTMLElement; input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement };

function textField(id: string, label: string, kind: 'text' | 'number' = 'text'): Field {
  const input = el('input', { id, type: kind, class: 'console-input' });
  return { wrapper: el('div', { class: 'field' }, [el('label', { for: id, text: label }), input]), input };
}

function areaField(id: string, label: string): Field {
  const input = el('textarea', { id, rows: 4, class: 'console-input' });
  return { wrapper: el('div', { class: 'field' }, [el('label', { for: id, text: label }), input]), input };
}

function selectField(id: string, label: string, options: Array<[string, string]>): Field {
  const input = el(
    'select',
    { id, class: 'console-input' },
    options.map(([value, text]) => el('option', { value, text })),
  );
  return { wrapper: el('div', { class: 'field' }, [el('label', { for: id, text: label }), input]), input };
}

export type ProjectsView = {
  element: HTMLElement;
  activate: () => void;
};

export function createProjectsView(setStatus: (text: string) => void): ProjectsView {
  const list = el('ul', { class: 'console-list', role: 'list', 'aria-label': 'Projects' });
  const newProject = el('button', { type: 'button', class: 'secondary' }, [
    icon(ICONS.add),
    el('span', { text: 'New project' }),
  ]);
  const listPane = el('div', { class: 'pane list-pane' }, [newProject, list]);
  const detailPane = el('div', { class: 'pane detail-pane' });
  const element = el('div', { class: 'two-pane' }, [listPane, detailPane]);

  let projects: ConsoleProject[] = [];
  let selected: ConsoleProject | null = null;
  let draftMode = false;

  const slug = textField('project-slug', 'Slug');
  const title = textField('project-title', 'Title');
  const creditType = selectField('project-credit-type', 'Credit type', [
    ['shipped', CREDIT_LABELS.shipped],
    ['jam', CREDIT_LABELS.jam],
    ['redesign', CREDIT_LABELS.redesign],
  ]);
  const creditLine = textField('project-credit-line', 'Credit line');
  const role = textField('project-role', 'Role');
  const blurb = areaField('project-blurb', 'Blurb');
  const tags = textField('project-tags', 'Tags');
  const visibility = selectField('project-visibility', 'Visibility', [
    ['public', 'Public'],
    ['nda', 'NDA (private links only)'],
  ]);
  const position = textField('project-position', 'Position', 'number');
  const thresholdFields: Record<Layer, Field> = {
    bed: textField('project-threshold-bed', 'Bed threshold', 'number'),
    pulse: textField('project-threshold-pulse', 'Pulse threshold', 'number'),
    lead: textField('project-threshold-lead', 'Lead threshold', 'number'),
    stinger: textField('project-threshold-stinger', 'Stinger threshold', 'number'),
  };
  const saveProject = el('button', { type: 'submit', class: 'primary', text: 'Save project' });
  const form = el('form', { class: 'console-form', 'aria-label': 'Project details' }, [
    slug.wrapper,
    title.wrapper,
    creditType.wrapper,
    creditLine.wrapper,
    role.wrapper,
    blurb.wrapper,
    tags.wrapper,
    visibility.wrapper,
    position.wrapper,
    thresholdFields.bed.wrapper,
    thresholdFields.pulse.wrapper,
    thresholdFields.lead.wrapper,
    thresholdFields.stinger.wrapper,
    saveProject,
  ]);

  const stemArea = el('div', { class: 'stem-area' });
  const transitionArea = el('div', { class: 'transition-area' });
  const linkArea = el('div', { class: 'link-area' });

  const renderList = (): void => {
    clear(list);
    for (const project of projects) {
      const open = el('button', { type: 'button', class: 'list-row', text: `${project.title} — ${project.status}` });
      if (selected?.id === project.id) open.setAttribute('aria-current', 'true');
      open.addEventListener('click', () => {
        draftMode = false;
        selected = project;
        element.classList.add('show-detail');
        renderList();
        renderDetail();
      });
      list.append(el('li', {}, [open]));
    }
  };

  const fillForm = (project: ConsoleProject | null): void => {
    slug.input.value = project?.slug ?? '';
    title.input.value = project?.title ?? '';
    (creditType.input as HTMLSelectElement).value = project?.credit_type ?? 'shipped';
    creditLine.input.value = project?.credit_line ?? '';
    role.input.value = project?.role ?? '';
    blurb.input.value = project?.blurb ?? '';
    tags.input.value = (project?.tags ?? []).join(', ');
    (visibility.input as HTMLSelectElement).value = project?.visibility ?? 'public';
    position.input.value = String(project?.position ?? projects.length + 1);
    for (const layer of LAYERS) {
      thresholdFields[layer].input.value = String(project?.thresholds[layer] ?? { bed: 0, pulse: 25, lead: 50, stinger: 75 }[layer]);
    }
  };

  const renderStems = (project: ConsoleProject): void => {
    clear(stemArea);
    stemArea.append(el('h3', { class: 'subheading', text: 'Stems' }));
    for (const layer of LAYERS) {
      const stored = project.stems.find((stem) => stem.layer === layer);
      const id = `stem-${layer}`;
      const input = el('input', { id, type: 'file', accept: '.wav,.ogg,audio/*' });
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (file === undefined) return;
        void (async () => {
          setStatus(`Uploading ${LAYER_LABELS[layer]} stem\u2026`);
          const body = new FormData();
          body.set('layer', layer);
          body.set('file', file, file.name);
          const result = await sendMultipart<unknown>(`/api/console/projects/${project.id}/stems`, body);
          if (result.ok) {
            setStatus(`${LAYER_LABELS[layer]} stem stored.`);
            await reload(project.id);
            return;
          }
          if (result.status === 415) setStatus('That file isn\u2019t a WAV or OGG stem.');
          else if (result.status === 413) setStatus(`That stem is over ${STEM_LIMIT.toLocaleString('en-US')} bytes.`);
          else if (result.status === 422) setStatus('File name is not allowed.');
          else if (result.status === 503) {
            setStatus('Storage is unreachable. Uploads and publishing are paused until it returns.');
          } else setStatus(result.message);
        })();
      });
      stemArea.append(
        el('div', { class: 'field' }, [
          el('label', { for: id, text: `${LAYER_LABELS[layer]} stem file` }),
          input,
          el('span', {
            class: 'stem-detail mono',
            text:
              stored === undefined
                ? 'Missing'
                : `${stored.format.toUpperCase()} · ${stored.bytes.toLocaleString('en-US')} bytes · ${(stored.duration_ms / 1000).toFixed(1)}s`,
          }),
        ]),
      );
    }
  };

  const transition = async (project: ConsoleProject, to: ProjectStatus): Promise<void> => {
    const result = await requestJson<{ project: ConsoleProject }>(
      'POST',
      `/api/console/projects/${project.id}/transition`,
      { body: { to } },
    );
    if (result.ok) {
      if (to === 'published') {
        setStatus(
          result.data.project.visibility === 'public'
            ? `${project.title} is live in the journey.`
            : `${project.title} is published for private links only.`,
        );
      } else if (to === 'withdrawn') {
        setStatus(`${project.title} is withdrawn. Its stems are deleted.`);
      } else {
        setStatus('Project saved.');
      }
      await reload(project.id);
      return;
    }
    if (result.code === 'stems_incomplete') {
      const missing = (result.body.missing as string[] | undefined) ?? [];
      setStatus(`Upload the missing stems first: ${missing.join(', ')}.`);
      return;
    }
    if (result.code === 'illegal_transition') {
      setStatus('That move isn\u2019t allowed from the current state.');
      return;
    }
    if (result.status === 503) {
      setStatus('Storage is unreachable. Uploads and publishing are paused until it returns.');
      return;
    }
    setStatus(result.message);
  };

  const renderTransitions = (project: ConsoleProject): void => {
    clear(transitionArea);
    const add = (text: string, to: ProjectStatus): void => {
      const button = el('button', { type: 'button', class: 'secondary', text });
      button.addEventListener('click', () => void transition(project, to));
      transitionArea.append(button);
    };
    if (project.status === 'draft') add('Send for review', 'in_review');
    if (project.status === 'in_review') {
      add('Back to draft', 'draft');
      add('Publish', 'published');
    }
    if (project.status !== 'withdrawn') {
      const withdraw = el('button', { type: 'button', class: 'danger', text: 'Withdraw project' });
      withdraw.addEventListener('click', () => {
        const confirmButton = el('button', { type: 'button', class: 'danger', text: 'Withdraw' });
        const keepButton = el('button', { type: 'button', class: 'secondary', text: 'Keep project' });
        const dialog = openDialog({
          label: `Withdraw ${project.title}?`,
          role: 'alertdialog',
          opener: withdraw,
          body: [
            el('p', {
              text: 'Its stems are deleted and every link to it stops working. This cannot be undone.',
            }),
            el('div', { class: 'dialog-actions' }, [confirmButton, keepButton]),
          ],
        });
        keepButton.addEventListener('click', () => dialog.close());
        confirmButton.addEventListener('click', () => {
          dialog.close();
          void transition(project, 'withdrawn');
        });
      });
      transitionArea.append(withdraw);
    }
  };

  const renderLinks = async (project: ConsoleProject): Promise<void> => {
    clear(linkArea);
    if (project.status !== 'in_review' && project.status !== 'published') return;
    const newLink = el('button', { type: 'button', class: 'secondary' }, [
      icon(ICONS.link),
      el('span', { text: 'New listening link' }),
    ]);
    const links = el('ul', { class: 'console-list', role: 'list', 'aria-label': 'Listening links' });
    linkArea.append(el('h3', { class: 'subheading', text: 'Listening links' }), newLink, links);

    const loadLinks = async (): Promise<void> => {
      const result = await getJson<{ links: ConsoleLink[] }>(`/api/console/projects/${project.id}/links`);
      clear(links);
      if (!result.ok) return;
      for (const link of result.data.links) {
        const copy = el('button', { type: 'button', class: 'secondary', text: 'Copy link' });
        copy.addEventListener('click', () => {
          void navigator.clipboard?.writeText(`${window.location.origin}${link.url}`);
        });
        const revoke = el('button', { type: 'button', class: 'secondary', text: 'Revoke' });
        revoke.addEventListener('click', () => {
          void (async () => {
            const done = await requestJson<unknown>('POST', `/api/console/links/${link.id}/revoke`, { body: {} });
            setStatus(done.ok ? 'Link revoked. It stopped working immediately.' : done.message);
            await loadLinks();
          })();
        });
        const actions = [copy, revoke];
        if (link.status === 'active') {
          const regenerate = el('button', { type: 'button', class: 'secondary', text: 'Regenerate' });
          regenerate.addEventListener('click', () => {
            void (async () => {
              const done = await requestJson<unknown>('POST', `/api/console/links/${link.id}/regenerate`, {
                body: {},
              });
              if (done.ok) setStatus('New link created. The old one no longer works.');
              else if (done.code === 'link_not_active') {
                setStatus('Only an active link can be regenerated. Create a new link instead.');
              } else setStatus(done.message);
              await loadLinks();
            })();
          });
          actions.push(regenerate);
        }
        const statusLabel = { active: 'Active', expired: 'Expired', revoked: 'Revoked' }[link.status];
        links.append(
          el('li', { class: 'link-row' }, [
            el('span', { class: 'link-label', text: link.label }),
            el('span', { class: 'link-status', text: statusLabel }),
            el('span', {
              class: 'mono',
              text: formatDateTime(new Date(link.expires_at), operatorTimeZone()),
            }),
            ...actions,
          ]),
        );
      }
    };

    newLink.addEventListener('click', () => {
      const label = el('input', { id: 'link-label', type: 'text', class: 'console-input' });
      const expires = el('input', { id: 'link-expires', type: 'datetime-local', class: 'console-input' });
      const create = el('button', { type: 'button', class: 'primary', text: 'Create link' });
      const dialog = openDialog({
        label: 'New listening link',
        opener: newLink,
        body: [
          el('h2', { class: 'dialog-heading', text: 'New listening link' }),
          el('div', { class: 'field' }, [el('label', { for: 'link-label', text: 'Label' }), label]),
          el('div', { class: 'field' }, [el('label', { for: 'link-expires', text: 'Expires at' }), expires]),
          el('div', { class: 'dialog-actions' }, [create]),
        ],
      });
      create.addEventListener('click', () => {
        const instant = wallTimeToInstant(expires.value, operatorTimeZone());
        if (instant === null) {
          setStatus('Give an expiry date and time.');
          return;
        }
        void (async () => {
          const result = await requestJson<{ link: ConsoleLink }>(
            'POST',
            `/api/console/projects/${project.id}/links`,
            { body: { label: label.value, expires_at: instant.toISOString() } },
          );
          if (result.ok) {
            setStatus(
              `Link created. It stops working on ${formatDateTime(
                new Date(result.data.link.expires_at),
                operatorTimeZone(),
              )}.`,
            );
            dialog.close();
            await loadLinks();
            return;
          }
          setStatus(result.errors.expires_at ?? result.message);
        })();
      });
    });

    await loadLinks();
  };

  const backToList = el('button', { type: 'button', class: 'secondary back-to-list' }, [
    icon(ICONS.back),
    el('span', { text: 'Back to list' }),
  ]);
  backToList.addEventListener('click', () => {
    element.classList.remove('show-detail');
    list.querySelector<HTMLElement>('button[aria-current="true"]')?.focus();
  });

  const renderDetail = (): void => {
    clear(detailPane);
    detailPane.append(backToList, form, stemArea, transitionArea, linkArea);
    clear(stemArea);
    clear(transitionArea);
    clear(linkArea);
    if (draftMode || selected === null) {
      fillForm(null);
      return;
    }
    fillForm(selected);
    renderStems(selected);
    renderTransitions(selected);
    void renderLinks(selected);
  };

  const reload = async (keepId: string | null): Promise<void> => {
    const result = await getJson<{ projects: ConsoleProject[] }>('/api/console/projects');
    if (!result.ok) {
      setStatus(result.message);
      return;
    }
    projects = result.data.projects;
    selected = projects.find((project) => project.id === keepId) ?? null;
    renderList();
    renderDetail();
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const body = {
      slug: slug.input.value,
      title: title.input.value,
      credit_type: (creditType.input as HTMLSelectElement).value,
      credit_line: creditLine.input.value,
      role: role.input.value,
      blurb: blurb.input.value,
      tags: tags.input.value
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => tag !== ''),
      visibility: (visibility.input as HTMLSelectElement).value,
      position: Number(position.input.value),
      thresholds: {
        bed: Number(thresholdFields.bed.input.value),
        pulse: Number(thresholdFields.pulse.input.value),
        lead: Number(thresholdFields.lead.input.value),
        stinger: Number(thresholdFields.stinger.input.value),
      },
    };
    void (async () => {
      const result =
        draftMode || selected === null
          ? await requestJson<{ project: ConsoleProject }>('POST', '/api/console/projects', { body })
          : await requestJson<{ project: ConsoleProject }>('PATCH', `/api/console/projects/${selected.id}`, { body });
      if (result.ok) {
        setStatus('Project saved.');
        draftMode = false;
        await reload(result.data.project.id);
        return;
      }
      if (result.code === 'slug_taken') setStatus('That slug is already used.');
      else if (result.status === 422) setStatus('Check the highlighted fields.');
      else if (result.status === 503) {
        setStatus('Storage is unreachable. Uploads and publishing are paused until it returns.');
      } else setStatus(result.message);
    })();
  });

  newProject.addEventListener('click', () => {
    draftMode = true;
    selected = null;
    element.classList.add('show-detail');
    renderList();
    renderDetail();
    slug.input.focus();
  });

  return {
    element,
    activate: () => void reload(selected?.id ?? null),
  };
}
