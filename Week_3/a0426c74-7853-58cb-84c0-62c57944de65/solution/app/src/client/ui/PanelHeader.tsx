interface PanelHeaderProps {
  name: string;
  open: boolean;
  onToggle: () => void;
  /** id of the element the header opens and closes */
  controls: string;
}

/** `button "<panel name>"` with `aria-expanded` and a drawn chevron. */
export function PanelHeader({ name, open, onToggle, controls }: PanelHeaderProps) {
  return (
    <button type="button" className="panel-header" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <svg className="chevron" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
        <path d={open ? 'M1 3 L5 7 L9 3' : 'M3 1 L7 5 L3 9'} fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span>{name}</span>
    </button>
  );
}
