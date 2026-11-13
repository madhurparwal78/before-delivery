// The project page: branch rail, migration health cards and workflow cards.

import {
  Assignment,
  Branch,
  DeskError,
  Operation,
  Preview,
  Project,
  Publish,
  Reviewer,
  TMImport,
  api,
} from './api';
import { branchRail } from './branchrail';
import { labelledField, openModal } from './dialog';
import { clear, el, localTime, reducedMotion, statusTag } from './dom';
import {
  announce,
  announceAcross,
  clearProblem,
  failureCopy,
  problem,
  publishFailureCopy,
  showFieldErrors,
} from './feedback';
import { iconTile } from './illustrations';
import { navigate } from './router';

export async function renderProject(screen: HTMLElement, project: Project, search: URLSearchParams): Promise<void> {
  const branches = (project.branches ?? []).filter(
    (branch) => branch.is_main || branch.state === 'open' || branch.state === 'in_review',
  );
  const rail = branchRail({
    project,
    branches,
    initial: search.get('branch') ?? 'main',
  });

  const head = el('div', { class: 'content-column project-head' }, [
    el('h1', { text: project.name }),
    el('button', {
      type: 'button',
      class: 'button outline',
      text: 'New branch',
      onclick: (event: Event) => openNewBranch(project, event.currentTarget as HTMLElement),
    }),
  ]);

  const health = el('div', { class: 'content-column health-grid' });
  const workflows = workflowSection(project, rail.selected);
  const publishStatus = el('section', {
    class: 'content-column',
    role: 'region',
    'aria-label': 'Publish status',
  });

  screen.append(head, el('div', { class: 'content-column' }, [rail.node]), health, workflows, publishStatus);
  await paintHealth(health, project);
  await paintLatestPublish(publishStatus, project, false);
}

async function paintHealth(host: HTMLElement, project: Project): Promise<void> {
  const [imports, operations, branches] = await Promise.all([
    api.get<{ imports: TMImport[] }>(`/api/projects/${project.slug}/tm/imports`),
    api.get<{ operations: Operation[] }>(`/api/projects/${project.slug}/operations`),
    api.get<{ branches: Branch[] }>(`/api/projects/${project.slug}/branches`),
  ]);
  const report = imports.imports[0] ?? null;
  const previews = await Promise.all(
    branches.branches
      .filter((branch) => branch.is_main || branch.state === 'open' || branch.state === 'in_review')
      .map((branch) =>
        api.get<Preview>(
          `/api/projects/${project.slug}/branches/${encodeURIComponent(branch.name)}/merge-preview`,
        ),
      ),
  );
  const conflictsOpen = previews.reduce(
    (total, preview) => total + preview.conflicts.filter((conflict) => conflict.resolution === null).length,
    0,
  );
  const inReview = branches.branches.filter((branch) => branch.state === 'in_review').length;
  const merges = operations.operations.filter((operation) => operation.kind === 'merge');
  const restorable = operations.operations.filter((operation) => operation.restorable).length;
  const firstFeature = branches.branches.find((branch) => !branch.is_main && branch.state !== 'merged');

  clear(host);
  host.append(
    healthCard({
      label: 'Import health',
      glyphs: ['memory', 'upload', 'score'],
      title: 'Legacy memory, line by line',
      sentence:
        'Every imported row gets one outcome, and the original file stays exactly as the client sent it.',
      items: [
        ['Entries added', String(report?.added ?? 0)],
        ['Duplicates merged', String(report?.duplicates ?? 0)],
        ['Exact matches reused', String(report?.applied ?? 0)],
        ['Rows needing attention', String(report?.rows.length ?? 0)],
      ],
      note: imports.imports.length === 0 ? 'No imports yet.' : null,
      linkText: 'Open import report',
      href: `/projects/${project.slug}/tm`,
    }),
    healthCard({
      label: 'Merge health',
      glyphs: ['branch', 'merge', 'conflict'],
      title: 'Branches that keep every string',
      sentence: 'A merge applies every change and resolution, and nothing is overwritten silently.',
      items: [
        ['Conflicts open', String(conflictsOpen)],
        ['Branches in review', String(inReview)],
        ['Last merge', merges[0] ? localTime(merges[0].at) : 'Never'],
        ['Restorable operations', String(restorable)],
      ],
      note: null,
      linkText: 'Open merge preview',
      href: firstFeature
        ? `/projects/${project.slug}/merge?branch=${encodeURIComponent(firstFeature.name)}`
        : `/projects/${project.slug}`,
    }),
  );
}

function healthCard(options: {
  label: string;
  glyphs: string[];
  title: string;
  sentence: string;
  items: [string, string][];
  note: string | null;
  linkText: string;
  href: string;
}): HTMLElement {
  return el('section', { class: 'card health-card', role: 'region', 'aria-label': options.label }, [
    el('div', { class: 'tile-row' }, options.glyphs.map((glyph) => iconTile(glyph))),
    el('h2', { text: options.title }),
    el('p', { text: options.sentence }),
    el('p', { class: 'matters-label', text: 'Living with' }),
    el('dl', { class: 'counts' }, options.items.flatMap(([caption, value]) => [
      el('dt', { text: caption }),
      el('dd', { class: 'tabular', text: value }),
    ])),
    options.note ? el('p', { class: 'muted', text: options.note }) : null,
    el('a', { class: 'link-arrow block', href: options.href }, [
      options.linkText,
      el('span', { class: 'arrow', 'aria-hidden': 'true', text: '\u2192' }),
    ]),
  ]);
}

type Workflow = { label: string; glyph: string; sentence: string; run: (opener: HTMLElement) => void };

function workflowSection(project: Project, selected: () => string): HTMLElement {
  const workflows: Workflow[] = [
    {
      label: 'Import translation memory',
      glyph: 'memory',
      sentence: 'Bring a client TMX or spreadsheet into this project and reuse exact matches.',
      run: () => navigate(`/projects/${project.slug}/tm`),
    },
    {
      label: 'Upload source file',
      glyph: 'upload',
      sentence: 'Add or update the keys of an open branch from a JSON locale file.',
      run: (opener) => openUploadDialog(project, opener),
    },
    {
      label: 'Draft with AI',
      glyph: 'ai',
      sentence: 'Fill untranslated segments from the memory first and the routed engine after.',
      run: (opener) => openDraftDialog(project, opener),
    },
    {
      label: 'Assign review',
      glyph: 'review',
      sentence: 'Hand the segments that need review to an invited client reviewer.',
      run: (opener) => openAssignDialog(project, opener),
    },
    {
      label: 'Merge a branch',
      glyph: 'merge',
      sentence: 'Check the preview, resolve conflicts and merge the branch into main.',
      run: () => {
        const branch = selected();
        navigate(
          branch === 'main'
            ? `/projects/${project.slug}`
            : `/projects/${project.slug}/merge?branch=${encodeURIComponent(branch)}`,
        );
      },
    },
    {
      label: 'Publish',
      glyph: 'publish',
      sentence: 'Write the approved bundles and open a pull request on the client repository.',
      run: (opener) => openPublishDialog(project, opener),
    },
  ];

  const cards = workflows.map((workflow) =>
    el('article', { class: 'card workflow-card' }, [
      iconTile(workflow.glyph, true),
      el('h3', { text: workflow.label }),
      el('p', { text: workflow.sentence }),
      el('button', {
        type: 'button',
        class: 'button outline',
        text: workflow.label,
        onclick: (event: Event) => workflow.run(event.currentTarget as HTMLElement),
      }),
    ]),
  );

  const track = el('div', { class: 'workflow-grid' }, cards);
  const dots = el('div', { class: 'carousel-dots' });
  let at = 0;

  const show = (index: number): void => {
    at = (index + cards.length) % cards.length;
    track.style.transitionDuration = reducedMotion() ? '0ms' : '300ms';
    track.style.transform = `translateX(-${at * 100}%)`;
    Array.from(dots.children).forEach((dot, i) => {
      if (i === at) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  };

  for (let i = 0; i < cards.length; i += 1) {
    dots.append(
      el('button', {
        type: 'button',
        class: 'carousel-dot',
        'aria-label': `Show workflow ${i + 1}`,
        onclick: () => show(i),
      }),
    );
  }

  const controls = el('div', { class: 'carousel-controls' }, [
    el('button', {
      type: 'button',
      class: 'button quiet',
      text: 'Previous workflow',
      onclick: () => show(at - 1),
    }),
    dots,
    el('button', {
      type: 'button',
      class: 'button quiet',
      text: 'Next workflow',
      onclick: () => show(at + 1),
    }),
  ]);

  let startX = 0;
  track.addEventListener('touchstart', (event) => {
    startX = event.touches[0].clientX;
  }, { passive: true });
  track.addEventListener('touchend', (event) => {
    const moved = event.changedTouches[0].clientX - startX;
    if (Math.abs(moved) > 40) show(moved < 0 ? at + 1 : at - 1);
  });

  show(0);

  return el('section', { class: 'band tinted', role: 'region', 'aria-label': 'Workflows' }, [
    el('div', { class: 'content-column' }, [
      el('h2', { text: 'Workflows' }),
      el('div', { class: 'workflow-viewport' }, [track]),
      controls,
    ]),
  ]);
}

function openNewBranch(project: Project, opener: HTMLElement): void {
  openModal({
    name: 'New branch',
    opener,
    body: (handle) => {
      const name = el('input', { type: 'text', 'data-field': 'name' });
      const create = el('button', { type: 'submit', class: 'button primary', text: 'Create branch' });
      const form = el('form', {
        onsubmit: async (event: Event) => {
          event.preventDefault();
          clearProblem();
          create.disabled = true;
          announce('Creating branch.');
          try {
            await api.post(`/api/projects/${project.slug}/branches`, { name: name.value.trim() });
            announceAcross(`Created branch ${name.value.trim()}.`);
            handle.close();
            navigate(`/projects/${project.slug}?branch=${encodeURIComponent(name.value.trim())}`);
          } catch (error) {
            create.disabled = false;
            announce('');
            if (error instanceof DeskError) {
              const message = failureCopy(error);
              problem(message);
              showFieldErrors(form, error.info.fields ?? { name: message });
            }
          }
        },
      }, [
        el('h2', { text: 'New branch' }),
        labelledField('Branch name', name),
        el('div', { class: 'dialog-actions' }, [
          create,
          el('button', { type: 'button', class: 'button quiet', text: 'Cancel', onclick: () => handle.close() }),
        ]),
      ]);
      return [form];
    },
  });
}

function branchSelect(project: Project, label: string): HTMLSelectElement {
  const select = el('select', { 'data-field': 'branch', 'aria-label': label });
  for (const branch of project.branches ?? []) {
    if (!branch.is_main && branch.state !== 'open' && branch.state !== 'in_review') continue;
    select.append(el('option', { value: branch.name, text: branch.name }));
  }
  return select;
}

function languageSelect(project: Project, label: string): HTMLSelectElement {
  const select = el('select', { 'data-field': 'language', 'aria-label': label });
  for (const language of project.target_languages) {
    select.append(el('option', { value: language, text: language }));
  }
  return select;
}

function openUploadDialog(project: Project, opener: HTMLElement): void {
  openModal({
    name: 'Upload source file',
    opener,
    body: (handle) => {
      const branch = branchSelect(project, 'Branch');
      const file = el('input', { type: 'file', 'data-field': 'file', accept: '.json,application/json' });
      const upload = el('button', { type: 'submit', class: 'button primary', text: 'Upload' });
      const form = el('form', {
        onsubmit: async (event: Event) => {
          event.preventDefault();
          clearProblem();
          if (!file.files?.length) {
            showFieldErrors(form, { file: 'Choose a file to upload.' });
            return;
          }
          upload.disabled = true;
          announce('Uploading source file.');
          const body = new FormData();
          body.append('file', file.files[0]);
          try {
            const answer = await api.upload<{
              filename: string;
              keys_added: number;
              keys_changed: number;
              keys_unchanged: number;
            }>(
              `/api/projects/${project.slug}/branches/${encodeURIComponent(branch.value)}/source-files`,
              body,
            );
            announce(
              `Stored ${answer.filename} as submitted: ${answer.keys_added} keys added, ${answer.keys_changed} changed, ${answer.keys_unchanged} unchanged.`,
            );
            handle.close();
          } catch (error) {
            upload.disabled = false;
            announce('');
            if (error instanceof DeskError) {
              const message = failureCopy(error);
              problem(message);
              showFieldErrors(form, error.info.fields ?? { file: message });
            }
          }
        },
      }, [
        el('h2', { text: 'Upload source file' }),
        labelledField('Branch', branch),
        labelledField('Source file', file),
        el('div', { class: 'dialog-actions' }, [
          upload,
          el('button', { type: 'button', class: 'button quiet', text: 'Cancel', onclick: () => handle.close() }),
        ]),
      ]);
      return [form];
    },
  });
}

function openDraftDialog(project: Project, opener: HTMLElement): void {
  openModal({
    name: 'Draft with AI',
    opener,
    body: (handle) => {
      const branch = branchSelect(project, 'Branch');
      const language = languageSelect(project, 'Language');
      const draft = el('button', { type: 'submit', class: 'button primary', text: 'Draft' });
      const form = el('form', {
        onsubmit: async (event: Event) => {
          event.preventDefault();
          clearProblem();
          draft.disabled = true;
          announce(`Drafting ${language.value} segments.`);
          try {
            const answer = await api.post<{ tm_reused: number; ai_drafted: number }>(
              `/api/projects/${project.slug}/branches/${encodeURIComponent(branch.value)}/drafts`,
              { language: language.value },
            );
            announce(
              `Drafted ${answer.ai_drafted} segments with AI and reused ${answer.tm_reused} exact matches.`,
            );
            handle.close();
          } catch (error) {
            draft.disabled = false;
            announce('');
            if (error instanceof DeskError) {
              problem(failureCopy(error));
              showFieldErrors(form, error.info.fields);
            }
          }
        },
      }, [
        el('h2', { text: 'Draft with AI' }),
        labelledField('Branch', branch),
        labelledField('Language', language),
        el('div', { class: 'dialog-actions' }, [
          draft,
          el('button', { type: 'button', class: 'button quiet', text: 'Cancel', onclick: () => handle.close() }),
        ]),
      ]);
      return [form];
    },
  });
}

function openAssignDialog(project: Project, opener: HTMLElement): void {
  openModal({
    name: 'Assign review',
    opener,
    body: (handle) => {
      const reviewer = el('select', { 'data-field': 'reviewer_id', 'aria-label': 'Reviewer' });
      const branch = branchSelect(project, 'Branch');
      const language = languageSelect(project, 'Language');
      const assign = el('button', { type: 'submit', class: 'button primary', text: 'Assign' });
      void api
        .get<{ reviewers: Reviewer[] }>(`/api/projects/${project.slug}/reviewers`)
        .then((answer) => {
          for (const item of answer.reviewers) {
            reviewer.append(el('option', { value: item.id, text: item.name }));
          }
        });
      const form = el('form', {
        onsubmit: async (event: Event) => {
          event.preventDefault();
          clearProblem();
          assign.disabled = true;
          announce('Assigning segments.');
          try {
            const answer = await api.post<Assignment>(`/api/projects/${project.slug}/assignments`, {
              reviewer_id: reviewer.value,
              branch: branch.value,
              language: language.value,
            });
            const name = reviewer.selectedOptions[0]?.textContent ?? '';
            announce(
              `Assigned ${answer.segment_ids.length} segments to ${name} until ${localTime(answer.expires_at)}.`,
            );
            handle.close();
          } catch (error) {
            assign.disabled = false;
            announce('');
            if (error instanceof DeskError) {
              problem(failureCopy(error, { branch: branch.value, language: language.value }));
              showFieldErrors(form, error.info.fields);
            }
          }
        },
      }, [
        el('h2', { text: 'Assign review' }),
        labelledField('Reviewer', reviewer),
        labelledField('Branch', branch),
        labelledField('Language', language),
        el('div', { class: 'dialog-actions' }, [
          assign,
          el('button', { type: 'button', class: 'button quiet', text: 'Cancel', onclick: () => handle.close() }),
        ]),
      ]);
      return [form];
    },
  });
}

function openPublishDialog(project: Project, opener: HTMLElement): void {
  openModal({
    name: 'Publish',
    opener,
    body: (handle) => {
      const branch = branchSelect(project, 'Branch');
      const publish = el('button', { type: 'submit', class: 'button primary', text: 'Publish to repository' });
      const form = el('form', {
        onsubmit: async (event: Event) => {
          event.preventDefault();
          clearProblem();
          publish.disabled = true;
          announce('Publish queued.');
          try {
            const answer = await api.post<Publish>(
              `/api/projects/${project.slug}/publishes`,
              { branch: branch.value },
              { 'Idempotency-Key': `publish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
            );
            handle.close();
            const host = document.querySelector<HTMLElement>('[aria-label="Publish status"]');
            if (host) void watchPublish(host, project, answer.id);
          } catch (error) {
            publish.disabled = false;
            announce('');
            if (error instanceof DeskError) {
              problem(failureCopy(error));
              showFieldErrors(form, error.info.fields);
            }
          }
        },
      }, [
        el('h2', { text: 'Publish' }),
        labelledField('Branch', branch),
        el('div', { class: 'dialog-actions' }, [
          publish,
          el('button', { type: 'button', class: 'button quiet', text: 'Cancel', onclick: () => handle.close() }),
        ]),
      ]);
      return [form];
    },
  });
}

export async function paintLatestPublish(host: HTMLElement, project: Project, poll: boolean): Promise<void> {
  const answer = await api.get<{ publishes: Publish[] }>(`/api/projects/${project.slug}/publishes`);
  const newest = answer.publishes[0];
  if (!newest) return;
  paintPublish(host, newest);
  if (poll && (newest.state === 'queued' || newest.state === 'awaiting_host_confirmation')) {
    void watchPublish(host, project, newest.id);
  }
}

// watchPublish checks a publish every 2 seconds until it is published or failed.
async function watchPublish(host: HTMLElement, project: Project, publishID: string): Promise<void> {
  const tick = async (): Promise<void> => {
    let publish: Publish;
    try {
      publish = await api.get<Publish>(`/api/projects/${project.slug}/publishes/${publishID}`);
    } catch {
      return;
    }
    paintPublish(host, publish);
    if (publish.state === 'awaiting_host_confirmation') {
      announce('Waiting for the repository host to confirm the pull request.');
    }
    if (publish.state === 'published') {
      announce(`Published as pull request #${publish.pull_request?.number ?? 0}.`);
      return;
    }
    if (publish.state === 'failed') {
      problem(publishFailureCopy(publish.failure_reason));
      return;
    }
    window.setTimeout(() => void tick(), 2000);
  };
  await tick();
}

function paintPublish(host: HTMLElement, publish: Publish): void {
  clear(host);
  const line =
    publish.state === 'published' && publish.pull_request
      ? `Published as pull request #${publish.pull_request.number}.`
      : publish.state === 'failed'
        ? publishFailureCopy(publish.failure_reason)
        : '';
  host.append(
    el('div', { class: 'card publish-card' }, [
      el('h2', { text: 'Publish status' }),
      el('p', {}, [`Branch ${publish.branch}: `, statusTag(publish.state)]),
      line ? el('p', { text: line }) : null,
    ]),
  );
}
