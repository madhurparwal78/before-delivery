import type { Breakpoint, StyleKey } from '../../shared/types.js';
import { setAttr } from '../dom.js';
import { canvasElement, frameElement, layoutFrames } from './canvas.js';
import { focusNodeRow } from './navigator.js';
import { render, state } from './store.js';

const FAN_MS = 420;
const EFFECT_MS = 160;

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function fanAvailable(): boolean {
  return state.layout !== 'phone' && state.selectedId !== null;
}

let frame = 0;
let timer = 0;
let direction = 0;
let anchorTime = 0;
let anchorProgress = 0;

function paint(): void {
  const canvas = canvasElement();
  setAttr(canvas, 'data-fan', state.fan.motion);
  setAttr(canvas, 'data-fan-progress', state.fan.progress.toFixed(2));
  layoutFrames();
}

function stop(): void {
  if (frame !== 0) window.cancelAnimationFrame(frame);
  if (timer !== 0) window.clearTimeout(timer);
  frame = 0;
  timer = 0;
  direction = 0;
}

function finish(): void {
  stop();
  render();
  if (state.fan.motion === 'closed' && state.selectedId !== null) focusNodeRow(state.selectedId);
}

function settle(): void {
  const open = direction > 0;
  state.fan.progress = open ? 1 : 0;
  state.fan.motion = open ? 'open' : 'closed';
  paint();
  finish();
}

function step(now: number): void {
  const next = anchorProgress + (direction * (now - anchorTime)) / FAN_MS;
  state.fan.progress = Math.min(1, Math.max(0, next));
  if ((direction > 0 && state.fan.progress >= 1) || (direction < 0 && state.fan.progress <= 0)) {
    settle();
    return;
  }
  state.fan.motion = direction > 0 ? 'opening' : 'closing';
  paint();
  frame = window.requestAnimationFrame(step);
}

function run(towards: 1 | -1): void {
  direction = towards;
  state.fan.motion = towards > 0 ? 'opening' : 'closing';
  if (reducedMotion()) {
    state.fan.progress = towards > 0 ? 1 : 0;
    state.fan.motion = towards > 0 ? 'open' : 'closed';
    stop();
    direction = 0;
    paint();
    render();
    if (state.fan.motion === 'closed' && state.selectedId !== null) focusNodeRow(state.selectedId);
    return;
  }
  render();
  paint();
  anchorProgress = state.fan.progress;
  anchorTime = performance.now();
  const remaining = (towards > 0 ? 1 - anchorProgress : anchorProgress) * FAN_MS;
  if (timer !== 0) window.clearTimeout(timer);
  timer = window.setTimeout(settle, remaining);
  if (frame === 0) frame = window.requestAnimationFrame(step);
}

export function openFan(): void {
  if (!fanAvailable()) return;
  if (state.fan.motion === 'open') return;
  run(1);
}

export function closeFan(): void {
  if (state.fan.motion === 'closed') return;
  run(-1);
}

export function toggleFan(): void {
  if (state.fan.motion === 'open' || state.fan.motion === 'opening') {
    closeFan();
    return;
  }
  openFan();
}

export function fanShowing(): boolean {
  return state.fan.motion !== 'closed';
}

function clearUpdatedTags(): void {
  for (const tag of document.querySelectorAll('[data-updated-tag]')) tag.remove();
}

/** Only the person who made a change sees ripples and pulses. */
export function rippleFrames(breakpoints: readonly Breakpoint[]): void {
  clearUpdatedTags();
  if (reducedMotion()) {
    for (const bp of breakpoints) {
      const tag = document.createElement('span');
      tag.setAttribute('data-updated-tag', '');
      tag.className = 'updated-tag';
      tag.textContent = 'Updated';
      frameElement(bp).append(tag);
    }
    return;
  }
  for (const bp of breakpoints) {
    const element = frameElement(bp);
    element.setAttribute('data-ripple', 'true');
    window.setTimeout(() => element.removeAttribute('data-ripple'), EFFECT_MS);
  }
}

export function pulsePips(breakpoints: readonly Breakpoint[], property: StyleKey): void {
  if (reducedMotion()) return;
  for (const bp of breakpoints) {
    const pip = document.querySelector<HTMLElement>(
      `[data-property="${property}"] [data-pip="${bp}"]`,
    );
    if (!pip) continue;
    pip.setAttribute('data-pulse', 'true');
    window.setTimeout(() => pip.removeAttribute('data-pulse'), EFFECT_MS);
  }
}

export function focusFrame(bp: Breakpoint): void {
  frameElement(bp).focus();
}
