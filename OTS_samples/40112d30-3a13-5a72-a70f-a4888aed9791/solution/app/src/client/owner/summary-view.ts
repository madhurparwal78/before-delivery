import { M55_56, M84 } from '../../shared/messages.ts';
import type { Summary } from '../../shared/types.ts';
import { h, replaceChildren } from '../lib/dom.ts';
import { announce } from '../lib/live.ts';
import { lightOne } from './light.ts';
import { questionSection } from './summary-section.ts';

// The summary's body. `show` replaces the content in place; the lit section and a focused chart survive each replacement.

interface SummaryView {
  /** Draw the numbers; when the count text changed since the last drawing, announce it. */
  show: (summary: Summary) => void;
}

export function summaryView(count: HTMLElement, body: HTMLElement): SummaryView {
  const show = (summary: Summary): void => {
    const text = M55_56(Number(summary.count));
    const changed = count.textContent !== '' && count.textContent !== text;
    count.textContent = text;
    const kept = keptState(body);
    replaceChildren(body, summary.questions.length === 0 || summary.count === '0'
      ? h('p', { class: 'empty' }, M84)
      : summary.questions.map((question) => questionSection(question, summary.count)));
    restore(body, kept);
    if (changed) announce(text);
  };
  return { show };
}

interface Kept { lit: string | undefined; focused: string | undefined }

function keptState(body: HTMLElement): Kept {
  const focused = document.activeElement instanceof SVGElement ? document.activeElement.closest<HTMLElement>('.question') : null;
  return { lit: body.querySelector<HTMLElement>('.question[data-lit]')?.dataset['key'], focused: focused?.dataset['key'] };
}

function restore(body: HTMLElement, kept: Kept): void {
  const sections = [...body.querySelectorAll<HTMLElement>('.question')];
  const withKey = (key: string | undefined): HTMLElement | undefined => sections.find((section) => section.dataset['key'] === key);
  lightOne(sections, withKey(kept.lit) ?? sections.find((section) => section.querySelector('.chart')));
  withKey(kept.focused)?.querySelector<SVGElement>('.chart')?.focus();
}
