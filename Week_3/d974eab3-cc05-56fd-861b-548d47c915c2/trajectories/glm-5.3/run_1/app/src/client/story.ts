import { INNER_PACE_PANELS, NITRATE_STEPS, OXYGEN_STAGES } from './copy.js';

export function panelTitle(index: number): string {
  return INNER_PACE_PANELS[index - 1]?.title ?? '';
}

export function stageTitle(index: number): string {
  return OXYGEN_STAGES[index - 1]?.title ?? '';
}

export function pathwayText(value: number): string {
  return NITRATE_STEPS[value - 1]?.text ?? '';
}

export function pathwayName(value: number): string {
  return NITRATE_STEPS[value - 1]?.name ?? '';
}

export function progressToPanel(progress: number): number {
  if (progress < 0.25) return 1;
  if (progress < 0.75) return 2;
  return 3;
}

export function progressToStage(progress: number): number {
  return Math.min(5, Math.floor(progress * 5) + 1);
}

export function panelProgress(panel: number): number {
  return (panel - 1) / 2;
}

export function stageProgress(stage: number): number {
  return (stage - 0.5) / 5;
}

export function roundProgress(progress: number): string {
  return (Math.round(progress * 100) / 100).toFixed(2);
}

export function chapterProgress(element: HTMLElement): number {
  const top = element.offsetTop;
  const height = element.offsetHeight;
  const span = height - window.innerHeight;
  if (span <= 0) return 0;
  const travelled = window.scrollY - top;
  return Math.min(1, Math.max(0, travelled / span));
}
