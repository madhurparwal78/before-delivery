import type { ReactNode } from 'react';

export interface GlyphProps {
  readonly verified: boolean;
  readonly label?: string;
}

/** Colour is never the only signal: each glyph carries its text label. */
export function StatusGlyph({ verified, label }: GlyphProps): ReactNode {
  const text = label ?? (verified ? 'Verified' : 'Not yet verified');
  return (
    <span className={`glyph ${verified ? 'glyph--verified' : 'glyph--unverified'}`}>
      <svg className="glyph__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        {verified ? (
          <>
            <circle className="glyph__disc" cx="12" cy="12" r="11" />
            <path d="M6.5 12.5l3.6 3.6L17.8 8.4" fill="none" stroke="#fbf8f3" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : (
          <circle
            cx="12"
            cy="12"
            r="10.5"
            fill="none"
            stroke="#55645a"
            strokeWidth="2"
            strokeDasharray="3 3"
          />
        )}
      </svg>
      <span>{text}</span>
    </span>
  );
}

export interface ProgressProps {
  readonly label: string;
  readonly percent: number;
}

export function ProgressBar({ label, percent }: ProgressProps): ReactNode {
  return (
    <span className="progress">
      <span
        className="progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%`}
      >
        <span className="progress__fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="progress__value">{percent}%</span>
    </span>
  );
}
