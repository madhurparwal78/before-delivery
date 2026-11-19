import { createContext, useContext, type ButtonHTMLAttributes } from 'react';
import type { SessionSnapshot } from '../../shared/wire';
import type { LayoutMode } from './motion';
import type { ClassroomState, ClassroomStore } from './store';

export interface ClassroomView {
  store: ClassroomStore;
  state: ClassroomState;
  /** The ready snapshot (the page renders panels only once there is one). */
  snapshot: SessionSnapshot;
  /** performance.now() refreshed while a breakout or a return walk needs a clock. */
  now: number;
  reduced: boolean;
  mode: LayoutMode;
  isOwner: boolean;
  canRun: boolean;
  /** Dialogs live at page level so they outlive the tablet sheet that opened them. */
  openDialog: (kind: 'poll' | 'breakouts') => void;
}

export const ClassroomContext = createContext<ClassroomView | null>(null);

export function useClassroom(): ClassroomView {
  const view = useContext(ClassroomContext);
  if (!view) throw new Error('useClassroom needs a ClassroomContext.Provider');
  return view;
}

type ActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  /** The store's pending key for this action: while it is in flight the button is disabled and aria-busy. */
  actionKey: string;
  /** Omitted for a submit button whose form does the work. */
  onPress?: () => void;
};

export function ActionButton({ actionKey, onPress, disabled, children, ...rest }: ActionButtonProps) {
  const { state } = useClassroom();
  const busy = state.pending.has(actionKey);
  return (
    <button type="button" {...rest} disabled={disabled || busy} aria-busy={busy || undefined} onClick={onPress}>
      {children}
    </button>
  );
}
