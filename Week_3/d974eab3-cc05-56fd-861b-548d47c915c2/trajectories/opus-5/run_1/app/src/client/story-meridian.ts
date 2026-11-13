import { escapeHtml } from '../shared/escape';
import {
  SCENARIO_FAILED_MESSAGE,
  scenarioAnnouncement,
} from '../shared/messages';
import {
  START_SCENARIO_ID,
  firstScenarioIdOfMode,
  isScenarioId,
  modeOfScenarioId,
  neighbourScenarioId,
  type ScenarioId,
} from '../shared/scenarios';
import type { Mode, Scenario, ScenarioSummary } from '../shared/types';
import { fetchScenario } from './api';
import { sceneSvg } from './art';
import {
  all,
  announce,
  clearAlert,
  fillWith,
  find,
  need,
  onHorizontalSwipe,
  onLayoutChange,
  prefersReducedMotion,
  showAlert,
} from './dom';

const SCENE_FADE_MS = 320;
const COPY_SLIDE_MS = 320;
const SWIPE_THRESHOLD_PX = 50;

/** The ON/OFF Meridian: one mode, four stops and the latest choice shown. */
class Meridian {
  private readonly region = need<HTMLElement>('[data-chapter="lifestyle"]');
  private readonly stops = need<HTMLElement>('[data-moments]', this.region);
  private readonly markerHost = need<HTMLElement>(
    '.meridian__stops-wrap',
    this.region,
  );
  private readonly marker = need<HTMLElement>('[data-marker]', this.region);
  private readonly panel = need<HTMLElement>(
    '[data-meridian-panel]',
    this.region,
  );
  private readonly art = need<HTMLElement>('[data-scenario-art]', this.region);
  private readonly copyBlock = need<HTMLElement>(
    '[data-scenario-copy-block]',
    this.region,
  );
  private readonly timeLine = need<HTMLElement>(
    '[data-scenario-time]',
    this.region,
  );
  private readonly titleLine = need<HTMLElement>(
    '[data-scenario-title]',
    this.region,
  );
  private readonly textLine = need<HTMLElement>(
    '[data-scenario-text]',
    this.region,
  );
  private readonly momentLine = need<HTMLElement>(
    '[data-scenario-moment]',
    this.region,
  );
  private readonly lastChosen = new Map<Mode, ScenarioId>();
  private mode: Mode;
  private requested: ScenarioId;
  private token = 0;

  constructor(private readonly scenarios: ScenarioSummary[]) {
    const wanted = new URL(window.location.href).searchParams.get('scenario');
    const start: ScenarioId =
      wanted !== null && isScenarioId(wanted) ? wanted : START_SCENARIO_ID;
    this.mode = modeOfScenarioId(start);
    this.requested = start;
    this.lastChosen.set(this.mode, start);

    for (const radio of all<HTMLInputElement>('[data-mode-radio]')) {
      radio.checked = radio.value === this.mode;
      radio.addEventListener('change', () => {
        if (radio.checked && (radio.value === 'on' || radio.value === 'off')) {
          this.chooseMode(radio.value);
        }
      });
    }
    onHorizontalSwipe(this.art, SWIPE_THRESHOLD_PX, (step) => {
      const next = neighbourScenarioId(this.requested, step);
      if (next !== null) {
        this.chooseScenario(next);
      }
    });
    onLayoutChange(() => {
      this.placeMarker();
    });

    this.renderStops(start);
    this.region.dataset['mode'] = this.mode;
    this.region.dataset['scenario'] = start;
    if (wanted !== null && !isScenarioId(wanted)) {
      this.writeAddress(start);
    }
    void this.load(start, false);
    requestAnimationFrame(() => {
      this.marker.classList.add('is-ready');
    });
  }

  private renderStops(checkedId: ScenarioId): void {
    const wanted = this.scenarios.filter((item) => item.mode === this.mode);
    fillWith(
      this.stops,
      wanted
        .map(
          (item) =>
            `<label class="stop"><input type="radio" name="moment" value="${escapeHtml(item.id)}" data-moment${item.id === checkedId ? ' checked' : ''}><span class="stop__name">${escapeHtml(item.name)}</span></label>`,
        )
        .join(''),
    );
    for (const radio of all<HTMLInputElement>('[data-moment]', this.stops)) {
      radio.addEventListener('change', () => {
        if (radio.checked && isScenarioId(radio.value)) {
          this.chooseScenario(radio.value);
        }
      });
    }
    this.placeMarker();
  }

  /** The marker sits under the chosen stop in either stop layout. */
  private placeMarker(): void {
    const checked = find<HTMLInputElement>('[data-moment]:checked', this.stops);
    const label = checked?.closest('label');
    if (label === null || label === undefined) {
      return;
    }
    const host = this.markerHost.getBoundingClientRect();
    const box = label.getBoundingClientRect();
    const x = box.left - host.left + box.width / 2;
    const y = box.bottom - host.top;
    this.marker.style.transform = `translate(calc(${x.toFixed(1)}px - 50%), ${y.toFixed(1)}px)`;
    this.marker.dataset['marker'] = checked?.value ?? '';
  }

  private writeAddress(id: ScenarioId): void {
    const url = new URL(window.location.href);
    url.searchParams.set('scenario', id);
    window.history.replaceState(window.history.state, '', url);
  }

  private chooseMode(mode: Mode): void {
    this.mode = mode;
    const target = this.lastChosen.get(mode) ?? firstScenarioIdOfMode(mode);
    this.lastChosen.set(mode, target);
    this.renderStops(target);
    this.writeAddress(target);
    void this.load(target, true);
  }

  private chooseScenario(id: ScenarioId): void {
    if (id === this.requested) {
      return;
    }
    this.lastChosen.set(modeOfScenarioId(id), id);
    const radio = find<HTMLInputElement>(
      `[data-moment][value="${id}"]`,
      this.stops,
    );
    if (radio !== null) {
      radio.checked = true;
    }
    this.placeMarker();
    this.writeAddress(id);
    void this.load(id, true);
  }

  /** Every scenario shown is fetched anew; only the latest answer is used. */
  private async load(id: ScenarioId, shouldAnnounce: boolean): Promise<void> {
    this.requested = id;
    const token = ++this.token;
    clearAlert(this.panel);
    this.panel.setAttribute('aria-busy', 'true');
    try {
      const scenario = await fetchScenario(id);
      if (token !== this.token) {
        return;
      }
      this.panel.removeAttribute('aria-busy');
      this.apply(scenario, shouldAnnounce);
    } catch {
      if (token !== this.token) {
        return;
      }
      this.panel.removeAttribute('aria-busy');
      showAlert(this.panel, SCENARIO_FAILED_MESSAGE);
    }
  }

  private apply(scenario: Scenario, shouldAnnounce: boolean): void {
    this.region.dataset['mode'] = scenario.mode;
    this.region.dataset['scenario'] = scenario.id;
    this.art.setAttribute('role', 'img');
    this.art.setAttribute('aria-label', `Illustration: ${scenario.title}`);
    this.art.dataset['scenario'] = scenario.id;

    const previous = all<HTMLElement>('.meridian__scene', this.art);
    const scene = document.createElement('div');
    scene.className = 'meridian__scene';
    fillWith(scene, sceneSvg(scenario.id));
    this.art.append(scene);
    // The first scene is the page's own starting state, so it does not fade in.
    const fade =
      prefersReducedMotion() || previous.length === 0 ? 0 : SCENE_FADE_MS;
    if (fade > 0) {
      scene.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fade });
      for (const old of previous) {
        old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fade });
      }
      this.copyBlock.animate(
        [
          { transform: 'translateX(20px)', opacity: 0 },
          { transform: 'translateX(0)', opacity: 1 },
        ],
        { duration: COPY_SLIDE_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    }
    window.setTimeout(() => {
      for (const old of previous) {
        old.remove();
      }
    }, fade);

    this.timeLine.textContent = scenario.time;
    this.titleLine.textContent = scenario.title;
    this.textLine.textContent = scenario.copy;
    this.momentLine.textContent = scenario.moment;
    if (shouldAnnounce) {
      announce(
        scenarioAnnouncement(scenario.mode, scenario.name, scenario.title),
      );
    }
  }
}

export function setupMeridian(scenarios: ScenarioSummary[]): void {
  new Meridian(scenarios);
}
