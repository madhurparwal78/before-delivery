// Tamperglass pane: four check lines, the bucket meter and the verdicts announcement.
import { el } from './publicPage';
import type { ForensicsBody, ForensicsLine } from './types';

export interface TamperglassElements {
  pane: HTMLElement;
  lines: Record<'signature' | 'bucket' | 'sanitiser' | 'link', HTMLElement>;
  meter: HTMLMeterElement;
  verdicts: HTMLElement;
  container: HTMLElement;
}

const STAGE_LABELS: Record<ForensicsLine['stage'], string> = {
  signature: 'Signature',
  bucket: 'Bucket',
  sanitiser: 'Sanitiser',
  link: 'Link',
};

export function buildTamperglass(insideSheet: boolean): TamperglassElements {
  const container = insideSheet
    ? el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Tamperglass', class: 'sheet', hidden: 'hidden' })
    : el('aside', { role: 'complementary', 'aria-label': 'Tamperglass', class: 'workspace-tamper' });
  const lines: Record<'signature' | 'bucket' | 'sanitiser' | 'link', HTMLElement> = {
    signature: el('li', { tabindex: '0' }),
    bucket: el('li', { tabindex: '0' }),
    sanitiser: el('li', { tabindex: '0' }),
    link: el('li', { tabindex: '0' }),
  };
  for (const stage of ['signature', 'bucket', 'sanitiser', 'link'] as const) {
    const line = lines[stage];
    line.append(el('span', { class: 'stage' }, `${STAGE_LABELS[stage]}`), el('span', { class: 'verdict' }, ''), el('span', { class: 'before' }));
  }
  const list = el('ul', { class: 'tamper-lines', 'aria-label': 'Checks' }, lines.signature, lines.bucket, lines.sanitiser, lines.link);
  const meter = el('meter', { min: '0', max: '8', value: '8', 'aria-label': 'Token bucket' }) as HTMLMeterElement;
  const verdicts = el('div', { role: 'status', 'aria-live': 'polite', class: 'visually-hidden', id: 'verdicts-announcements' });
  const prompt = el('p', { class: 'pane-prompt' }, 'Select a message to see what was checked.');
  container.append(prompt, list, el('p', {}, meter), verdicts);
  return { pane: container, lines, meter, verdicts, container };
}

export function showPrompt(pane: TamperglassElements, message: string): void {
  const prompt = pane.container.querySelector('.pane-prompt');
  if (prompt) prompt.textContent = message;
  for (const stage of Object.keys(pane.lines) as ('signature' | 'bucket' | 'sanitiser' | 'link')[]) {
    const verdict = pane.lines[stage].querySelector('.verdict');
    if (verdict) verdict.textContent = '';
    const before = pane.lines[stage].querySelector('.before');
    if (before) before.textContent = '';
  }
}

export function setChecking(pane: TamperglassElements): void {
  const prompt = pane.container.querySelector('.pane-prompt');
  if (prompt) prompt.textContent = '';
  for (const stage of Object.keys(pane.lines) as ('signature' | 'bucket' | 'sanitiser' | 'link')[]) {
    const verdict = pane.lines[stage].querySelector('.verdict');
    if (verdict) {
      verdict.textContent = 'checking';
      verdict.classList.remove('line-settle');
    }
    const before = pane.lines[stage].querySelector('.before');
    if (before) before.textContent = '';
  }
}

export function settleStage(pane: TamperGlassStages, stage: ForensicsLine['stage'], line: ForensicsLine): void {
  const element = pane.lines[stage];
  const verdict = element.querySelector('.verdict');
  if (verdict) {
    verdict.textContent = line.verdict;
    verdict.classList.remove('line-settle');
    void (verdict as HTMLElement).offsetWidth;
    verdict.classList.add('line-settle');
  }
  if (stage === 'bucket' && line.level !== null && line.level !== undefined) {
    const previous = pane.meter.value;
    pane.meter.value = line.level;
    pane.meter.dataset.previous = String(previous);
  }
}

export type TamperGlassStages = TamperglassElements;

export function markSettled(pane: TamperglassElements, body: ForensicsBody): void {
  for (const line of body.lines) {
    settleStage(pane, line.stage, line);
  }
}

export function verdictSentence(body: ForensicsBody): string {
  const byStage = new Map(body.lines.map((line) => [line.stage, line.verdict]));
  return `Checked: ${byStage.get('signature')}; ${byStage.get('bucket')}; ${byStage.get('sanitiser')}; ${byStage.get('link')}.`;
}
