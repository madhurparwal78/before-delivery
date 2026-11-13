import * as THREE from 'three';
import {
  SceneHandle, createScene, fit, addStudioLights, buildSubject, hasWebGL,
  animateLoop, tween, IDLE_TURN_SECONDS, EMBER, COBALT, VIOLET,
} from '../scenes';
import { api, el, escapeHtml, formatMoneyMinor, isApiError, mountOutageBanner, setStatus, trapDialog } from '../shell';

export interface CaseStudy {
  slug: string;
  title: string;
  client: string;
  summary: string;
  scene: { primitives: string[]; accent: string };
  published: boolean;
  sort: number;
}
interface Service {
  code: string;
  title: string;
  list_price_pence: number;
  sort: number;
}
interface Content {
  case_studies: CaseStudy[];
  services: Service[];
  team: { name: string; role: string; bio: string }[];
  insights: { slug: string; title: string; summary: string }[];
  marquee: string[];
}

const ACCENTS: Record<string, number> = { ember: EMBER, cobalt: COBALT, violet: VIOLET };
const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountHome(): void {
  const main = document.querySelector('main') as HTMLElement;
  main.innerHTML = '';
  main.id = 'main';
  mountOutageBanner();

  const hero = el('section', 'hero');
  hero.setAttribute('aria-label', 'Hero');
  hero.setAttribute('role', 'region');
  hero.id = 'hero';
  hero.setAttribute('data-scrub-progress', '0.000');
  hero.setAttribute('data-webgl', hasWebGL() ? 'on' : 'off');
  const heroHead = el('div', 'hero-head');
  const heroLabel = el('p', 'section-label');
  heroLabel.textContent = 'Gloamwork — CGI stills from your CAD';
  const heroTitle = el('h1', 'display-1');
  heroTitle.textContent = 'Your CAD, lit like a launch.';
  const heroSub = el('p', 'hero-sub');
  heroSub.textContent = 'Upload your product\'s GLB, confirm its true scale, build the shot list and pay a 40% deposit — all in one place.';
  const heroCta = el('a', 'hero-cta');
  heroCta.href = '/start';
  heroCta.textContent = 'Start a project';
  heroHead.append(heroLabel, heroTitle, heroSub, heroCta);
  const heroStage = el('div', 'hero-stage');
  hero.append(heroHead, heroStage);
  main.appendChild(hero);

  const searchSection = el('div');
  searchSection.className = 'page-section';
  searchSection.style.paddingTop = '0';
  const searchForm = el('form', 'search-form');
  searchForm.setAttribute('role', 'search');
  const searchInput = el('input', 'search-input');
  searchInput.type = 'search';
  searchInput.id = 'studio-search';
  searchInput.setAttribute('aria-label', 'Search the studio');
  searchInput.placeholder = 'Search the studio';
  const searchResults = el('div', 'search-results');
  searchResults.hidden = true;
  searchResults.id = 'search-results';
  const resultsList = el('ul');
  resultsList.setAttribute('aria-label', 'Search results');
  resultsList.hidden = true;
  const searchStatus = el('p');
  searchStatus.className = 'visually-hidden';
  searchStatus.setAttribute('role', 'status');
  searchStatus.setAttribute('aria-live', 'polite');
  searchStatus.id = 'search-status';
  const statusLive = el('p');
  statusLive.className = 'visually-hidden';
  statusLive.setAttribute('role', 'status');
  statusLive.setAttribute('aria-live', 'polite');
  searchForm.append(searchInput);
  searchResults.appendChild(resultsList);
  searchForm.appendChild(searchResults);
  searchForm.appendChild(searchStatus);
  searchForm.appendChild(statusLive);
  searchSection.appendChild(searchForm);
  main.appendChild(searchSection);
  mountSearch(searchInput, searchResults, resultsList, searchStatus);

  const workSection = el('section', 'page-section');
  workSection.id = 'work';
  const workHead = el('h2', 'display-2');
  workHead.textContent = 'Work';
  workSection.appendChild(workHead);
  const workGrid = el('ul', 'work-grid');
  workGrid.setAttribute('aria-label', 'Case studies');
  workGrid.id = 'case-study-list';
  workSection.appendChild(workGrid);
  main.appendChild(workSection);

  const servicesSection = el('section', 'page-section');
  servicesSection.id = 'services';
  const servicesHead = el('h2', 'display-2');
  servicesHead.textContent = 'Services';
  servicesSection.appendChild(servicesHead);
  const table = el('table', 'shot-table');
  const caption = el('caption', 'visually-hidden');
  caption.textContent = 'Shot prices';
  table.appendChild(caption);
  const thead = el('thead');
  const headRow = el('tr');
  const thShot = el('th');
  thShot.textContent = 'Shot';
  thShot.scope = 'col';
  const thPrice = el('th');
  thPrice.textContent = 'Price per colourway';
  thPrice.scope = 'col';
  headRow.append(thShot, thPrice);
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el('tbody');
  table.appendChild(tbody);
  servicesSection.appendChild(table);
  main.appendChild(servicesSection);

  const processSection = el('section', 'page-section process-region');
  processSection.id = 'process';
  processSection.setAttribute('aria-label', 'Process');
  processSection.setAttribute('data-process-step', '1');
  // A tall scrolling region: its height minus the viewport drives the progress.
  processSection.style.minHeight = '220vh';
  const processHead = el('h2', 'display-2');
  processHead.textContent = 'How a commission runs';
  const processGrid = el('div', 'section-grid');
  const processListCol = el('div', 'section-head');
  const processList = el('ol', 'process-list');
  processList.setAttribute('aria-label', 'Process stages');
  const stages = ['01 Quote', '02 Deposit', '03 Look-dev review', '04 Final review', '05 Delivered'];
  for (const stage of stages) {
    const item = el('li');
    const [number, ...rest] = stage.split(' ');
    const num = el('span', 'step-number');
    num.textContent = number;
    item.append(num, document.createTextNode(rest.join(' ')));
    processList.appendChild(item);
  }
  processListCol.appendChild(processHead);
  processListCol.appendChild(processList);
  const processStage = el('div', 'section-body process-stage');
  processStage.setAttribute('data-webgl', hasWebGL() ? 'on' : 'off');
  processGrid.append(processListCol, processStage);
  processSection.appendChild(processGrid);
  main.appendChild(processSection);

  const studioSection = el('section', 'page-section');
  studioSection.id = 'studio';
  const studioGrid = el('div', 'studio-grid');
  const studioCopy = el('div', 'studio-copy');
  const studioHead = el('h2', 'display-2');
  studioHead.textContent = 'Studio';
  const studioBio = el('p', 'lede');
  studioBio.id = 'studio-team';
  studioCopy.append(studioHead, studioBio);
  const marqueeWrap = el('div', 'studio-marquee-wrap');
  const marqueeRegion = el('div', 'marquee');
  marqueeRegion.id = 'clients';
  marqueeRegion.setAttribute('role', 'region');
  marqueeRegion.setAttribute('aria-label', 'Clients');
  marqueeRegion.setAttribute('data-paused', 'false');
  const marqueeTrack = el('div', 'marquee-track');
  marqueeRegion.appendChild(marqueeTrack);
  const marqueeToggle = el('button', 'marquee-toggle');
  marqueeToggle.textContent = 'Pause client names';
  marqueeToggle.setAttribute('aria-pressed', 'false');
  marqueeWrap.append(marqueeRegion, marqueeToggle);
  studioGrid.append(studioCopy, marqueeWrap);
  studioSection.appendChild(studioGrid);
  main.appendChild(studioSection);
  mountMarquee(marqueeRegion, marqueeToggle);

  const insightsSection = el('section', 'page-section');
  insightsSection.id = 'insights';
  const insightsHead = el('h2', 'display-2');
  insightsHead.textContent = 'Insights';
  insightsSection.appendChild(insightsHead);
  const insightGrid = el('div', 'insight-grid');
  insightGrid.id = 'insight-grid';
  insightsSection.appendChild(insightGrid);
  main.appendChild(insightsSection);

  const footer = el('footer', 'site-footer');
  footer.id = 'footer';
  const footerName = el('span');
  footerName.textContent = 'Gloamwork';
  const footerTag = el('span');
  footerTag.textContent = 'Your CAD, lit like a launch.';
  footer.append(footerName, footerTag);
  main.appendChild(footer);

  void loadContent().then(content => {
    if (content === null) {
      return;
    }
    renderCaseStudies(workGrid, content.case_studies);
    renderServices(tbody, content.services);
    renderStudio(studioBio, content.team);
    renderMarquee(marqueeTrack, content.marquee);
    renderInsights(insightGrid, content.insights);
    mountHeroScrub(heroStage, hero);
    mountProcessScroll(processSection, processStage, processList);
  });
}

async function loadContent(): Promise<Content | null> {
  const { status, json } = await api<Content>('GET', '/api/content');
  if (status === 200 && !isApiError(json)) {
    return json;
  }
  const main = document.querySelector('main') as HTMLElement;
  const banner = el('p');
  banner.setAttribute('role', 'alert');
  banner.textContent = isApiError(json) ? json.message : 'Studio content is offline right now. Please try again in a few minutes.';
  main.prepend(banner);
  return null;
}

function renderCaseStudies(grid: HTMLElement, studies: CaseStudy[]): void {
  grid.innerHTML = '';
  const isPhone = window.innerWidth < 768;
  if (isPhone) {
    grid.classList.add('deck');
    grid.setAttribute('data-deck-index', '1');
    studies.forEach((study, index) => {
      const item = el('li');
      const tile = makeTile(study);
      tile.setAttribute('data-position', index === 0 ? 'front' : index === 1 ? 'next' : index === 2 ? 'far' : 'hidden');
      if (index > 0) {
        tile.setAttribute('inert', '');
      }
      item.appendChild(tile);
      grid.appendChild(item);
    });
    mountDeck(grid as HTMLUListElement, studies);
    return;
  }
  for (const study of studies) {
    const item = el('li');
    item.appendChild(makeTile(study));
    grid.appendChild(item);
  }
}

function makeTile(study: CaseStudy): HTMLAnchorElement {
  const tile = el('a', 'tile');
  tile.href = `/work/${study.slug}`;
  tile.setAttribute('data-transition', 'done');
  const stage = el('div', 'tile-stage');
  stage.setAttribute('data-webgl', hasWebGL() ? 'on' : 'off');
  tile.appendChild(stage);
  const body = el('div', 'tile-body');
  const title = el('h3', 'tile-title');
  title.textContent = study.title;
  const client = el('p', 'tile-client');
  client.textContent = study.client;
  body.append(title, client);
  tile.appendChild(body);
  tile.setAttribute('aria-label', study.title);
  void mountSubject(stage, study, { idle: true });
  return tile;
}

function mountDeck(deck: HTMLUListElement, studies: CaseStudy[]): void {
  let index = 0;
  const tiles = Array.from(deck.querySelectorAll('.tile')) as HTMLAnchorElement[];
  const apply = (): void => {
    deck.setAttribute('data-deck-index', String(index + 1));
    tiles.forEach((tile, i) => {
      const item = tile.parentElement as HTMLLIElement;
      if (i === index) {
        tile.setAttribute('data-position', 'front');
        tile.removeAttribute('inert');
      } else if (i === index + 1) {
        tile.setAttribute('data-position', 'next');
        tile.setAttribute('inert', '');
      } else if (i === index + 2) {
        tile.setAttribute('data-position', 'far');
        tile.setAttribute('inert', '');
      } else {
        tile.setAttribute('data-position', 'hidden');
        tile.setAttribute('inert', '');
      }
      void item;
    });
  };
  const advance = (delta: number): void => {
    const next = index + delta;
    if (next < 0 || next >= tiles.length) {
      return;
    }
    index = next;
    apply();
    tiles[index].focus();
  };
  // Drag and fling.
  let dragStartX: number | null = null;
  let dragStartY: number | null = null;
  let dragStartTime = 0;
  let dragged = false;
  const front = () => tiles[index];
  deck.addEventListener('pointerdown', event => {
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragStartTime = performance.now();
    dragged = false;
  });
  deck.addEventListener('pointermove', event => {
    if (dragStartX === null) {
      return;
    }
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - (dragStartY ?? event.clientY);
    if (Math.abs(dx) > Math.abs(dy)) {
      dragged = true;
      front().style.transform = `translateX(${dx}px)`;
    }
  });
  deck.addEventListener('pointerup', event => {
    if (dragStartX === null) {
      return;
    }
    const dx = event.clientX - dragStartX;
    const dt = performance.now() - dragStartTime;
    const speed = Math.abs(dx) / Math.max(dt, 1);
    front().style.transform = '';
    if (!dragged) {
      dragStartX = null;
      return;
    }
    if (speed > 0.5 || Math.abs(dx) >= 120) {
      advance(dx < 0 ? 1 : -1);
    }
    dragStartX = null;
  });
  // Arrow keys on the front card's link.
  deck.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      advance(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      advance(-1);
    }
  });
  apply();
}

function renderServices(tbody: HTMLTableSectionElement, services: Service[]): void {
  tbody.innerHTML = '';
  for (const service of services) {
    const row = el('tr');
    const shotCell = el('td');
    const objectWrap = el('span', 'shot-object');
    objectWrap.setAttribute('data-tilt', '0');
    objectWrap.setAttribute('data-idle', 'turning');
    objectWrap.setAttribute('data-webgl', hasWebGL() ? 'on' : 'off');
    const titleLink = el('a', 'shot-title-link');
    titleLink.href = '/start';
    titleLink.textContent = service.title;
    titleLink.setAttribute('data-code', service.code);
    shotCell.append(objectWrap, titleLink);
    const priceCell = el('td', 'shot-price');
    priceCell.textContent = formatMoneyMinor(service.list_price_pence, '£', 2);
    row.append(shotCell, priceCell);
    tbody.appendChild(row);
    mountServiceObject(objectWrap, titleLink, service.code);
  }
}

function mountServiceObject(wrap: HTMLElement, link: HTMLElement, code: string): void {
  const handle = createScene(wrap);
  if (!handle) {
    return;
  }
  fit(handle, wrap);
  const accent = code === 'turntable_360' ? VIOLET : code === 'exploded_view' ? COBALT : EMBER;
  const subject = buildSubject(primitivesFor(code), accent, false);
  subject.scale.setScalar(0.5);
  handle.scene.add(subject);
  handle.camera.position.set(0, 1.1, 3.4);
  handle.camera.lookAt(0, 0, 0);
  addStudioLights(handle.scene);
  if (reducedMotion()) {
    wrap.setAttribute('data-idle', 'still');
    handle.render();
    return;
  }
  wrap.setAttribute('data-idle', 'turning');
  let tiltTarget = 0;
  wrap.addEventListener('pointermove', event => {
    const rect = wrap.getBoundingClientRect();
    const centre = rect.left + rect.width / 2;
    const ratio = (event.clientX - centre) / (rect.width / 2);
    tiltTarget = Math.max(-12, Math.min(12, Math.round(ratio * 12)));
    wrap.setAttribute('data-tilt', String(Math.abs(tiltTarget)));
    wrap.dataset.lean = tiltTarget < 0 ? 'left' : 'right';
  });
  wrap.addEventListener('pointerleave', () => {
    tiltTarget = 0;
    wrap.setAttribute('data-tilt', '0');
  });
  link.addEventListener('focus', () => {
    tiltTarget = 12;
    wrap.setAttribute('data-tilt', '12');
  });
  link.addEventListener('blur', () => {
    tiltTarget = 0;
    wrap.setAttribute('data-tilt', '0');
  });
  animateLoop(() => {
    const time = performance.now() / 1000;
    subject.rotation.y = (time / IDLE_TURN_SECONDS) * Math.PI * 2;
    const current = Number(wrap.getAttribute('data-tilt') ?? '0');
    const target = Math.abs(tiltTarget);
    const next = current + (target - current) * 0.15;
    wrap.setAttribute('data-tilt', String(Math.round(next)));
    const leanSign = wrap.dataset.lean === 'left' ? -1 : 1;
    subject.rotation.z = (next / 12) * 0.35 * leanSign;
    handle.render();
  });
}

function primitivesFor(code: string): string[] {
  const map: Record<string, string[]> = {
    hero_front: ['cylinder', 'torus'],
    three_quarter: ['box', 'capsule'],
    top_down: ['cylinder', 'sphere'],
    detail_macro: ['torus', 'sphere'],
    turntable_360: ['cylinder', 'box', 'torus'],
    exploded_view: ['box', 'cylinder', 'capsule', 'sphere'],
  };
  return map[code] ?? ['box', 'cylinder'];
}

function renderStudio(bio: HTMLElement, team: { name: string; role: string; bio: string }[]): void {
  const member = team[0];
  if (!member) {
    return;
  }
  bio.textContent = `${member.name} — ${member.role}. ${member.bio}`;
}

function renderMarquee(track: HTMLElement, names: string[]): void {
  track.innerHTML = '';
  const doubled = [...names, ...names];
  for (const name of doubled) {
    const span = el('span');
    span.textContent = name;
    track.appendChild(span);
  }
}

function mountMarquee(region: HTMLElement, toggle: HTMLButtonElement): void {
  let pausedByButton = false;
  const setPaused = (paused: boolean): void => {
    region.setAttribute('data-paused', String(paused));
    toggle.textContent = paused ? 'Play client names' : 'Pause client names';
    toggle.setAttribute('aria-pressed', String(paused));
  };
  toggle.addEventListener('click', () => {
    pausedByButton = !pausedByButton;
    setPaused(pausedByButton);
  });
  region.addEventListener('pointerenter', () => setPaused(true));
  region.addEventListener('pointerleave', () => setPaused(pausedByButton));
  region.addEventListener('focusin', () => setPaused(true));
  region.addEventListener('focusout', () => setPaused(pausedByButton));
  if (reducedMotion()) {
    setPaused(true);
    toggle.hidden = true;
  }
}

function renderInsights(grid: HTMLElement, insights: { slug: string; title: string; summary: string }[]): void {
  grid.innerHTML = '';
  for (const insight of insights) {
    const card = el('a', 'insight-card');
    card.href = `#insight-${insight.slug}`;
    card.id = `insight-${insight.slug}`;
    const title = el('h3');
    title.textContent = insight.title;
    const summary = el('p');
    summary.textContent = insight.summary;
    card.append(title, summary);
    grid.appendChild(card);
  }
}

/** Hero scrub: progress is scroll / 2400px, clamped 0..1; the same scroll gives the same frame. */
function mountHeroScrub(stage: HTMLElement, heroRegion: HTMLElement): void {
  const handle = createScene(stage);
  const applyAttr = (progress: number): void => {
    const p = Math.max(0, Math.min(1, progress));
    heroRegion.setAttribute('data-scrub-progress', p.toFixed(3));
  };
  applyAttr(0);
  if (!handle) {
    applyAttr(reducedMotion() ? 1 : 0);
    return;
  }
  fit(handle, stage);
  const accent = VIOLET;
  const parts: THREE.Group[] = [];
  const subject = new THREE.Group();
  const primitives: { name: string; axis: THREE.Vector3; offset: number }[] = [
    { name: 'cylinder', axis: new THREE.Vector3(0, 1, 0), offset: 0.9 },
    { name: 'torus', axis: new THREE.Vector3(0, 0, 1), offset: 0.7 },
    { name: 'box', axis: new THREE.Vector3(1, 0, 0), offset: 0.6 },
    { name: 'capsule', axis: new THREE.Vector3(0, 1, 0), offset: 0.8 },
    { name: 'sphere', axis: new THREE.Vector3(0, 0.3, 0.6).normalize(), offset: 0.5 },
  ];
  const geometryFactories: Record<string, () => THREE.BufferGeometry> = {
    box: () => new THREE.BoxGeometry(0.6, 0.6, 0.6),
    cylinder: () => new THREE.CylinderGeometry(0.3, 0.3, 0.5, 40),
    sphere: () => new THREE.SphereGeometry(0.34, 40, 28),
    torus: () => new THREE.TorusGeometry(0.34, 0.11, 20, 48),
    capsule: () => new THREE.CapsuleGeometry(0.2, 0.45, 10, 20),
  };
  const material = new THREE.MeshStandardMaterial({ color: 0x30343e, roughness: 0.25, metalness: 0.7 });
  for (const part of primitives) {
    const mesh = new THREE.Mesh(geometryFactories[part.name](), material.clone());
    const group = new THREE.Group();
    group.add(mesh);
    subject.add(group);
    parts.push(group);
  }
  const accentLight = new THREE.PointLight(accent, 20, 6);
  accentLight.position.set(0.8, 1.2, 1.4);
  subject.add(accentLight);
  handle.scene.add(subject);
  handle.camera.position.set(0, 0.9, 4.4);
  handle.camera.lookAt(0, 0.2, 0);
  addStudioLights(handle.scene);

  const basePositions = parts.map(part => part.position.clone());
  let currentProgress = -1;
  const applyProgress = (progress: number): void => {
    const p = Math.max(0, Math.min(1, progress));
    applyAttr(p);
    parts.forEach((part, index) => {
      const def = primitives[index];
      const base = basePositions[index];
      const distance = def.offset * p;
      part.position.copy(base).addScaledVector(def.axis, distance);
    });
    const sweep = new THREE.Color(COBALT).lerp(new THREE.Color(VIOLET), p);
    accentLight.color.set(sweep);
  };

  if (reducedMotion()) {
    applyProgress(1);
    animateLoop(() => handle.render());
    return;
  }

  let scheduled = false;
  const update = (): void => {
    scheduled = false;
    const progress = window.scrollY / 2400;
    if (Math.abs(progress - currentProgress) > 0.0005) {
      currentProgress = progress;
      applyProgress(progress);
    }
  };
  const onScroll = (): void => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  update();
  animateLoop(() => handle.render());
}

/** Process camera path: one camera glides through five stations as the region scrolls. */
function mountProcessScroll(region: HTMLElement, stage: HTMLElement, list: HTMLOListElement): void {
  const stations = 5;
  const items = Array.from(list.querySelectorAll('li'));
  const handle = createScene(stage);
  if (!handle) {
    region.setAttribute('data-process-step', 'all');
    items.forEach(item => item.setAttribute('aria-current', 'step'));
    return;
  }
  fit(handle, stage);
  addStudioLights(handle.scene);
  const plinths: THREE.Group[] = [];
  const stationGeometries = [
    () => new THREE.CylinderGeometry(0.3, 0.34, 0.16, 32),
    () => new THREE.BoxGeometry(0.5, 0.5, 0.5),
    () => new THREE.TorusGeometry(0.28, 0.09, 18, 40),
    () => new THREE.CapsuleGeometry(0.18, 0.4, 8, 18),
    () => new THREE.SphereGeometry(0.3, 32, 22),
  ];
  const accentOrder = [EMBER, COBALT, VIOLET, COBALT, EMBER];
  for (let i = 0; i < stations; i++) {
    const group = new THREE.Group();
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.46, 0.14, 40),
      new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.85, metalness: 0.1 }),
    );
    const object = new THREE.Mesh(
      stationGeometries[i](),
      new THREE.MeshStandardMaterial({ color: 0x30343e, roughness: 0.3, metalness: 0.65 }),
    );
    object.position.y = 0.42;
    const light = new THREE.PointLight(accentOrder[i], 8, 3);
    light.position.set(0, 0.8, 0.6);
    group.add(plinth, object, light);
    const angle = -Math.PI / 2 + (i / (stations - 1)) * Math.PI;
    group.position.set(Math.cos(angle) * 3.4, 0, Math.sin(angle) * 1.4 - 1.2);
    plinths.push(group);
    handle.scene.add(group);
  }
  const cameraPath = (t: number): void => {
    const angle = -Math.PI / 2 + t * Math.PI;
    handle.camera.position.set(Math.cos(angle) * 5.2, 1.1 + Math.sin(t * Math.PI) * 0.3, Math.sin(angle) * 2.6 - 1.2);
    handle.camera.lookAt(Math.cos(angle) * 3.4, 0.35, Math.sin(angle) * 1.4 - 1.2);
  };

  const apply = (progress: number): void => {
    const p = Math.max(0, Math.min(1, progress));
    const step = Math.min(stations, 1 + Math.floor(p * stations));
    region.setAttribute('data-process-step', String(step));
    items.forEach((item, index) => {
      if (index === step - 1) {
        item.setAttribute('aria-current', 'step');
      } else {
        item.removeAttribute('aria-current');
      }
    });
    cameraPath(p);
  };

  if (reducedMotion()) {
    region.setAttribute('data-process-step', 'all');
    items.forEach(item => item.setAttribute('aria-current', 'step'));
    animateLoop(() => handle.render());
    return;
  }

  let lastStep = -1;
  const update = (): void => {
    const rect = region.getBoundingClientRect();
    const total = rect.height - window.innerHeight;
    const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
    const progress = total > 0 ? scrolled / total : 0;
    const step = Math.min(stations, 1 + Math.floor(progress * stations));
    if (step !== lastStep) {
      lastStep = step;
      region.setAttribute('data-process-step', String(step));
      items.forEach((item, index) => {
        if (index === step - 1) {
          item.setAttribute('aria-current', 'step');
        } else {
          item.removeAttribute('aria-current');
        }
      });
    }
    apply(progress);
  };
  let scheduled = false;
  const onScroll = (): void => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        update();
      });
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  onScroll();
  animateLoop(() => handle.render());
}

/** Subject scene shared by tiles and case study pages. */
export function mountSubject(container: HTMLElement, study: CaseStudy, options: { idle: boolean }): SceneHandle | null {
  const handle = createScene(container);
  if (!handle) {
    return null;
  }
  fit(handle, container);
  const accent = ACCENTS[study.scene.accent] ?? EMBER;
  const subject = buildSubject(study.scene.primitives, accent, false);
  handle.scene.add(subject);
  handle.camera.position.set(0, 0.8, 3.2);
  handle.camera.lookAt(0, 0.3, 0);
  addStudioLights(handle.scene);
  container.setAttribute('data-idle', 'turning');
  if (options.idle && !reducedMotion()) {
    animateLoop(() => {
      const time = performance.now() / 1000;
      subject.rotation.y = (time / IDLE_TURN_SECONDS) * Math.PI * 2;
      handle.render();
    });
  } else if (reducedMotion()) {
    container.setAttribute('data-idle', 'still');
    handle.render();
  } else {
    handle.render();
  }
  return handle;
}

/** Studio search: results for the text currently in the field only. */
function mountSearch(input: HTMLInputElement, panel: HTMLElement, list: HTMLElement, status: HTMLElement): void {
  let sequence = 0;
  let timer: number | undefined;
  let focused = false;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), 250);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      window.clearTimeout(timer);
      void run();
    } else if (event.key === 'Escape') {
      input.value = '';
      panel.hidden = true;
      list.hidden = true;
      setStatus(status, '');
      input.focus();
    } else if (event.key === 'ArrowDown') {
      const first = list.querySelector('a');
      if (first) {
        event.preventDefault();
        (first as HTMLElement).focus();
      }
    }
  });
  input.addEventListener('blur', () => {
    focused = false;
  });
  panel.addEventListener('mousedown', event => event.preventDefault());
  list.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      panel.hidden = true;
      list.hidden = true;
      input.focus();
    }
  });
  document.addEventListener('click', event => {
    if (!focused && !panel.contains(event.target as Node) && event.target !== input) {
      panel.hidden = true;
      list.hidden = true;
    }
  });
  input.addEventListener('focus', () => {
    focused = true;
  });

  const run = async (): Promise<void> => {
    const query = input.value.trim();
    const current = ++sequence;
    const { status: code, json } = await api<{ query: string; hits: { kind: string; title: string; summary: string; url: string }[] }>('GET', `/api/search?q=${encodeURIComponent(query)}`);
    if (current !== sequence) {
      return;
    }
    if (code === 503 || isApiError(json)) {
      return;
    }
    const hits = (json as { hits: { kind: string; title: string; summary: string; url: string }[] }).hits ?? [];
    setStatus(status, `Matches: ${hits.length}`);
    list.innerHTML = '';
    if (hits.length === 0) {
      const empty = el('p', 'search-empty');
      empty.textContent = 'Nothing in the studio matches that search.';
      list.appendChild(empty);
    } else {
      const groups = new Map<string, typeof hits>();
      const labels: Record<string, string> = { case_study: 'Case studies', service: 'Services', insight: 'Insights' };
      for (const hit of hits) {
        const group = groups.get(hit.kind) ?? [];
        group.push(hit);
        groups.set(hit.kind, group);
      }
      for (const [kind, groupHits] of groups) {
        const title = el('h3', 'search-group-title');
        title.textContent = labels[kind] ?? kind;
        list.appendChild(title);
        for (const hit of groupHits) {
          const link = el('a', 'search-hit');
          link.href = hit.url;
          const hitTitle = el('span', 'hit-title');
          hitTitle.textContent = hit.title;
          const hitSummary = el('span', 'hit-summary');
          hitSummary.textContent = hit.summary;
          hitSummary.style.display = 'block';
          link.append(hitTitle, hitSummary);
          list.appendChild(link);
        }
      }
    }
    panel.hidden = false;
    list.hidden = false;
    void escapeHtml;
    void trapDialog;
  }
}
