import { useCallback, useState } from "react";

/** The subject of a dialog. It stays after the dialog closes so the dialog can fade out showing the same words. */
export function useDialogTarget<T>() {
  const [state, setState] = useState<{ target: T | null; open: boolean }>({ target: null, open: false });
  const show = useCallback((target: T) => setState({ target, open: true }), []);
  const hide = useCallback(() => setState((current) => ({ ...current, open: false })), []);
  return { target: state.target, open: state.open, show, hide };
}
