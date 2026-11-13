// tablist "Layouts": Model and the paper layouts, then a button that adds the next layout.
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { describeError } from '../commandLine/session.ts';
import { useEditorState, useEditorStore } from '../store.ts';

export function LayoutBar() {
  const store = useEditorStore();
  const { drawing, layout } = useEditorState();
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const focusActive = useRef(false);
  const layouts = drawing?.layouts ?? [];
  const scale = layouts.find((item) => item.name === layout)?.viewport_scale;

  useEffect(() => {
    if (!focusActive.current) return;
    focusActive.current = false;
    tabs.current.get(layout)?.focus();
  }, [layout, layouts.length]);

  const addLayout = async (): Promise<void> => {
    try {
      if (!(await store.runCommand('LAYOUT', { op: 'new' }))) return;
      await store.reload();
      const added = store.current.drawing?.layouts.at(-1);
      if (added) {
        focusActive.current = true;
        store.setLayout(added.name);
      }
    } catch (error) {
      for (const line of describeError(error)) store.pushHistory(line);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const names = layouts.map((item) => item.name);
    const index = names.indexOf(layout);
    const next = event.key === 'ArrowRight' ? (index + 1) % names.length : event.key === 'ArrowLeft' ? (index + names.length - 1) % names.length : -1;
    const name = names[next];
    if (!name) return;
    event.preventDefault();
    focusActive.current = true;
    store.setLayout(name);
  };

  return (
    <div className="layout-bar">
      <div role="tablist" aria-label="Layouts" className="layout-tabs" onKeyDown={onKeyDown}>
        {layouts.map((item) => (
          <button
            key={item.name}
            ref={(element) => { if (element) tabs.current.set(item.name, element); else tabs.current.delete(item.name); }}
            type="button"
            role="tab"
            aria-selected={layout === item.name}
            tabIndex={layout === item.name ? 0 : -1}
            className="layout-tab"
            onClick={() => store.setLayout(item.name)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <button type="button" className="layout-add" aria-label="New layout" onClick={() => void addLayout()}>
        <span aria-hidden="true">+</span>
      </button>
      {scale && <span className="layout-scale">Viewport scale {scale}</span>}
    </div>
  );
}
