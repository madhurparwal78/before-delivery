import { announce, api, pick, pickAll } from './dom';
import { openDialog } from './dialogs';
import { rollTo } from './morph';
import { screenData } from './navigate';
import { COUNTRY_NAMES, MEASURE_NAMES, MODE_NAMES, STAGE_NAMES, announce as announceCopy } from '../server/domain/copy';
import { MATERIALS, MEASURES, STAGES } from '../server/domain/factors';
import type { MeasureFigure } from '../server/domain/footprint';

function measures(): MeasureFigure[] {
  const held = screenData().measures;
  return Array.isArray(held) ? (held as MeasureFigure[]) : [];
}

function chosenMeasure(): string {
  const radio = pick('[data-part="measures"] [aria-checked="true"]');
  return radio ? (radio.getAttribute('data-measure') ?? 'climate') : 'climate';
}

/** Choosing a measure moves the same elements: widths, numerals and the marker. */
export function showMeasure(measure: string, speak: boolean): void {
  const found = measures().find((entry) => entry.measure === measure);
  if (!found) return;
  for (const radio of pickAll('[data-part="measures"] [role="radio"]')) {
    const own = radio.getAttribute('data-measure');
    radio.setAttribute('aria-checked', own === measure ? 'true' : 'false');
    radio.setAttribute('tabindex', own === measure ? '0' : '-1');
  }
  const band = pick('[data-part="strata"]');
  if (band) band.setAttribute('data-measure', measure);
  for (const stage of found.stages) {
    const stratum = pick<HTMLElement>(`[data-part="stratum"][data-stage="${stage.stage}"]`);
    if (stratum) {
      stratum.setAttribute('data-share', stage.share);
      stratum.style.setProperty('--share', `${stage.share}%`);
      const share = pick('.stratum-share', stratum);
      if (share) share.textContent = `${stage.share}%`;
    }
    const figure = pick(`[data-part="stratum-figure"][data-stage="${stage.stage}"]`);
    if (figure) rollTo(figure, stage.shown);
  }
  const total = pick('[data-part="total-figure"]');
  if (total) rollTo(total, found.totalShown);
  const marker = pick<HTMLElement>('[data-part="hotspot-marker"]');
  if (marker) {
    marker.setAttribute('data-stage', found.hotspot);
    marker.style.setProperty('--at', String(STAGES.indexOf(found.hotspot)));
  }
  if (speak) {
    announce(
      announceCopy.measureChosen(
        MEASURE_NAMES[found.measure],
        found.totalShown,
        STAGE_NAMES[found.hotspot],
      ),
    );
  }
}

export function measureKeys(event: KeyboardEvent): boolean {
  const composite = pick('[data-part="measures"]');
  if (!composite || !(event.target instanceof Element) || !composite.contains(event.target)) return false;
  const current = MEASURES.indexOf(chosenMeasure() as (typeof MEASURES)[number]);
  let next = current;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % MEASURES.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + MEASURES.length) % MEASURES.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = MEASURES.length - 1;
  else if (event.key === 'Enter' || event.key === ' ') {
    const found = measures().find((entry) => entry.measure === chosenMeasure());
    if (found) void openFactors(found.hotspot);
    event.preventDefault();
    return true;
  } else return false;
  event.preventDefault();
  const chosen = MEASURES[next] as string;
  showMeasure(chosen, true);
  const radio = pick<HTMLElement>(`[data-part="measures"] [data-measure="${chosen}"]`);
  if (radio) radio.focus();
  return true;
}

function rowName(id: string, kind: string): string {
  if (kind === 'material') return MATERIALS.find((material) => material.id === id)?.name ?? id;
  if (kind === 'grid') return COUNTRY_NAMES[id as keyof typeof COUNTRY_NAMES] ?? id;
  if (kind === 'mode') return MODE_NAMES[id as keyof typeof MODE_NAMES] ?? id;
  if (kind === 'use') return 'Wash';
  return 'Disposal';
}

let popoverStage = 'materials';

export async function openFactors(stage: string): Promise<void> {
  const popover = pick<HTMLElement>('#factors-popover');
  const resultId = screenData().resultId;
  if (!popover || typeof resultId !== 'string') return;
  popoverStage = stage;
  const measure = chosenMeasure();
  const answer = await api(
    'GET',
    `/api/results/${resultId}/factors?measure=${encodeURIComponent(measure)}&stage=${encodeURIComponent(stage)}`,
  );
  const title = pick('[data-part="popover-title"]', popover);
  const name = `Factors for ${STAGE_NAMES[stage as keyof typeof STAGE_NAMES]}`;
  if (title) title.textContent = name;
  popover.setAttribute('aria-label', name);
  const edition = pick('[data-part="popover-edition"]', popover);
  if (edition) edition.textContent = `Factor edition ${String(answer.body.edition ?? '')}`;
  const list = pick('[data-part="popover-rows"]', popover);
  if (list) {
    list.textContent = '';
    const rows = (answer.body.rows ?? []) as { id: string; kind: string; value: string; unit: string }[];
    for (const row of rows) {
      const item = document.createElement('li');
      item.textContent = `${rowName(row.id, row.kind)}: ${row.value} ${row.unit}`;
      list.append(item);
    }
  }
  const opener =
    pick<HTMLElement>(`[data-part="measures"] [data-measure="${measure}"]`) ??
    pick<HTMLElement>('[data-part="measures"]');
  openDialog(popover, opener);
}

export function nextStage(): void {
  const at = STAGES.indexOf(popoverStage as (typeof STAGES)[number]);
  const next = STAGES[(at + 1) % STAGES.length] as string;
  void openFactors(next);
}
