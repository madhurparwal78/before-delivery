import type { ButtonHTMLAttributes } from 'react';
import '../../styles/drawing/controls.css';

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role' | 'aria-checked' | 'onChange'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** `role="switch"`: a labelled on/off button. */
export function Switch({ checked, onChange, children, className, ...rest }: SwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={['switch', className ?? ''].filter(Boolean).join(' ')} onClick={() => onChange(!checked)} {...rest}>
      <span className="switch__mark" aria-hidden="true" />
      {children}
    </button>
  );
}
