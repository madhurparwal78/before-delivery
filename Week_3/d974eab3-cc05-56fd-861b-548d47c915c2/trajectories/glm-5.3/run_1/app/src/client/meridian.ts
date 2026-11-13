import {
  announceStatus,
  modeOf,
  reducedMotion,
  scenariosOfMode,
  type Content,
  type ScenarioRecord,
} from './core.js';
import { scenarioPicture } from './art.js';

const lastChoice = new Map<'on' | 'off', string>();
let loadToken = 0;

export function meridianInit(content: Content): void {
  const region = document.querySelector<HTMLElement>('[data-meridian]');
  if (!region) return;

  const stage = region.querySelector<HTMLElement>('[data-meridian-stage]');
  const stops = region.querySelector<HTMLElement>('[data-stops]');
  const panel = region.querySelector<HTMLElement>('[data-scenario-panel]');
  const picture = region.querySelector<HTMLElement>('[data-scenario-picture]');
  const time = region.querySelector<HTMLElement>('[data-scenario-time]');
  const title = region.querySelector<HTMLElement>('[data-scenario-title]');
  const copy = region.querySelector<HTMLElement>('[data-scenario-copy]');
  const moment = region.querySelector<HTMLElement>('[data-scenario-moment]');
  const modeRadios = Array.from(region.querySelectorAll<HTMLInputElement>('[data-mode-radio]'));
  if (!stage || !stops || !panel || !picture || !time || !title || !copy || !moment) return;

  const addressScenario = new URLSearchParams(window.location.search).get('scenario');
  const known = content.scenarios.some((scenario) => scenario.id === addressScenario);
  let currentId = known ? addressScenario! : 'on-work';
  let currentMode = modeOf(currentId);

  lastChoice.set(currentMode, currentId);

  const marker = document.createElement('span');
  marker.className = 'meridian-marker';
  marker.setAttribute('data-marker', 'true');
  marker.setAttribute('aria-hidden', 'true');

  const positionMarker = (scenarioId: string) => {
    const input = stops.querySelector<HTMLInputElement>(`[data-moment-radio="${scenarioId}"]`);
    const label = input?.closest('label');
    if (!label) return;
    const left = label.offsetLeft + label.offsetWidth / 2 - 6;
    marker.style.transform = `translateX(${left}px)`;
  };

  const buildStops = (mode: 'on' | 'off') => {
    stops.innerHTML = '';
    const list = scenariosOfMode(content.scenarios, mode);
    for (const scenario of list) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'moment';
      input.value = scenario.id;
      input.setAttribute('data-moment-radio', scenario.id);
      input.checked = scenario.id === currentId;
      label.append(input, ` ${scenario.name}`);
      stops.append(label);
    }
    stops.append(marker);
    positionMarker(currentId);
  };

  const setMode = (mode: 'on' | 'off', announce: boolean) => {
    currentMode = mode;
    const remembered = lastChoice.get(mode);
    const list = scenariosOfMode(content.scenarios, mode);
    const firstId = list[0]?.id ?? 'on-work';
    const target = remembered && list.some((s) => s.id === remembered) ? remembered : firstId;
    modeRadios.forEach((radio) => {
      radio.checked = radio.value === mode;
    });
    buildStops(mode);
    region.setAttribute('data-mode', mode);
    if (stage) stage.dataset.mode = mode;
    showScenario(target, announce, true);
  };

  const applyScenario = (scenario: ScenarioRecord) => {
    region.setAttribute('data-mode', scenario.mode);
    region.setAttribute('data-scenario', scenario.id);
    if (stage) stage.dataset.mode = scenario.mode;
    picture.setAttribute('data-scenario', scenario.id);
    picture.setAttribute('role', 'img');
    picture.setAttribute('aria-label', `Illustration: ${scenario.title}`);
    positionMarker(scenario.id);
    time.textContent = scenario.time;
    title.textContent = scenario.title;
    copy.textContent = scenario.copy;
    moment.textContent = scenario.moment;
    const newScene = scenarioPicture(scenario);
    if (reducedMotion()) {
      picture.innerHTML = newScene;
    } else {
      const wrapper = document.createElement('div');
      wrapper.className = 'scenario-fade';
      wrapper.innerHTML = newScene;
      picture.replaceChildren(wrapper);
      window.setTimeout(() => wrapper.classList.add('scene-shown'), 20);
    }
    copy.classList.remove('copy-slide');
    if (!reducedMotion()) {
      window.requestAnimationFrame(() => copy.classList.add('copy-slide'));
    }
  };

  const updateAddress = (scenarioId: string) => {
    const search = new URLSearchParams(window.location.search);
    search.set('scenario', scenarioId);
    const next = `${window.location.pathname}?${search.toString()}${window.location.hash}`;
    window.history.replaceState(null, '', next);
  };

  const showScenario = (scenarioId: string, announce: boolean, remember = true) => {
    if (remember) {
      lastChoice.set(modeOf(scenarioId), scenarioId);
    }
    const token = ++loadToken;
    panel.setAttribute('aria-busy', 'true');
    const radio = stops.querySelector<HTMLInputElement>(`[data-moment-radio="${scenarioId}"]`);
    if (radio) radio.checked = true;
    currentId = scenarioId;
    currentMode = modeOf(scenarioId);
    modeRadios.forEach((input) => {
      input.checked = input.value === currentMode;
    });
    updateAddress(scenarioId);

    fetch(`/api/scenarios/${scenarioId}`)
      .then((response) => {
        if (!response.ok) throw new Error('scenario failed');
        return response.json() as Promise<ScenarioRecord>;
      })
      .then((scenario) => {
        if (token !== loadToken) return;
        panel.removeAttribute('aria-busy');
        applyScenario(scenario);
        if (announce) {
          announceStatus(`${scenario.mode.toUpperCase()}: ${scenario.name}. ${scenario.title}.`);
        }
      })
      .catch(() => {
        if (token !== loadToken) return;
        panel.removeAttribute('aria-busy');
        announceStatus('This moment cannot be shown right now. Please choose it again.');
      });
  };

  modeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      if (radio.value !== currentMode) {
        setMode(radio.value as 'on' | 'off', true);
        return;
      }
      const remembered = lastChoice.get(currentMode);
      if (remembered === undefined || remembered !== currentId) {
        setMode(radio.value as 'on' | 'off', true);
      }
    });
  });

  stops.addEventListener('change', (event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (!input || !input.checked) return;
    if (input.value === currentId) return;
    showScenario(input.value, true);
  });

  stops.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const list = scenariosOfMode(content.scenarios, currentMode);
    const index = list.findIndex((scenario) => scenario.id === currentId);
    const nextIndex = event.key === 'ArrowRight' ? index + 1 : index - 1;
    const next = list[nextIndex];
    if (!next) return;
    const radio = stops.querySelector<HTMLInputElement>(`[data-moment-radio="${next.id}"]`);
    radio?.focus();
    showScenario(next.id, true);
  });

  let swipeStart: number | null = null;
  picture.addEventListener('touchstart', (event) => {
    swipeStart = event.touches[0]?.clientX ?? null;
  }, { passive: true });
  picture.addEventListener('touchend', (event) => {
    if (swipeStart === null) return;
    const end = event.changedTouches[0]?.clientX ?? swipeStart;
    const delta = end - swipeStart;
    swipeStart = null;
    if (Math.abs(delta) < 50) return;
    const list = scenariosOfMode(content.scenarios, currentMode);
    const index = list.findIndex((scenario) => scenario.id === currentId);
    const target = list[delta < 0 ? index + 1 : index - 1];
    if (!target) return;
    showScenario(target.id, true);
  });

  buildStops(currentMode);
  const initialRadio = stops.querySelector<HTMLInputElement>(`[data-moment-radio="${currentId}"]`);
  if (initialRadio) initialRadio.checked = true;
  showScenario(currentId, false, false);
}
