import { Wordmark } from './Art.js';

export function LoadingScreen({
  progress,
  fading,
}: {
  progress: number;
  fading: boolean;
}): JSX.Element {
  const value = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div className={fading ? 'loading fading' : 'loading'}>
      <Wordmark className="loading-wordmark" />
      <div
        role="progressbar"
        aria-label="Loading layout"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        data-testid="layout-load-pill"
        className="load-pill"
      >
        <div className="load-pill-fill" style={{ width: `${Math.max(value, 3)}%` }} />
        <div className="load-pill-label">{value}%</div>
      </div>
    </div>
  );
}
