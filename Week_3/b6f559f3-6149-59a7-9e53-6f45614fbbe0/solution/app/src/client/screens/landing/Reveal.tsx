import type { CSSProperties, ElementType, ReactNode } from 'react';
import { useEntered } from './hooks';

interface RevealProps {
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Called with whether the panel has entered the viewport, so a demo can play once. */
  render?: (entered: boolean) => ReactNode;
}

/** A panel that fades in over 400 ms once it enters the viewport. */
export function Reveal({ as: Tag = 'section', className = '', children, render, ...rest }: RevealProps) {
  const [ref, entered] = useEntered<HTMLElement>(0.12);
  return (
    <Tag ref={ref} className={`reveal ${className}`} data-entered={entered ? 'true' : 'false'} {...rest}>
      {render ? render(entered) : children}
    </Tag>
  );
}
