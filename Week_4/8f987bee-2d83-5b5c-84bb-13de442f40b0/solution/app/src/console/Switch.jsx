// A labelled on/off switch; the visible label is its accessible name.
export default function Switch({ label, checked, onChange, disabled = false, className = "" }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`switch ${className}`} disabled={disabled}
      onClick={() => onChange(!checked)}>
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      <span className="switch-label">{label}</span>
    </button>
  );
}
