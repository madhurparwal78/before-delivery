import { preloader } from "../content";
import { Mark, Wordmark } from "../components/Mark";

/** The skip link and the fixed 3D canvas under the whole page. */
export function Backdrop() {
  return (
    <>
      <a className="sh-skip" href="#plan">
        Skip to the planner
      </a>
      <canvas className="sh-canvas" aria-hidden="true" />
    </>
  );
}

/**
 * The fixed top bar (wordmark, story clock, sound). It follows the hero in the document so that, with
 * focus on the hero heading after the gate, Tab reaches the bar first and then the chapters.
 */
export function TopBar() {
  return (
    <header className="sh-bar">
      <a className="sh-bar__logo" href="/" aria-label="Stillhour">
        <Wordmark className="sh-wordmark" />
      </a>
      <p className="sh-clock" role="timer" aria-label="Story clock">
        21:00
      </p>
      <button className="sh-sound" type="button" role="switch" aria-checked="false" aria-label="Sound">
        <svg className="sh-sound__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
          <path className="sh-sound__waves" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path className="sh-sound__off" d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span className="sh-sound__bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
    </header>
  );
}

/** Covers the page until everything has loaded; its two buttons appear only at 100%. */
export function Gate() {
  return (
    <div className="sh-gate" role="dialog" aria-modal="true" aria-label="Stillhour" data-state="loading">
      <div className="sh-gate__inner">
        <Mark className="sh-gate__mark" traced />
        <p className="sh-gate__title" aria-hidden="true">
          Stillhour
        </p>
        <div className="sh-gate__label" role="progressbar" aria-label={preloader.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}>
          <span>{preloader.label}</span> <span className="sh-gate__percent">0%</span>
        </div>
        <div className="sh-gate__actions">
          <button className="sh-button sh-button--ember sh-gate__enter" type="button" hidden>
            {preloader.enter}
          </button>
          <button className="sh-button sh-button--quiet sh-gate__silent" type="button" hidden>
            {preloader.silent}
          </button>
        </div>
      </div>
    </div>
  );
}
