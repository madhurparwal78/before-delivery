import { entityCount, plural } from './numbers.js';
import type { Entity } from './model.js';
import { KIND_WORDS } from './labels.js';

export function entityAdded(type: Entity['type'], handle: string): string {
  return `${KIND_WORDS[type]} ${handle} added`;
}

export function entitiesAdded(count: number): string {
  return `${entityCount(count)} added`;
}

export function moved(count: number): string {
  return `Moved ${entityCount(count)}`;
}

export function copied(count: number): string {
  return `Copied ${entityCount(count)}`;
}

export function rotated(count: number): string {
  return `Rotated ${entityCount(count)}`;
}

export function scaled(count: number): string {
  return `Scaled ${entityCount(count)}`;
}

export function mirrored(count: number): string {
  return `Mirrored ${entityCount(count)}`;
}

export function erased(count: number): string {
  return `Erased ${entityCount(count)}`;
}

export function arrayed(copies: number): string {
  return `Arrayed: ${plural(copies, 'copy', 'copies')} added`;
}

export function changedBy(command: 'Trim' | 'Extend' | 'Fillet' | 'Chamfer', count: number): string {
  return `${command}: ${entityCount(count)} changed`;
}

export function offsetAdded(count: number): string {
  return `Offset: ${entityCount(count)} added`;
}

export function exploded(handle: string, count: number): string {
  return `Exploded ${handle}: ${entityCount(count)} added`;
}

export function blockDefined(name: string, redefined: boolean): string {
  return `Block ${name} ${redefined ? 'redefined' : 'defined'}`;
}

export function undoAnnouncement(command: string): string {
  return `Undo: ${command}`;
}

export function redoAnnouncement(command: string): string {
  return `Redo: ${command}`;
}

export const NOTHING_TO_UNDO = 'Nothing to undo.';
export const NOTHING_TO_REDO = 'Nothing to redo.';

export function remoteChange(user: string, handles: string[]): string {
  if (handles.length === 1) return `${user} moved ${handles[0]}`;
  return `${user} changed ${entityCount(handles.length)}`;
}

export function aidToggle(name: 'Snap' | 'Ortho' | 'Grid' | 'Polar', on: boolean): string {
  return `${name} ${on ? 'on' : 'off'}`;
}

export function layerLockToast(user: string, layer: string, count: number): string {
  return `${user} locked ${layer}. ${entityCount(count)} left your selection.`;
}

export function stoppedFollowing(user: string): string {
  return `Stopped following ${user}.`;
}
