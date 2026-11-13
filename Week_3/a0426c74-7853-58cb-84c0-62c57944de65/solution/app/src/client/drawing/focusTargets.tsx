import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import type { FocusTarget } from '../store/index.ts';

/** The elements that can receive a focus request of the store, registered by whoever renders them. */
export class FocusTargets {
  private readonly elements = new Map<FocusTarget, HTMLElement>();

  ref = (target: FocusTarget) => (element: HTMLElement | null): void => {
    if (element) this.elements.set(target, element);
    else this.elements.delete(target);
  };

  /** Focuses the element registered for `target`; false when none is rendered (yet). */
  focus(target: FocusTarget): boolean {
    const element = this.elements.get(target);
    element?.focus();
    return element !== undefined;
  }
}

const FocusTargetsContext = createContext<FocusTargets | null>(null);

/** Creates the registry of a screen; provide it with `FocusTargetsProvider`. */
export function useFocusTargetsRegistry(): FocusTargets {
  return useState(() => new FocusTargets())[0];
}

export function FocusTargetsProvider({ targets, children }: { targets: FocusTargets; children: ReactNode }) {
  return <FocusTargetsContext.Provider value={targets}>{children}</FocusTargetsContext.Provider>;
}

/** The ref callback that registers an element as a focus target. */
export function useFocusTarget(target: FocusTarget): (element: HTMLElement | null) => void {
  const targets = useContext(FocusTargetsContext);
  if (targets === null) throw new Error('useFocusTarget used outside FocusTargetsProvider');
  return targets.ref(target);
}
