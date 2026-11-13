import { ReactNode, useEffect, useRef, useState } from 'react';
import { reducedMotion } from '../app/shell';

/** The main action bar: fixed to the bottom at 375, in the flow from 768 px. */
export function BottomBar({
  children,
  always = false,
}: {
  children: ReactNode;
  always?: boolean;
}): JSX.Element {
  return <div className={`bottom-bar${always ? ' always' : ''}`}>{children}</div>;
}

/** A refusal message inside a dialog; it takes focus as it appears. */
export function DialogMessage({ text }: { text: string | null }): JSX.Element | null {
  const node = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    if (text) node.current?.focus();
  }, [text]);
  if (!text) return null;
  return (
    <p className="field-error" tabIndex={-1} ref={node}>
      {text}
    </p>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return <section className={`card ${className}`}>{children}</section>;
}

/** A wide table that scrolls sideways in its own focusable, named frame. */
export function TableFrame({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="table-frame" role="region" aria-label={name} tabIndex={0}>
      {children}
    </div>
  );
}

export function Field({
  label,
  name,
  error,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="field">
      <label htmlFor={`field-${name}`}>{label}</label>
      {children}
      {error ? (
        <p className="field-error" id={`error-${name}`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  name,
  value,
  onChange,
  error,
  type = 'text',
  autoComplete,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
}): JSX.Element {
  return (
    <Field label={label} name={name} error={error}>
      <input
        id={`field-${name}`}
        type={type}
        value={value}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `error-${name}` : undefined}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function SelectField({
  label,
  name,
  value,
  onChange,
  options,
  error,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  error?: string;
}): JSX.Element {
  return (
    <Field label={label} name={name} error={error}>
      <select
        id={`field-${name}`}
        value={value}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function RadioGroup({
  label,
  name,
  value,
  onChange,
  options,
  error,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  error?: string;
}): JSX.Element {
  return (
    <fieldset role="radiogroup" aria-label={label} id={`field-${name}`}>
      <legend>{label}</legend>
      <div className="radio-row">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {error ? <p className="field-error">{error}</p> : null}
    </fieldset>
  );
}

/** An accordion panel that grows and shrinks to its content height. */
export function Accordion({
  name,
  open,
  onToggle,
  children,
}: {
  name: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [closing, setClosing] = useState(false);
  const [hidden, setHidden] = useState(!open);
  const wasOpen = useRef(open);

  useEffect(() => {
    const panel = panelRef.current;
    const inner = innerRef.current;
    if (!panel || !inner) return;
    if (open) {
      setHidden(false);
      setClosing(false);
      if (reducedMotion()) {
        panel.style.height = 'auto';
      } else {
        panel.style.height = `${inner.offsetHeight}px`;
      }
    } else if (wasOpen.current) {
      setClosing(true);
      if (reducedMotion()) {
        panel.style.height = '0px';
        setHidden(true);
        setClosing(false);
      } else {
        panel.style.height = `${inner.offsetHeight}px`;
        window.requestAnimationFrame(() => {
          panel.style.height = '0px';
        });
      }
    } else {
      panel.style.height = '0px';
      setHidden(true);
    }
    wasOpen.current = open;
  }, [open, children]);

  const panelId = `panel-${name.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="accordion">
      <h3>
        <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
          {name}
        </button>
      </h3>
      <div
        className="panel"
        id={panelId}
        ref={panelRef}
        {...(open ? {} : { 'aria-hidden': true, inert: '' })}
        style={hidden && !open ? { height: 0, visibility: 'hidden' } : undefined}
        onTransitionEnd={() => {
          if (closing) {
            setHidden(true);
            setClosing(false);
          } else if (open && panelRef.current) {
            panelRef.current.style.height = 'auto';
          }
        }}
      >
        <div ref={innerRef} role="region" aria-label={name}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Procedural glyph imagery: every picture in the app is drawn as SVG. */
export function Glyph({ kind }: { kind: 'marker' | 'tube' | 'packet' | 'capsule' | 'plan' }): JSX.Element {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const };
  return (
    <svg className="glyph" viewBox="0 0 40 40" role="img" aria-hidden="true" focusable="false">
      {kind === 'marker' ? (
        <>
          <rect x="4" y="16" width="32" height="8" rx="4" {...stroke} />
          <circle cx="26" cy="20" r="4" {...stroke} />
        </>
      ) : null}
      {kind === 'tube' ? (
        <>
          <path d="M14 6h12v20a6 6 0 0 1-12 0z" {...stroke} />
          <path d="M14 14h12" {...stroke} />
        </>
      ) : null}
      {kind === 'packet' ? (
        <>
          <path d="M8 8h24v24H8z" {...stroke} />
          <path d="M8 14h24" {...stroke} />
          <circle cx="16" cy="24" r="3" {...stroke} />
          <circle cx="25" cy="24" r="3" {...stroke} />
        </>
      ) : null}
      {kind === 'capsule' ? (
        <>
          <rect x="6" y="14" width="28" height="12" rx="6" {...stroke} />
          <path d="M20 14v12" {...stroke} />
        </>
      ) : null}
      {kind === 'plan' ? (
        <>
          <rect x="9" y="6" width="22" height="28" rx="4" {...stroke} />
          <path d="M14 14h12M14 20h12M14 26h7" {...stroke} />
        </>
      ) : null}
    </svg>
  );
}

/** The generated cloud and gradient field behind every hero. */
export function CloudField(): JSX.Element {
  const clouds = [
    { cx: 120, cy: 70, r: 46 },
    { cx: 180, cy: 96, r: 58 },
    { cx: 250, cy: 64, r: 38 },
    { cx: 620, cy: 110, r: 64 },
    { cx: 700, cy: 80, r: 44 },
    { cx: 760, cy: 120, r: 52 },
  ];
  return (
    <svg
      className="cloudfield"
      viewBox="0 0 900 320"
      preserveAspectRatio="none"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#cfe6dd" stopOpacity="0" />
          <stop offset="100%" stopColor="#bcdac9" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <g fill="#ffffff" opacity="0.72">
        {clouds.map((cloud) => (
          <circle key={`${cloud.cx}-${cloud.cy}`} cx={cloud.cx} cy={cloud.cy} r={cloud.r} />
        ))}
      </g>
      <rect x="0" y="180" width="900" height="140" fill="url(#ground)" />
    </svg>
  );
}
