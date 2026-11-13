// LA and I open a panel and ask for focus inside it (store.showPanel); the panel answers once it has rendered.
import { useEffect, useRef } from 'react';
import { useEditorState, type PanelId } from '../store.ts';

let handled = 0;

export function useFocusRequest(panel: PanelId, focus: () => void): void {
  const request = useEditorState().focusRequest;
  const run = useRef(focus);
  run.current = focus;
  useEffect(() => {
    if (!request || request.panel !== panel || request.n <= handled) return;
    handled = request.n;
    run.current();
  }, [request, panel]);
}
