import { api } from './api';
import { h, chip, CSS } from './ui';
import { navigate, encodeReturn, type Route } from './router';
import { loadMe, errorSummary, fieldErrorsFromApi, signOut, type Me } from './auth';
import { toolbar, setWorkspaceContext, apiGet } from './chrome';
import { COPY } from '../bench/copy';
import { ACTIVITY_PHRASES, type ActivityAction } from '../bench/activity';
import { StageRenderer } from './render';

// ---------- landing ----------

export function landingScreen(root: HTMLElement): void {
  document.title = 'Rampwright';
  const style = h('style', {}, CSS);
  document.head.append(style);
  const sectionIds = ['s1', 's2', 's3', 's4'];
  const headings = [
    null,
    'Every number in metres, kilograms and seconds',
    'The same run on every student\'s screen',
    'Stop, and the bench is exactly as you left it',
  ];

  const stageHost = h('div', { style: { position: 'fixed', inset: '0', zIndex: '1' } });
  let renderer: StageRenderer | null = null;
  let webglOk = true;
  try {
    const canvas = h('canvas', { class: 'stage-canvas' }) as HTMLCanvasElement;
    stageHost.append(canvas);
    renderer = new StageRenderer(canvas);
  } catch {
    webglOk = false;
    stageHost.append(h('div', { style: { position: 'absolute', inset: '0', background: 'linear-gradient(#8fc7ee 0 60%, #6fae6e 60% 100%)' } }));
    stageHost.append(h('div', { style: { position: 'absolute', left: '10%', bottom: '30%', color: '#1b2140', fontWeight: 700 } }, 'Rampwright still picture'));
  }

  const img: HTMLElement = webglOk
    ? stageHost
    : h('img', { src: '/static/landing-fallback.png', alt: 'Bench preview', style: { position: 'fixed', inset: '0', width: '100%', height: '100%', objectFit: 'cover', zIndex: '1' } });
  img.setAttribute('role', 'img');
  img.setAttribute('aria-label', 'Bench preview');
  img.setAttribute('data-progress', '0.000');

  const page = h('div', { class: 'app-root', style: { position: 'relative', zIndex: '2' } });
  const sections: HTMLElement[] = [];
  for (let i = 0; i < 4; i++) {
    const section = h('section', { id: sectionIds[i], class: 'landing-section', style: { display: 'flex', alignItems: i === 0 ? 'flex-end' : 'center' } });
    const copy = h('div', { class: 'landing-copy' });
    if (i === 0) {
      copy.append(
        h('h1', { style: { fontSize: '42px', margin: '0 0 8px', fontWeight: 800 } }, 'Rampwright'),
        h('p', {}, 'Build physics benches in real SI units. Run them, share them, publish them.'),
        h('div', { style: { display: 'flex', gap: '10px', marginTop: '10px' } },
          h('a', { href: '/sign-up', role: 'link', 'aria-label': 'Start a bench', style: linkStyle() }, 'Start a bench'),
          h('a', { href: '/sign-in', role: 'link', 'aria-label': 'Sign in', style: linkStyle() }, 'Sign in')),
      );
    } else {
      copy.append(h('h2', { style: { marginTop: '0' } }, headings[i]!));
      copy.append(h('p', {}, [
        'Scenes are authored in metres, kilograms and seconds with derived readouts live as you type.',
        'Every student sees the same fixed-step run on any device.',
        'Stop returns the bench exactly as it was left, hash for hash.',
      ][i - 1]!));
      if (i === 3) {
        copy.append(h('a', { href: '/sign-up', role: 'link', 'aria-label': 'Start a bench', style: linkStyle() }, 'Start a bench'));
      }
    }
    section.append(copy);
    sections.push(section);
  }
  sections[3]!.style.minHeight = '100vh';
  page.append(...sections);
  root.append(img === stageHost ? stageHost : img, page);

  const benchToolbar = buildBenchToolbar();
  benchToolbar.style.position = 'fixed';
  benchToolbar.style.top = '0';
  benchToolbar.style.left = '0';
  benchToolbar.style.right = '0';
  benchToolbar.style.zIndex = '4';
  benchToolbar.style.opacity = '0';
  benchToolbar.style.display = 'flex';
  root.append(benchToolbar);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nameEl = h('h1', { class: 'landing-name' }, 'Rampwright');
  nameEl.setAttribute('aria-label', 'Rampwright');
  page.append(nameEl);

  const render = (): void => {
    const scroll = window.scrollY;
    const progress = Math.min(1, Math.max(0, scroll / 3000));
    let shown: string;
    if (reduced) {
      const anchor = scroll < 1000 ? 0 : scroll < 2000 ? 1 : scroll < 3000 ? 2 : 3;
      shown = ['0.000', '0.333', '0.667', '1.000'][anchor]!;
    } else {
      shown = progress.toFixed(3);
    }
    img.setAttribute('data-progress', shown);
    if (renderer) {
      const p = reduced ? Number(['0', '0.3333', '0.6666', '1'][scroll < 1000 ? 0 : scroll < 2000 ? 1 : scroll < 3000 ? 2 : 3]!) : progress;
      drawLanding(renderer, p);
    }
    benchToolbar.style.opacity = String(reduced ? (scroll >= 3000 ? 1 : 0) : progress >= 0.9 ? 1 : progress > 0.85 ? ((progress - 0.85) / 0.05) * 0.99 : 0);
  };
  window.addEventListener('scroll', render, { passive: true });
  window.addEventListener('resize', render);
  render();
}

function linkStyle(): string {
  return 'display:inline-block;padding:6px 14px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--ink);text-decoration:none;font-weight:600';
}

function buildBenchToolbar(): HTMLElement {
  const tb = h('div', { class: 'bench-toolbar', role: 'toolbar', 'aria-label': 'Bench tools' });
  tb.append(chip('Run', { disabled: true }), chip('Pause', { disabled: true }), chip('Step', { disabled: true }));
  tb.append(chip('Move', { pressed: true }));
  tb.append(chip('Snap'), chip('Grid'));
  tb.append(chip('Labs', { extraClass: 'publish-chip', disabled: true }), chip('Assets', { extraClass: 'publish-chip', disabled: true }), chip('Share', { extraClass: 'publish-chip', disabled: true }), chip('Publish', { extraClass: 'publish-chip', disabled: true }));
  tb.append(h('span', { class: 'wordmark' }, 'Rampwright'));
  return tb;
}

function drawLanding(r: StageRenderer, progress: number): void {
  // cart 0 -> 1 over [0,1/3]; pendulum swing over [1/3,2/3]; camera rises in [2/3,1]
  const p1 = clamp01(progress / (1 / 3));
  const p2 = clamp01((progress - 1 / 3) / (1 / 3));
  const p3 = clamp01((progress - 2 / 3) / (1 / 3));
  const cartT = easeInOut(p1);
  const pendAngle = -0.35 + 0.7 * easeInOut(Math.abs(Math.sin(Math.PI * p2)));
  r.camera.yaw = 0.9 + p2 * (Math.PI / 2);
  r.camera.pitch = 0.6 + p3 * 0.5;
  r.camera.distance = 14 - p3 * 3;
  const doc = {
    gravity: 9.81,
    name: 'landing',
    objects: [
      {
        id: 'ramp-1', kind: 'ramp' as const, name: 'Ramp 1',
        params: { mass_kg: 1, angle_deg: 25, length_m: 5, friction: 0 },
        position: [-2, 0, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
        scale: [1, 1, 1] as [number, number, number], assetId: null,
      },
      {
        id: 'cart-1', kind: 'crate' as const, name: 'Cart 1',
        params: { mass_kg: 1 },
        position: [-2 + 4.5 * cartT, 2.1 - 2.1 * cartT, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
        scale: [0.5, 0.35, 0.4] as [number, number, number], assetId: null,
      },
      {
        id: 'pendulum-1', kind: 'pendulum' as const, name: 'Pendulum 1',
        params: { mass_kg: 0.5, length_m: 2, release_deg: (pendAngle * 180) / Math.PI + 20 },
        position: [3, 3, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
        scale: [1, 1, 1] as [number, number, number], assetId: null,
      },
    ],
    solver: { iterations: 4 as const, step: '1/120' as const },
  };
  r.draw(doc, false, null);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

// ---------- sign-in / sign-up ----------

export function signInScreen(root: HTMLElement, route: Route & { name: 'sign-in' }): void {
  document.title = 'Sign in - Rampwright';
  const errs: Array<{ key: string; message: string }> = [];
  const email = h('input', { type: 'text', id: 'f-email', 'aria-label': 'Email', autocomplete: 'email' }) as HTMLInputElement;
  const password = h('input', { type: 'password', id: 'f-password', 'aria-label': 'Password', autocomplete: 'current-password' }) as HTMLInputElement;
  const alertBox = h('div', {});
  const form = h('form', { onsubmit: async (e: Event) => {
    e.preventDefault();
    errs.length = 0;
    alertBox.replaceChildren();
    const body: Record<string, string> = { email: email.value, password: password.value };
    if (route.invite) body.invite = route.invite;
    if (route.return) body.return = decodeReturn(route.return);
    const result = await api('POST', '/api/auth/sign-in', body);
    if (!result.ok) {
      for (const err of fieldErrorsFromApi(result.error)) errs.push(err);
      const summary = errorSummary(errs, (key) => {
        (key === 'email' ? email : password).focus();
      });
      if (summary) alertBox.replaceChildren(summary);
      return;
    }
    const landing = (result.body as { landing: string }).landing;
    navigate(landing, true);
  } });
  form.append(
    alertBox,
    fieldLine('Email', email),
    fieldLine('Password', password),
    h('button', { class: 'chip', type: 'submit' }, 'Sign in'),
  );
  const panel = h('div', { class: 'dock-panel', style: { width: 'min(760px, calc(100% - 24px))', margin: '10vh auto 0', padding: '14px' } },
    h('h1', { style: { fontSize: '18px' } }, 'Sign in'),
    form,
    h('p', {}, h('a', { href: '/sign-up' }, 'Create an account')),
  );
  root.append(panel);
}

function decodeReturn(value: string): string {
  // the query param already came decoded; the server decodes once more
  return value;
}

export function signUpScreen(root: HTMLElement, route: Route & { name: 'sign-up' }): void {
  document.title = 'Create account - Rampwright';
  const displayName = h('input', { type: 'text', 'aria-label': 'Display name', autocomplete: 'name' }) as HTMLInputElement;
  const email = h('input', { type: 'text', 'aria-label': 'Email', autocomplete: 'email' }) as HTMLInputElement;
  const password = h('input', { type: 'password', 'aria-label': 'Password', autocomplete: 'new-password' }) as HTMLInputElement;
  const alertBox = h('div', {});
  const form = h('form', { onsubmit: async (e: Event) => {
    e.preventDefault();
    alertBox.replaceChildren();
    const body: Record<string, string> = {
      displayName: displayName.value,
      email: email.value,
      password: password.value,
    };
    if (route.invite) body.invite = route.invite;
    const result = await api('POST', '/api/auth/sign-up', body);
    if (!result.ok) {
      const errs = fieldErrorsFromApi(result.error);
      const summary = errorSummary(errs, (key) => {
        ({ displayName, email, password })[key]?.focus();
      });
      if (summary) alertBox.replaceChildren(summary);
      return;
    }
    const landing = (result.body as { landing: string }).landing;
    navigate(landing, true);
  } });
  form.append(
    alertBox,
    fieldLine('Display name', displayName),
    fieldLine('Email', email),
    fieldLine('Password', password),
    h('button', { class: 'chip', type: 'submit' }, 'Create account'),
  );
  root.append(h('div', { class: 'dock-panel', style: { width: 'min(760px, calc(100% - 24px))', margin: '10vh auto 0', padding: '14px' } },
    h('h1', { style: { fontSize: '18px' } }, 'Create account'),
    form,
    h('p', {}, h('a', { href: '/sign-in' }, 'Sign in')),
  ));
}

function fieldLine(label: string, input: HTMLElement): HTMLElement {
  const line = h('div', { class: 'field-line' });
  const labelEl = h('label', { class: 'field-label', for: input.id || undefined }, label);
  input.id = input.id || `f-${label.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  labelEl.setAttribute('for', input.id);
  line.append(labelEl, input);
  return line;
}

// ---------- workspaces ----------

export function newWorkspaceScreen(root: HTMLElement): void {
  document.title = 'New workspace - Rampwright';
  const name = h('input', { type: 'text', 'aria-label': 'Workspace name' }) as HTMLInputElement;
  const alertBox = h('div', {});
  const form = h('form', { onsubmit: async (e: Event) => {
    e.preventDefault();
    alertBox.replaceChildren();
    const result = await api('POST', '/api/workspaces', { name: name.value });
    if (!result.ok) {
      const summary = errorSummary(fieldErrorsFromApi(result.error), () => name.focus());
      if (summary) alertBox.replaceChildren(summary);
      return;
    }
    const ws = (result.body as { workspace: { id: string } }).workspace;
    navigate(`/w/${ws.id}`, true);
  } });
  form.append(alertBox, fieldLine('Workspace name', name), h('button', { class: 'chip', type: 'submit' }, 'Create workspace'));
  root.append(h('div', { class: 'dock-panel', style: { width: 'min(760px, calc(100% - 24px))', margin: '10vh auto 0', padding: '14px' } },
    h('h1', { style: { fontSize: '18px' } }, 'New workspace'),
    form,
  ));
}

export function workspaceScreen(root: HTMLElement, route: Route & { name: 'workspace' }): void {
  setWorkspaceContext(route.wid);
  document.title = 'Workspace - Rampwright';
  const projectsRegion = h('div', { role: 'region', 'aria-label': 'Projects' });
  root.append(projectsRegion);
  void (async () => {
    const me = await loadMe();
    if (!me) { navigate(`/sign-in?return=${encodeReturn(location.pathname, location.search)}`); return; }
    root.prepend(toolbar(me, {}).root);
    const data = await apiGet<{ projects: Array<{ id: string; name: string; sceneCount: number; assetCount: number; updatedAt: string }>; role: string }>(`/api/workspaces/${route.wid}/projects`);
    if (!data.data) {
      if (data.error?.status === 404) { notFoundScreen(root); root.querySelector('.bench-toolbar')?.remove(); return; }
      return;
    }
    const role = await apiGet<{ workspace: { id: string; name: string; role: string } }>(`/api/workspaces/${route.wid}`);
    const canEdit = role.data?.workspace.role !== 'viewer';
    const projects = data.data.projects;
    const list = h('ul', { style: { listStyle: 'none', padding: '0', margin: '0' } });
    if (projects.length === 0) {
      list.append(h('li', { class: 'empty-state' }, COPY.empty.projects));
    }
    for (const p of projects) {
      list.append(h('li', {}, h('a', { href: `/w/${route.wid}/p/${p.id}` }, p.name), h('span', { class: 'muted' }, ` ${p.sceneCount} scenes · ${p.assetCount} assets`)));
    }
    const nameInput = h('input', { type: 'text', 'aria-label': 'Project name' }) as HTMLInputElement;
    const createBtn = chip('Create project', { disabled: !canEdit, onClick: async () => {
      const result = await api('POST', `/api/workspaces/${route.wid}/projects`, { name: nameInput.value });
      if (result.ok) {
        const p = (result.body as { project: { id: string } }).project;
        navigate(`/w/${route.wid}/p/${p.id}`, true);
      }
    } });
    projectsRegion.append(
      h('div', { class: 'dock-panel', style: { width: 'min(760px, calc(100% - 24px))', margin: '24px auto', padding: '14px' } },
        h('h1', { style: { fontSize: '16px', margin: '0 0 8px' } }, 'Projects'),
        list,
        h('div', { class: 'field-line', style: { marginTop: '10px' } }, nameInput, createBtn, chip('New project', { disabled: !canEdit, onClick: () => nameInput.focus() })),
        h('div', { style: { marginTop: '10px', display: 'flex', gap: '8px' } },
          h('a', { href: `/w/${route.wid}/settings` }, 'Settings'),
          h('a', { href: `/w/${route.wid}/activity` }, 'Activity'),
        ),
      ),
    );
  })();
}

export function projectScreen(root: HTMLElement, route: Route & { name: 'project' }): void {
  setWorkspaceContext(route.wid);
  document.title = 'Project - Rampwright';
  const scenesRegion = h('div', { role: 'region', 'aria-label': 'Scenes' });
  root.append(scenesRegion);
  void (async () => {
    const me = await loadMe();
    if (!me) { navigate(`/sign-in?return=${encodeReturn(location.pathname, location.search)}`); return; }
    root.prepend(toolbar(me, {}).root);
    const data = await apiGet<{ project: { name: string }; scenes: Array<{ id: string; name: string; status: string; revision: number }>; workspaceId: string }>(`/api/projects/${route.pid}`);
    if (!data.data) {
      notFoundScreen(root);
      return;
    }
    const wsData = await apiGet<{ workspace: { role: string } }>(`/api/workspaces/${route.wid}`);
    const canEdit = wsData.data?.workspace.role === 'owner' || wsData.data?.workspace.role === 'editor';
    const scenes = data.data.scenes;
    const list = h('ul', { style: { listStyle: 'none', padding: '0', margin: '0' } });
    if (scenes.length === 0) list.append(h('li', { class: 'empty-state' }, COPY.empty.scenes));
    for (const s of scenes) {
      const chipClass = s.status === 'published' ? 'publish-chip' : '';
      list.append(h('li', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        h('a', { href: `/w/${route.wid}/s/${s.id}` }, s.name),
        h('span', { class: `chip ${chipClass}`, style: { pointerEvents: 'none' } }, s.status.charAt(0).toUpperCase() + s.status.slice(1)),
      ));
    }
    const newScene = chip('New scene', { disabled: !canEdit, onClick: () => {
      let nameInput: HTMLInputElement;
      const nameField = h('input', { type: 'text', 'aria-label': 'Scene name' }) as HTMLInputElement;
      nameInput = nameField;
      const templateRadios = ['Blank', 'Ramp', 'Pendulum', 'Launcher'].map((t, i) => {
        const id = `tpl-${t.toLowerCase()}`;
        const input = h('input', { type: 'radio', id, name: 'template', value: t.toLowerCase(), ...(i === 0 ? { checked: true } : {}) }) as HTMLInputElement;
        const wrap = h('label', { for: id }, input, ` ${t}`);
        return wrap;
      });
      const dialog = h('div', { class: 'dialog-backdrop' });
      const panel = h('div', { class: 'dialog', role: 'dialog', 'aria-label': 'New scene' },
        h('h2', {}, 'New scene'),
        fieldLine('Scene name', nameField),
        h('div', {}, ...templateRadios),
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'chip', onclick: () => dialog.remove() }, 'Cancel'),
          h('button', { class: 'chip', onclick: async () => {
            const template = (dialog.querySelector('input[name="template"]:checked') as HTMLInputElement | null)?.value ?? 'blank';
            const result = await api('POST', `/api/projects/${route.pid}/scenes`, { name: nameField.value, template });
            if (result.ok) {
              const scene = (result.body as { scene: { id: string } }).scene;
              dialog.remove();
              navigate(`/w/${route.wid}/s/${scene.id}`, true);
            }
          } }, 'Create scene'),
        ),
      );
      dialog.append(panel);
      dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });
      document.body.append(dialog);
      nameField.focus();
    } });
    scenesRegion.append(
      h('div', { class: 'dock-panel', style: { width: 'min(760px, calc(100% - 24px))', margin: '24px auto', padding: '14px' } },
        h('h1', { style: { fontSize: '16px', margin: '0 0 8px' } }, data.data.project.name),
        list,
        h('div', { style: { marginTop: '10px' } }, newScene),
      ),
    );
  })();
}

// ---------- settings ----------

export function settingsScreen(root: HTMLElement, route: Route & { name: 'settings' }): void {
  const noticeHost = h('div', {});
  const notice = (text: string): void => {
    const status = h('div', { role: 'status', 'aria-live': 'polite' }, text);
    status.style.cssText = 'position:fixed;bottom:12px;right:12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:6px 10px;z-index:200';
    document.body.append(status);
    setTimeout(() => status.remove(), 4000);
  };
  setWorkspaceContext(route.wid);
  document.title = 'Settings - Rampwright';
  const wrap = h('div', {});
  root.append(wrap);
  void (async () => {
    const me = await loadMe();
    if (!me) { navigate(`/sign-in?return=${encodeReturn(location.pathname, location.search)}`); return; }
    root.prepend(toolbar(me, {}).root);
    const data = await apiGet<{ workspace: { id: string; name: string; role: string }; members: Array<{ userId: string; displayName: string; email: string; role: string }>; invites: Array<{ id: string; email: string; role: string; status: string; expiresAt: string }> }>(`/api/workspaces/${route.wid}`);
    if (!data.data) { notFoundScreen(root); return; }
    const isOwner = data.data.workspace.role === 'owner';
    const membersTable = h('table', { class: 'bench', role: 'table', 'aria-label': 'Members' });
    membersTable.append(h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Email'), h('th', {}, 'Role'))));
    const tbody = h('tbody', {});
    for (const m of data.data.members) {
      const row = h('tr', {});
      row.append(h('td', {}, m.displayName), h('td', {}, m.email));
      if (m.role === 'owner') {
        row.append(h('td', {}, 'Owner'));
      } else {
        const select = h('select', { 'aria-label': `Role for ${m.displayName}`, ...(isOwner ? {} : { disabled: true }) }) as HTMLSelectElement;
        for (const role of ['editor', 'viewer']) {
          const option = document.createElement('option');
          option.value = role;
          option.textContent = role === 'editor' ? 'Editor' : 'Viewer';
          if (m.role === role) option.selected = true;
          select.append(option);
        }
        select.addEventListener('change', async () => {
          const result = await api('PATCH', `/api/workspaces/${route.wid}/members/${m.userId}`, { role: select.value });
          if (result.ok) {
            notice(` ${m.displayName} is now ${select.value === 'editor' ? 'Editor' : 'Viewer'}`);
          }
        });
        row.append(h('td', {}, select));
      }
      tbody.append(row);
    }
    membersTable.append(tbody);

    const inviteEmail = h('input', { type: 'text', 'aria-label': 'Invite email' }) as HTMLInputElement;
    const inviteRole = h('select', { 'aria-label': 'Invite role' }) as HTMLSelectElement;
    for (const role of ['editor', 'viewer']) {
      inviteRole.append(h('option', { value: role }, role === 'editor' ? 'Editor' : 'Viewer'));
    }
    const sendInvite = chip('Send invite', { disabled: !isOwner, onClick: async () => {
      const result = await api('POST', `/api/workspaces/${route.wid}/invites`, { email: inviteEmail.value, role: inviteRole.value });
      if (result.ok) {
        const body = result.body as { delivery: string; invite: { email: string } };
        notice(body.delivery === 'sent' ? `Invite sent to ${body.invite.email}` : `Invite saved for ${body.invite.email}. The email will go out when mail is back.`);
        settingsScreenRefresh();
      } else if (result.error.fields) {
        const summary = errorSummary(fieldErrorsFromApi(result.error), () => inviteEmail.focus());
        if (summary) noticeHost.replaceChildren(summary);
      }
    } });

    const pendingTable = h('table', { class: 'bench', role: 'table', 'aria-label': 'Pending invites' });
    pendingTable.append(h('thead', {}, h('tr', {}, h('th', {}, 'Email'), h('th', {}, 'Role'), h('th', {}, ''))));
    const pendingBody = h('tbody', {});
    for (const inv of data.data.invites) {
      const row = h('tr', {});
      row.append(h('td', {}, inv.email), h('td', {}, inv.role === 'editor' ? 'Editor' : 'Viewer'));
      row.append(h('td', {}, chip(`Revoke invite to ${inv.email}`, { disabled: !isOwner, onClick: async () => {
        const result = await api('DELETE', `/api/workspaces/${route.wid}/invites/${inv.id}`);
        if (result.ok) {
          notice(`Invite to ${inv.email} revoked`);
          settingsScreenRefresh();
        }
      } })));
      pendingBody.append(row);
    }
    pendingTable.append(pendingBody);

    wrap.replaceChildren(
      h('div', { class: 'dock-panel', style: { width: 'min(760px, calc(100% - 24px))', margin: '24px auto', padding: '14px' } },
        h('h1', { style: { fontSize: '16px', margin: '0 0 8px' } }, data.data.workspace.name),
        membersTable,
        h('div', { class: 'field-line', style: { marginTop: '12px' } }, inviteEmail, inviteRole, sendInvite),
        noticeHost,
        h('h2', { style: { fontSize: '13px', margin: '16px 0 6px' } }, 'Pending invites'),
        pendingTable,
      ),
    );
  })();
  const settingsScreenRefresh = (): void => {
    root.querySelectorAll('.dock-panel').forEach((p) => p.remove());
    settingsScreen(root, route);
  };
}

// ---------- activity ----------

export function activityScreen(root: HTMLElement, route: Route & { name: 'activity' }): void {
  setWorkspaceContext(route.wid);
  document.title = 'Activity - Rampwright';
  const host = h('div', {});
  root.append(host);
  let shown = 0;
  let nextBefore: string | null = null;
  let loading = false;
  const list = h('ul', { role: 'list', 'aria-label': 'Activity', style: { listStyle: 'none', padding: '0', margin: '0' } });
  const status = h('div', { role: 'status', 'aria-live': 'polite' }, COPY.loading);
  const olderBtn = chip('Show older', { onClick: () => { void loadPage(); } });

  async function loadPage(): Promise<void> {
    if (loading) return;
    loading = true;
    status.textContent = COPY.loading;
    const query = nextBefore ? `?limit=50&before=${nextBefore}` : '?limit=50';
    const result = await api('GET', `/api/workspaces/${route.wid}/activity${query}`);
    loading = false;
    if (!result.ok) return;
    const body = result.body as { events: ActivityEvent[]; nextBefore: string | null };
    for (const event of body.events) {
      const li = h('li', {}, `${event.actor.displayName} ${ACTIVITY_PHRASES[event.action as ActivityAction] ?? ''} ${event.targetName}`);
      const time = h('time', { datetime: event.at }, formatLocalTime(event.at));
      li.append(' ', time);
      list.append(li);
    }
    shown += body.events.length;
    nextBefore = body.nextBefore;
    status.textContent = `Showing ${shown} events`;
    if (nextBefore === null) olderBtn.remove();
    if (body.events.length === 0 && shown === 0) {
      list.append(h('li', { class: 'empty-state' }, COPY.empty.activity));
    }
  }

  void (async () => {
    const me = await loadMe();
    if (!me) { navigate(`/sign-in?return=${encodeReturn(location.pathname, location.search)}`); return; }
    root.prepend(toolbar(me, {}).root);
    host.append(h('div', { class: 'dock-panel', style: { width: 'min(760px, calc(100% - 24px))', margin: '24px auto', padding: '14px' } },
      h('h1', { style: { fontSize: '16px', margin: '0 0 8px' } }, 'Activity'),
      list,
      h('div', { style: { marginTop: '8px' } }, olderBtn),
      status,
    ));
    await loadPage();
  })();
}

export type ActivityEvent = {
  id: string;
  at: string;
  actor: { userId: string; displayName: string };
  action: string;
  targetName: string;
};

function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- invite ----------

export function inviteScreen(root: HTMLElement, route: Route & { name: 'invite' }): void {
  document.title = 'Invite - Rampwright';
  const host = h('div', {});
  root.append(host);
  void (async () => {
    const result = await api('GET', `/api/invites/${route.token}`);
    if (!result.ok) {
      const code = result.error.code;
      const copy = code === 'invite_superseded' ? COPY.inviteStates.superseded
        : code === 'not_found' ? COPY.pages.notFound
        : 'This invite is unavailable.';
      host.append(h('div', { class: 'dock-panel', style: { width: 'min(760px, calc(100% - 24px))', margin: '10vh auto', padding: '14px' } },
        h('h1', { style: { fontSize: '18px' } }, copy)));
      return;
    }
    const body = result.body as { invite: { workspaceName: string; email: string; role: string; status: string; reason: string | null } };
    const invite = body.invite;
    if (invite.status !== 'pending') {
      const copy = invite.status === 'expired' ? COPY.inviteStates.expired
        : invite.status === 'revoked' ? COPY.inviteStates.revoked
        : invite.status === 'superseded' ? COPY.inviteStates.superseded
        : COPY.inviteStates.used;
      host.append(h('div', { class: 'dock-panel', style: { width: 'min(760px, calc(100% - 24px))', margin: '10vh auto', padding: '14px' } },
        h('h1', { style: { fontSize: '18px' } }, copy)));
      return;
    }
    const me = await loadMe();
    const mismatched = me !== null && me.user.email.trim().toLowerCase() !== invite.email.trim().toLowerCase();
    const accept = chip('Accept invite', { onClick: async () => {
      const res = await api('POST', `/api/invites/${route.token}/accept`, {});
      if (res.ok) {
        const landing = (res.body as { landing: string }).landing;
        navigate(landing, true);
      } else if (res.error.code === 'unauthenticated') {
        navigate(`/sign-in?invite=${route.token}`);
      }
    } });
    const heading = `Join ${invite.workspaceName}`;
    host.append(h('div', { class: 'dock-panel', style: { width: 'min(760px, calc(100% - 24px))', margin: '10vh auto', padding: '14px' } },
      h('h1', { style: { fontSize: '18px' } }, heading),
      h('p', {}, `Invited as ${invite.role === 'editor' ? 'Editor' : 'Viewer'} for ${invite.email}`),
      mismatched ? h('p', { class: 'field-error' }, COPY.inviteStates.mismatch(invite.email)) : null,
      me === null
        ? h('div', { style: { display: 'flex', gap: '10px' } },
            h('a', { href: `/sign-in?invite=${route.token}`, role: 'link', 'aria-label': 'Sign in', style: linkStyle() }, 'Sign in'),
            h('a', { href: `/sign-up?invite=${route.token}`, role: 'link', 'aria-label': 'Create account', style: linkStyle() }, 'Create account'))
        : accept,
    ));
  })();
}

// ---------- not found ----------

export function notFoundScreen(root: HTMLElement): void {
  document.title = 'Not found - Rampwright';
  root.append(h('div', { class: 'dock-panel', style: { width: 'min(760px, calc(100% - 24px))', margin: '10vh auto', padding: '14px' } },
    h('h1', { style: { fontSize: '18px' } }, COPY.pages.notFound)));
}

export { signOut };
