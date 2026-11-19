import { el, clear, announce } from './dom.js';
import { api } from './api.js';
import type { UserInfo, SetSummary, LayerDoc } from './api.js';
import { openDialogWith, closeActiveDialog } from './dialogs.js';
import { StageRenderer } from './stage.js';
import { emblem } from './icons.js';
import { renderSetEditor } from './editor/composer.js';
import { makeTransport } from './editor/context.js';

interface Route { page: 'public' | 'workspace' | 'set' | 'join' | 'show'; token?: string }

function parseRoute (): Route {
  const path = window.location.pathname;
  if (path.startsWith('/join/')) return { page: 'join', token: path.slice('/join/'.length) };
  if (path.startsWith('/show/')) return { page: 'show', token: path.slice('/show/'.length) };
  if (path === '/workspace') return { page: 'workspace' };
  if (path.startsWith('/sets/')) return { page: 'set', token: path.slice('/sets/'.length) };
  return { page: 'public' };
}

const navigate = (path: string): void => { window.history.pushState({}, '', path); void boot(); };

window.addEventListener('popstate', () => { void boot(); });

interface Shell {
  root: HTMLElement;
  statusRegions: Record<string, HTMLElement>;
}

let currentUser: UserInfo | null = null;

async function loadUser (): Promise<void> {
  const result = await api.get<{ user: UserInfo }>('/api/me');
  currentUser = result.ok ? result.body.user : null;
}

async function boot (): Promise<void> {
  await loadUser();
  const route = parseRoute();
  if (route.page === 'show' && route.token !== undefined) {
    renderShowPage(route.token);
    return;
  }
  if (route.page === 'public') {
    renderPublicPage();
    return;
  }
  if (currentUser === null) {
    renderPublicPage(true);
    return;
  }
  if (route.page === 'join' && route.token !== undefined) {
    renderJoinPage(route.token);
    return;
  }
  if (route.page === 'set' && route.token !== undefined) {
    await renderSetEditor(route.token, currentUser);
    return;
  }
  renderWorkspace();
}

// Status regions live once per page.
function makeStatusRegions (): Record<string, HTMLElement> {
  const regions: Record<string, HTMLElement> = {};
  for (const name of ['Autosave', 'Shader compile', 'Asset upload', 'Show status', 'Script status', 'Export status', 'Connection', 'Service status', 'Notifications']) {
    const node = el('div', { class: 'status-region', role: 'status', 'aria-live': 'polite', 'aria-label': name });
    regions[name] = node;
  }
  return regions;
}

function mountStatusRegions (parent: HTMLElement, regions: Record<string, HTMLElement>): void {
  for (const node of Object.values(regions)) parent.append(node);
}

const NO_WEBGL_COPY = "This browser can't draw the stage. Your set still saves.";

function makeStageCanvas (): { canvas: HTMLCanvasElement; renderer: StageRenderer | null } {
  const canvas = el('canvas', { class: 'stage-canvas' }) as unknown as HTMLCanvasElement;
  if (!StageRenderer.isSupported()) return { canvas, renderer: null };
  try {
    return { canvas, renderer: new StageRenderer(canvas) };
  } catch {
    return { canvas, renderer: null };
  }
}

// The demo set: built in the browser, never stored.
function buildDemoLayers (): LayerDoc[] {
  const camera: LayerDoc = {
    id: 'demo-camera', parent_id: null, index: 0, name: 'Demo camera', kind: 'camera', version: 1, visible: true,
    position: [0, 1.5, 6], rotation: [0, 0, 0], scale: [1, 1, 1], props: { fov: 60, near: 0.1, far: 200 },
    material: null, model_asset_id: null, output_buses: [], shader_version: null,
  };
  const tunnel: LayerDoc = {
    id: 'demo-tunnel', parent_id: null, index: 1, name: 'Tunnel', kind: 'tube', version: 1, visible: true,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [3, 3, 6], props: { twist: 0.35, radius: 2 },
    material: { tint: [0.35, 0.6, 0.9], tint_alpha: 0.85, albedo_texture_id: null, emissive_texture_id: null },
    model_asset_id: null, output_buses: ['main'], shader_version: null,
  };
  const cubes: LayerDoc[] = [];
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    cubes.push({
      id: `demo-cube-${i}`, parent_id: 'demo-field', index: i, name: `Cube ${i + 1}`, kind: 'cube', version: 1, visible: true,
      position: [Math.cos(angle) * 4, 0, Math.sin(angle) * 4],
      rotation: [0, angle * 180 / Math.PI, 0],
      scale: [0.5, 0.5, 0.5],
      props: {},
      material: { tint: [0.9, 0.7, 0.4], tint_alpha: 1, albedo_texture_id: null, emissive_texture_id: null },
      model_asset_id: null, output_buses: ['main'], shader_version: null,
    });
  }
  const group: LayerDoc = {
    id: 'demo-field', parent_id: null, index: 2, name: 'Cube field', kind: 'group', version: 1, visible: true,
    position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], props: {},
    material: null, model_asset_id: null, output_buses: [], shader_version: null,
  };
  return [camera, tunnel, group, ...cubes];
}

// Demo overrides animate the cube orbit (one lap per 8 beats) and ring twist.
function demoOverrides (beat: number): Map<string, Map<string, number>> {
  const overrides = new Map<string, Map<string, number>>();
  const lap = (beat % 8) / 8;
  const angle = lap * Math.PI * 2;
  for (let i = 0; i < 24; i++) {
    const cubeAngle = angle + (i / 24) * Math.PI * 2;
    overrides.set(`demo-cube-${i}`, new Map<string, number>([
      ['position.x', Math.cos(cubeAngle) * 4],
      ['position.z', Math.sin(cubeAngle) * 4],
    ]));
  }
  const twistMap = new Map<string, number>([['props.twist', 0.35 + Math.sin(beat * Math.PI * 2) * 0.2]]);
  overrides.set('demo-tunnel', twistMap);
  return overrides;
}

function renderPublicPage (promptSignIn = false): void {
  const regions = makeStatusRegions();
  const { canvas, renderer } = makeStageCanvas();
  const transport = makeTransport();
  const demoLayers = buildDemoLayers();

  const stageViewport = el('div', { class: 'stage-viewport' },
    renderer === null ? el('div', { class: 'stage-no-webgl', text: NO_WEBGL_COPY }) : canvas,
  );

  let drawOnce: () => void = () => {};
  let loop: () => void = () => {};
  let orbiting = false;

  if (renderer !== null) {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Stage viewport');
    let frame = 0;
    // Frames are drawn only while playing, while orbiting, or once after a
    // change; paused and idle, the frame count holds for any 2-second window.
    drawOnce = (): void => {
      renderer.render({
        layers: demoLayers,
        keysByLayer: new Map(),
        overrides: demoOverrides(transport.beat),
        cameraLayer: demoLayers.find((l) => l.id === 'demo-camera') ?? null,
        tick: transport.currentTick(),
        beat: transport.beat,
        bpm: transport.bpm,
        selectedId: null,
        orbit: { yaw: 0.3, pitch: 0.25, distance: 9 },
      });
      frame += 1;
      canvas.setAttribute('data-frame', String(frame));
    };
    loop = (): void => {
      if (transport.playing || orbiting) {
        drawOnce();
        requestAnimationFrame(loop);
      }
    };
    canvas.addEventListener('pointerdown', () => { orbiting = true; loop(); });
    canvas.addEventListener('pointerup', () => { orbiting = false; drawOnce(); });
    drawOnce();
  }

  const playButton = el('button', { text: 'Play', 'aria-pressed': 'false' });
  const pauseButton = el('button', { text: 'Pause' });
  const stepButton = el('button', { text: 'Step beat' });
  const stopButton = el('button', { text: 'Stop' });
  playButton.addEventListener('click', () => { transport.play(); playButton.setAttribute('aria-pressed', 'true'); loop(); });
  pauseButton.addEventListener('click', () => { transport.pause(); playButton.setAttribute('aria-pressed', 'false'); drawOnce(); });
  stepButton.addEventListener('click', () => { transport.stepBeat(); playButton.setAttribute('aria-pressed', 'false'); drawOnce(); });
  stopButton.addEventListener('click', () => { transport.stop(); playButton.setAttribute('aria-pressed', 'false'); drawOnce(); });

  const menubar = el('div', { class: 'menubar' },
    el('div', { class: 'transport', role: 'group', 'aria-label': 'Beat transport' }, playButton, pauseButton, stepButton, stopButton),
  );

  const shell = el('div', { class: 'shell no-rig' },
    el('div', { class: 'dock' }),
    menubar,
    el('div', { class: 'banner-strip' }),
    el('div', { class: 'stage-area' }, stageViewport),
    el('div', { class: 'timeline-dock' }),
  );

  const root = el('div');
  root.append(shell);
  mountStatusRegions(root, regions);
  clear(document.body);
  document.body.append(root);
  void promptSignIn;

  // The booth dialog sits over the demo shell, with no dimming behind it.
  openDialogWith({
    title: 'Afterglass',
    body: el('div', { class: 'centered' }, emblem, el('div', { text: 'Build the set in a browser. Play it on any screen in the room.' })),
    actions: [{ label: 'Close', onClick: (close) => { close(); } }],
  });

  const dialog = document.querySelector('.dialog');
  if (dialog !== null) {
    const body = dialog.querySelector('.dialog-body');
    if (body !== null) {
      const links = el('div', { class: 'links' });
      links.append(
        el('a', { href: '#', text: 'Sign in', click: (event: Event) => { event.preventDefault(); openSignInForm(navigate); } }),
        el('a', { href: '#', text: 'Create account', click: (event: Event) => { event.preventDefault(); openCreateAccountForm(navigate); } }),
      );
      body.append(links);
    }
  }
}

function openSignInForm (navigate: (path: string) => void): void {
  const email = el('input', { type: 'email', 'aria-label': 'Email', autocomplete: 'email' }) as unknown as HTMLInputElement;
  const password = el('input', { type: 'password', 'aria-label': 'Password', autocomplete: 'current-password' }) as unknown as HTMLInputElement;
  const error = el('div', { class: 'field-error' });
  const submit = async (): Promise<void> => {
    const result = await api.post<{ user: UserInfo }>('/api/auth/login', { email: email.value, password: password.value });
    if (!result.ok) {
      error.textContent = result.error.body.message;
      return;
    }
    closeActiveDialog();
    navigate('/workspace');
  };
  const form = el('form', {},
    el('div', {}, el('label', { text: 'Email' }), email),
    el('div', {}, el('label', { text: 'Password' }), password),
    error,
    el('button', { type: 'submit', class: 'row-button primary', text: 'Sign in' }),
  );
  form.addEventListener('submit', (event) => { event.preventDefault(); void submit(); });
  openDialogWith({ title: 'Sign in', form });
}

function openCreateAccountForm (navigate: (path: string) => void): void {
  const email = el('input', { type: 'email', 'aria-label': 'Email', autocomplete: 'email' }) as unknown as HTMLInputElement;
  const password = el('input', { type: 'password', 'aria-label': 'Password', autocomplete: 'new-password' }) as unknown as HTMLInputElement;
  const displayName = el('input', { type: 'text', 'aria-label': 'Display name', autocomplete: 'nickname' }) as unknown as HTMLInputElement;
  const error = el('div', { class: 'field-error' });
  const fieldErrors: Record<string, HTMLElement> = {
    email: el('div', { class: 'field-error' }),
    password: el('div', { class: 'field-error' }),
    display_name: el('div', { class: 'field-error' }),
  };
  const submit = async (): Promise<void> => {
    const result = await api.post<{ user: UserInfo }>('/api/auth/signup', {
      email: email.value, password: password.value, display_name: displayName.value,
    });
    if (!result.ok) {
      const fields = result.error.body.fields ?? {};
      for (const [name, message] of Object.entries(fields)) {
        if (name in fieldErrors) fieldErrors[name].textContent = message;
      }
      return;
    }
    closeActiveDialog();
    navigate('/workspace');
  };
  const form = el('form', {},
    el('div', {}, el('label', { text: 'Email' }), email, fieldErrors.email),
    el('div', {}, el('label', { text: 'Password' }), password, fieldErrors.password),
    el('div', {}, el('label', { text: 'Display name' }), displayName, fieldErrors.display_name),
    el('button', { type: 'submit', class: 'row-button primary', text: 'Create account' }),
  );
  form.addEventListener('submit', (event) => { event.preventDefault(); void submit(); });
  openDialogWith({ title: 'Create account', form });
  void error;
}

async function renderWorkspace (): Promise<void> {
  const result = await api.get<{ sets: SetSummary[] }>('/api/sets');
  const sets = result.ok ? result.body.sets : [];
  const regions = makeStatusRegions();
  const root = el('div');
  const { canvas, renderer } = makeStageCanvas();
  const transport = makeTransport();

  const rows = el('div', { class: 'tree', role: 'list' });
  if (sets.length === 0) {
    rows.append(el('div', { class: 'empty-state' },
      el('span', { class: 'headline', text: 'No sets yet' }),
      el('span', { text: 'No sets yet' }),
    ));
  }
  for (const set of sets) {
    rows.append(el('div', {
      class: 'set-row', role: 'listitem', tabindex: '0',
      text: `${set.name} (${set.role})`,
      click: () => { navigate(`/sets/${set.id}`); },
    }));
  }

  const newSetButton = el('button', { class: 'row-button primary', text: 'New set' });
  newSetButton.addEventListener('click', () => {
    const name = el('input', { type: 'text', 'aria-label': 'Set name' }) as unknown as HTMLInputElement;
    const blank = el('input', { type: 'radio', name: 'starter', value: 'blank-stage', 'aria-label': 'Blank stage' }) as unknown as HTMLInputElement;
    blank.checked = true;
    const form = el('form', {},
      el('div', {}, el('label', { text: 'Set name' }), name),
      el('div', { class: 'radio-row' }, blank, el('label', { text: 'Blank stage' })),
      el('button', { type: 'submit', class: 'row-button primary', text: 'Create set' }),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const create = await api.post<{ set: { id: string } }>('/api/sets', { name: name.value, starter: 'blank-stage' });
      if (!create.ok) return;
      closeActiveDialog();
      navigate(`/sets/${create.body.set.id}`);
    });
    openDialogWith({ title: 'New set', form });
  });

  const stageViewport = el('div', { class: 'stage-viewport' },
    el('div', { class: 'empty-state' },
      el('span', { class: 'headline', text: 'Choose a set' }),
      el('span', { text: 'No set open' }),
    ),
  );
  void canvas; void renderer; void transport;

  const account = el('button', { text: `Account (${currentUser?.display_name ?? ''})` });
  account.addEventListener('click', () => { openAccountMenu(account); });

  const shell = el('div', { class: 'shell' },
    el('div', { class: 'dock', role: 'navigation', 'aria-label': 'Workbench' }),
    el('div', { class: 'menubar' }, account),
    el('div', { class: 'banner-strip' }),
    el('div', { class: 'stage-area' }, stageViewport),
    el('div', { class: 'timeline-dock' }),
    el('aside', { class: 'rig-panel', role: 'complementary', 'aria-label': 'Rig panel' },
      el('div', { class: 'rig-title', text: 'Sets' }),
      el('div', { class: 'rig-body' }, rows, newSetButton),
    ),
  );
  root.append(shell);
  mountStatusRegions(root, regions);
  clear(document.body);
  document.body.append(root);
}

function openAccountMenu (opener: HTMLElement): void {
  const menu = el('div', { class: 'menu-popover', role: 'menu' },
    el('button', { role: 'menuitem', text: 'Sign out', click: async () => {
      await api.post('/api/auth/logout');
      closeActiveDialog();
      navigate('/');
    } }),
  );
  opener.append(menu);
  const first = menu.querySelector<HTMLElement>('button');
  first?.focus();
  const dismiss = (event: Event): void => {
    if (!menu.contains(event.target as Node)) {
      menu.remove();
      document.removeEventListener('click', dismiss, true);
    }
  };
  document.addEventListener('click', dismiss, true);
}

function renderJoinPage (token: string): void {
  void api.get<{ set_name: string; role: string; used: boolean }>(`/api/invites/${token}`).then((result) => {
    const root = el('div');
    if (result.ok && !result.body.used) {
      openDialogWith({
        title: `Join ${result.body.set_name}`,
        actions: [{
          label: `Join as ${result.body.role}`,
          primary: true,
          onClick: async (close) => {
            const accept = await api.post<{ set_id: string }>(`/api/invites/${token}/accept`);
            if (!accept.ok) return;
            close();
            navigate(`/sets/${accept.body.set_id}`);
          },
        }],
      });
    } else if (result.ok && result.body.used) {
      const body = el('div', { class: 'empty-state' }, el('span', { text: 'This invite link has already been used' }));
      openDialogWith({ title: 'Invite used', body, actions: [{ label: 'OK', onClick: (close) => close() }] });
    } else {
      openDialogWith({ title: 'Invite not found', body: el('div', { text: 'This invite link has already been used' }), actions: [{ label: 'OK', onClick: (close) => close() }] });
    }
    document.body.append(root);
  });
}

async function renderShowPage (token: string): Promise<void> {
  const info = await api.get<{ set_name: string; bpm: number; version: { number: number; sha256: string; size: number; published_at: string } }>(`/api/show/${token}`);
  const root = el('div', { class: 'show-page' });
  const regions = makeStatusRegions();
  const { canvas, renderer } = makeStageCanvas();

  if (!info.ok) {
    root.append(el('div', { class: 'show-nothing', text: 'Nothing is live yet' }));
    document.body.append(root);
    return;
  }

  const bundleResult = await api.get<{ layers: LayerDoc[]; keys: { layer_id: string; property: string; tick: number; value: number }[]; set: { bpm: number; active_camera_id: string | null }; shaders: { layer_id: string; version: number; source: string }[] }>(`/api/show/${token}/bundle`);
  const bundle = bundleResult.ok ? bundleResult.body : null;

  if (renderer !== null && bundle !== null) {
    for (const shader of bundle.shaders) {
      renderer.setShaderProgram(shader.layer_id, renderer.compileFragment(shader.source));
    }
    const transport = makeTransport();
    transport.bpm = bundle.set.bpm;
    transport.play();
    const keysByLayer = new Map<string, { property: string; tick: number; value: number }[]>();
    for (const key of bundle.keys) {
      const list = keysByLayer.get(key.layer_id) ?? [];
      list.push(key);
      keysByLayer.set(key.layer_id, list);
    }
    const bus = new URLSearchParams(window.location.search).get('bus') ?? 'main';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Show stage');
    const draw = (): void => {
      const tick = transport.currentTick();
      renderer.render({
        layers: bundle.layers,
        keysByLayer,
        overrides: new Map(),
        cameraLayer: bundle.layers.find((l) => l.id === bundle.set.active_camera_id) ?? null,
        tick, beat: transport.beat, bpm: transport.bpm,
        selectedId: null,
        orbit: { yaw: 0.3, pitch: 0.25, distance: 9 },
        bus,
      });
      canvas.setAttribute('data-frame', String(renderer.getFrameCount()));
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
    root.append(canvas);
  } else {
    root.append(el('div', { class: 'show-nothing', text: NO_WEBGL_COPY }));
  }

  const infoButton = el('button', { class: 'show-info-toggle', text: 'Show info' });
  const infoPanel = el('dl', { class: 'show-info-panel', role: 'region', 'aria-label': 'Show info' });
  const setVersion = (version: { number: number; sha256: string; size: number; published_at: string }): void => {
    clear(infoPanel);
    infoPanel.append(
      el('dt', { text: 'Set' }), el('dd', { text: info.ok ? info.body.set_name : '' }),
      el('dt', { text: 'Version' }), el('dd', { text: `Version ${version.number}` }),
      el('dt', { text: 'SHA-256' }), el('dd', { text: `SHA-256 ${version.sha256}` }),
      el('dt', { text: 'Published' }), el('dd', { text: `Published ${new Date(version.published_at).toLocaleString()}` }),
    );
  };
  let infoOpen = false;
  const toggleInfo = (): void => {
    infoOpen = !infoOpen;
    infoButton.textContent = infoOpen ? 'Hide info' : 'Show info';
    if (infoOpen) {
      setVersion(info.body.version);
      root.append(infoPanel);
      infoPanel.append(el('dt', { text: 'BPM' }), el('dd', { text: String(info.body.bpm) }));
    } else {
      infoPanel.remove();
    }
  };
  infoButton.addEventListener('click', toggleInfo);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'I') toggleInfo();
  });
  root.append(infoButton);

  // The show page follows the live pointer within five seconds.
  const events = new EventSource(`/api/show/${token}/events`);
  events.addEventListener('show', async (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as { live_number: number };
    const fresh = await api.get<typeof info.body>(`/api/show/${token}`);
    if (fresh.ok) {
      info.body = fresh.body;
      if (infoOpen) setVersion(fresh.body.version);
      announce(regions['Show status'], `Version ${data.live_number} is live`);
    }
  });

  clear(document.body);
  document.body.append(root);
  mountStatusRegions(root, regions);
}

void boot();
