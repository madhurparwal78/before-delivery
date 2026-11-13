// "Top" and "2D Wireframe": the canvas view menus. Each holds the one view this editor draws.
import { useEffect, useRef, useState } from 'react';

const VIEWS = ['Top', '2D Wireframe'] as const;

function ViewMenu({ name }: { name: (typeof VIEWS)[number] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitemradio"]')?.focus();
    const onPress = (event: MouseEvent): void => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onPress, true);
    return () => document.removeEventListener('mousedown', onPress, true);
  }, [open]);

  const close = (): void => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className="view-menu">
      <button ref={button} type="button" className="btn btn-outline view-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {name}
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label={name} className="menu view-popup" onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}>
          <button type="button" role="menuitemradio" aria-checked="true" className="menu-item" onClick={close}>{name}</button>
        </div>
      )}
    </div>
  );
}

export function ViewControls() {
  return (
    <div className="view-controls">
      {VIEWS.map((name) => <ViewMenu key={name} name={name} />)}
    </div>
  );
}
