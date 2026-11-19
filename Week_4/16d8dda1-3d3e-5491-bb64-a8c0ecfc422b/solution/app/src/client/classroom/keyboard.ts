import { useEffect, useRef, type RefObject } from 'react';
import type { Direction } from './cursor';
import type { ClassroomStore } from './store';

const ARROWS = new Set<string>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

function isArrow(key: string): key is Direction {
  return ARROWS.has(key);
}

function isTextField(element: HTMLElement | null): boolean {
  if (!element) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(element.type);
}

/**
 * The classroom shortcuts: they act while focus is anywhere in the classroom or its panels (or on the page body),
 * work with focus on a button, and never act while focus is in a text field or a dialog.
 */
export function useClassroomKeys(store: ClassroomStore, root: RefObject<HTMLElement | null>, openChat: () => void): void {
  const chat = useRef(openChat);
  chat.current = openChat;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (isTextField(target) || target?.closest('.dialog')) return;
      const inside = target === document.body || target === null || root.current?.contains(target) || target.closest('[data-sheet]');
      const snapshot = store.get().snapshot;
      if (!inside || !snapshot) return;
      const learner = snapshot.you.role === 'learner';
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

      if (isArrow(key)) {
        if (target?.closest('[role="tab"]')) return;
        event.preventDefault();
        store.moveCursor(key);
      } else if (key === 'Enter' && learner) {
        const cursor = store.get().cursor;
        if (target?.closest('[data-native-enter]') || cursor === null) return;
        event.preventDefault();
        void store.takeSeat(cursor);
      } else if (key === 'h' && learner) {
        void store.toggleHand();
      } else if (key === 'c') {
        event.preventDefault();
        chat.current();
      } else if (learner && /^[1-6]$/.test(key)) {
        void store.answerPoll(Number(key));
      } else if (!learner && key === 'PageDown') {
        event.preventDefault();
        void store.moveSlide(1);
      } else if (!learner && key === 'PageUp') {
        event.preventDefault();
        void store.moveSlide(-1);
      } else if (!learner && key === 't') {
        void store.takeNextHand();
      } else if (!learner && key === 's') {
        void store.spotlightCursorSeat();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [store, root]);
}
