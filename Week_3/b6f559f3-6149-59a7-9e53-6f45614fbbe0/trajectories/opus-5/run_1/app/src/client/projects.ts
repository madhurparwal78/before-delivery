import { api, RequestFailed } from './api';
import type { ProjectSummary } from './api';
import { clear, el, labelledInput, openDialog } from './dom';
import { appState, link, navigate, panel, workspaceFooter, workspaceHeader } from './shell';
import { StageView } from './stage-view';
import { config } from './client-config';
import { copy, MSG } from '../shared/messages';
import { formatDate, plural } from '../shared/format';
import type { SceneDocument } from '../shared/types';
import { demoDocument } from './demo-scene';

function thumbnail(project: ProjectSummary): HTMLElement {
  const view = new StageView();
  view.setArtboard(1440, 810);
  view.element.style.position = 'relative';
  const holder = view.element;
  const draw = (document_: SceneDocument, live: boolean): void => {
    view.draw(
      {
        document: document_,
        sceneId: document_.scenes[0].id,
        frame: live ? 36 : 0,
        breakpoint: 'desktop',
        scroll: 0,
        reducedMotion: !live,
        assets: {},
        particleMax: config().particleMax,
        imageUrl: (assetId) => `/api/assets/${assetId}/original`,
      },
      { level: live ? 1 : 0.3, focus: { x: 0.8, y: 0.9 } },
    );
  };
  if (project.liveVersion === null) {
    draw(demoDocument(), false);
  } else {
    void fetch(`/api/embed/${project.id}/scene`)
      .then((response) => (response.ok ? response.json() : null))
      .then((document_: SceneDocument | null) => {
        if (document_) draw(document_, true);
        else draw(demoDocument(), false);
      })
      .catch(() => draw(demoDocument(), false));
  }
  return holder;
}

function projectCard(project: ProjectSummary, reload: () => void): HTMLElement {
  const card = el('article', {
    class: 'project-card',
    'aria-label': project.name,
    'data-project-id': project.id,
    'data-layer-count': String(project.layerCount),
    'data-live-version': project.liveVersion === null ? '' : String(project.liveVersion),
    'data-editor-count': String(project.editorCount),
    'data-viewer-count': String(project.viewerCount),
  });
  card.append(
    thumbnail(project),
    el('h4', { text: project.name }),
    el('div', { class: 'project-meta' }, [
      el('span', { text: plural(project.layerCount, 'layer', 'layers') }),
      el('span', {
        text: project.liveVersion === null ? 'Not published' : `Live version ${project.liveVersion}`,
      }),
      el('span', {
        text: `${plural(project.editorCount, 'editor', 'editors')} · ${plural(
          project.viewerCount,
          'viewer',
          'viewers',
        )}`,
      }),
    ]),
  );
  const actions = el('div', { class: 'card-actions' }, [
    link(`Open ${project.name}`, `/projects/${project.id}`, 'button'),
  ]);
  if (project.role === 'Owner') {
    const trash = el('button', {
      type: 'button',
      class: 'button',
      text: 'Move to trash',
      'aria-label': `Move ${project.name} to trash`,
    });
    trash.addEventListener('click', () => {
      void api
        .trashProject(project.id)
        .then(() => reload())
        .catch(() => reload());
    });
    actions.append(trash);
  }
  card.append(actions);
  return card;
}

export async function renderProjects(root: HTMLElement): Promise<void> {
  if (!appState.me) {
    navigate('/signin');
    return;
  }
  let tab: 'active' | 'trashed' = 'active';
  const status = el('p', { role: 'status', class: 'status-line', 'aria-label': 'Editor status' });
  const notice = el('div');
  const content = el('div');

  const newProjectButton = el('button', { type: 'button', class: 'button primary', text: 'New project' });
  newProjectButton.addEventListener('click', () => {
    const workspace = appState.me?.workspaces.find((candidate) => candidate.role === 'Owner');
    openDialog({
      name: 'New project',
      opener: newProjectButton,
      content: (close) => {
        const name = labelledInput({ name: 'Project name' });
        const create = el('button', { type: 'button', class: 'button primary', text: 'Create project' });
        const error = el('div');
        create.addEventListener('click', () => {
          if (!workspace) return;
          void api
            .createProject(workspace.id, name.input.value.trim())
            .then((result) => {
              close();
              navigate(`/projects/${result.project.id}`);
            })
            .catch((failure: unknown) => {
              clear(error);
              error.append(
                el('div', {
                  role: 'alert',
                  class: 'notice',
                  text: failure instanceof RequestFailed ? failure.failure.message : MSG.enterName,
                }),
              );
            });
        });
        return el('div', { class: 'form-grid' }, [
          el('h3', { text: 'New project' }),
          name.wrapper,
          error,
          create,
        ]);
      },
    });
  });

  const importInput = el('input', {
    type: 'file',
    accept: 'application/json',
    class: 'visually-hidden',
    'aria-label': 'Choose JSON file',
  });
  const importButton = el('button', { type: 'button', class: 'button', text: 'Import JSON' });
  importButton.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (!file) return;
    const workspace = appState.me?.workspaces.find((candidate) => candidate.role === 'Owner');
    if (!workspace) return;
    status.textContent = copy.importing(file.name);
    clear(notice);
    void api
      .importJson(workspace.id, file)
      .then((result) => {
        status.textContent = copy.imported(result.project.name.replace(' (imported)', ''));
        void load();
      })
      .catch((failure: unknown) => {
        status.textContent = '';
        notice.append(
          el('div', {
            role: 'alert',
            class: 'notice',
            text: failure instanceof RequestFailed ? failure.failure.message : MSG.importNotJson,
          }),
        );
      });
  });

  const tabs = el('div', { role: 'tablist', 'aria-label': 'Projects', class: 'panel-tabs' });
  const tabButtons: Record<string, HTMLButtonElement> = {};
  for (const [key, label] of [
    ['active', 'Active'],
    ['trashed', 'Trash'],
  ] as const) {
    const node = el('button', {
      type: 'button',
      role: 'tab',
      class: 'tab',
      text: label,
      'aria-selected': key === 'active' ? 'true' : 'false',
    });
    node.addEventListener('click', () => {
      tab = key;
      for (const [name, item] of Object.entries(tabButtons)) {
        item.setAttribute('aria-selected', name === key ? 'true' : 'false');
      }
      void load();
    });
    tabButtons[key] = node;
    tabs.append(node);
  }

  const load = async (): Promise<void> => {
    const result = await api.projects(tab);
    clear(content);
    if (tab === 'trashed') {
      if (result.projects.length === 0) {
        content.append(el('p', { class: 'empty-state', text: 'The trash is empty.' }));
        return;
      }
      const list = el('ul', { class: 'list-reset' });
      for (const project of result.projects) {
        const item = el('li', { 'aria-label': project.name }, [
          el('span', {
            text: `${project.name} · purges on ${
              project.purgeAt ? formatDate(project.purgeAt, config().timeZone) : ''
            }`,
          }),
        ]);
        const restore = el('button', {
          type: 'button',
          class: 'button',
          text: 'Restore',
          'aria-label': `Restore ${project.name}`,
        });
        restore.addEventListener('click', () => {
          void api.restoreProject(project.id).then(() => {
            status.textContent = copy.restored(project.name);
            void load();
          });
        });
        item.append(restore);
        list.append(item);
      }
      content.append(list);
      return;
    }
    if (result.projects.length === 0) {
      content.append(el('p', { class: 'empty-state', text: 'No projects yet.' }));
      return;
    }
    content.append(
      el(
        'div',
        { class: 'project-grid' },
        result.projects.map((project) => projectCard(project, () => void load())),
      ),
    );
  };

  root.append(
    el('div', { class: 'frame' }, [
      workspaceHeader(),
      panel(null, [
        el('div', { class: 'card-actions' }, [tabs, newProjectButton, importButton, importInput]),
        status,
        notice,
        content,
      ]),
      workspaceFooter(),
    ]),
  );
  await load();
}

export function renderSignIn(root: HTMLElement): void {
  const email = labelledInput({ name: 'Email', type: 'email', autocomplete: 'email' });
  const password = labelledInput({ name: 'Password', type: 'password', autocomplete: 'current-password' });
  const submit = el('button', { type: 'submit', class: 'button primary', text: 'Sign in' });
  const alert = el('div');
  const form = el('form', { class: 'form-grid' }, [
    el('h2', { text: 'Sign in' }),
    email.wrapper,
    password.wrapper,
    alert,
    submit,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit.textContent = 'Signing in…';
    clear(alert);
    void api
      .signIn(email.input.value.trim(), password.input.value)
      .then(async () => {
        const me = await api.me();
        appState.me = me;
        navigate('/projects');
      })
      .catch((failure: unknown) => {
        submit.textContent = 'Sign in';
        alert.append(
          el('div', {
            role: 'alert',
            class: 'notice',
            text: failure instanceof RequestFailed ? failure.failure.message : MSG.badCredentials,
          }),
        );
      });
  });
  root.append(
    el('div', { class: 'frame' }, [
      workspaceHeader(),
      el('div', { class: 'centred-surface' }, [panel(null, [form])]),
      workspaceFooter(),
    ]),
  );
  email.input.focus();
}

export async function renderInvite(root: HTMLElement, token: string): Promise<void> {
  const body = el('div', { class: 'form-grid' });
  const container = el('div', { class: 'frame' }, [
    workspaceHeader(),
    el('div', { class: 'centred-surface' }, [panel(null, [body])]),
    workspaceFooter(),
  ]);
  root.append(container);
  try {
    const preview = await api.invitePreview(token);
    const name = labelledInput({ name: 'Your name' });
    const choose = labelledInput({ name: 'Choose a password', type: 'password' });
    const existing = labelledInput({ name: 'Password', type: 'password' });
    const accept = el('button', { type: 'button', class: 'button primary', text: 'Accept invite' });
    const alert = el('div');
    const signedInAs = appState.me?.user.email;
    body.append(el('h2', { text: `Join ${preview.projectName} as ${preview.role}` }));
    if (!signedInAs) {
      if (preview.accountExists) body.append(existing.wrapper);
      else body.append(name.wrapper, choose.wrapper);
    }
    body.append(alert, accept);
    accept.addEventListener('click', () => {
      accept.textContent = 'Joining…';
      clear(alert);
      const payload: Record<string, string> = signedInAs
        ? {}
        : preview.accountExists
          ? { password: existing.input.value }
          : { name: name.input.value.trim(), password: choose.input.value };
      void api
        .acceptInvite(token, payload)
        .then(async (result) => {
          appState.me = await api.me();
          navigate(`/projects/${result.projectId}`);
        })
        .catch((failure: unknown) => {
          accept.textContent = 'Accept invite';
          alert.append(
            el('div', {
              role: 'alert',
              class: 'notice',
              text: failure instanceof RequestFailed ? failure.failure.message : MSG.inviteUnavailable,
            }),
          );
        });
    });
  } catch (failure) {
    body.append(
      el('div', {
        role: 'alert',
        class: 'notice',
        text: failure instanceof RequestFailed ? failure.failure.message : MSG.inviteUnavailable,
      }),
    );
  }
}
