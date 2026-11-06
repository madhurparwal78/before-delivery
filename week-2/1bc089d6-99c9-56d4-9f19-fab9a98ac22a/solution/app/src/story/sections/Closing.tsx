import { Planner } from "../../planner/Planner";
import { ChapterDial } from "../components/ChapterDial";
import { Mark } from "../components/Mark";
import { film, lightsOut, planner } from "../content";

export function Film() {
  return (
    <section className="sh-chapter sh-film" data-tone="dusk-6" aria-labelledby="sh-ch5-title">
      <div className="sh-chapter__grid">
        <ChapterDial index={film.index} eyebrow={film.eyebrow} />
        <h2 className="sh-chapter__title" id="sh-ch5-title" data-reveal="">
          {film.title}
        </h2>
        <p className="sh-chapter__body" data-reveal="">
          {film.body}
        </p>
        <button className="sh-film__trigger" type="button" data-film-open="">
          <img className="sh-film__poster" src={film.poster} alt="" width={1280} height={720} loading="lazy" />
          <span className="sh-film__play">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
            </svg>
            <span>{film.open}</span>
          </span>
        </button>
      </div>
      <dialog className="sh-film__dialog" aria-label={film.dialog}>
        <div className="sh-player" data-state="idle" data-muted="false" data-captions="off">
          <video className="sh-player__video" playsInline preload="none" poster={film.poster}>
            <source src={film.src.webm} type="video/webm" />
            <source src={film.src.mp4} type="video/mp4" />
            <track kind="captions" src={film.captions} srcLang="en" label="English" />
          </video>
          <div className="sh-player__bar">
            <div className="sh-player__timeline">
              <span className="sh-player__time" aria-hidden="true">
                <span data-player-current="">0:00</span> / <span data-player-duration="">0:00</span>
              </span>
              <input
                className="sh-player__seek"
                type="range"
                min={0}
                max={1000}
                step={1}
                defaultValue={0}
                aria-label="Seek"
                aria-valuetext="0:00 of 0:00"
                data-player-seek=""
              />
            </div>
            <div className="sh-player__controls">
              <button className="sh-player__button" type="button" data-player="play">
                <svg className="sh-player__icon-play" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
                </svg>
                <svg className="sh-player__icon-pause" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
                </svg>
                <span data-player-label="">Play</span>
              </button>
              <button className="sh-player__button" type="button" data-player="captions" aria-pressed="false">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M7 13h4M13 13h4M7 16h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <span>Captions</span>
              </button>
              <button className="sh-player__button" type="button" data-player="mute" aria-pressed="false">
                <svg className="sh-player__icon-sound" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
                  <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <svg className="sh-player__icon-muted" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
                  <path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <span>Mute</span>
              </button>
              <button className="sh-player__button" type="button" data-player="fullscreen">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <span>Full screen</span>
              </button>
              <button className="sh-player__button sh-player__close" type="button" data-player="close">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                <span>Close</span>
              </button>
            </div>
          </div>
          <p className="sh-visually-hidden" role="status" aria-label="Film status" data-film-status="" />
        </div>
      </dialog>
    </section>
  );
}

export function PlannerChapter() {
  return (
    <section className="sh-chapter sh-plan" data-tone="dusk-7" id="plan" aria-labelledby="sh-ch6-title">
      <div className="sh-chapter__grid sh-plan__grid">
        <div className="sh-plan__intro">
          <ChapterDial index={planner.index} eyebrow={planner.eyebrow} />
          <h2 className="sh-chapter__title" id="sh-ch6-title" data-reveal="" tabIndex={-1}>
            {planner.title}
          </h2>
          <p className="sh-chapter__body" data-reveal="">
            {planner.body}
          </p>
        </div>
        <Planner />
      </div>
    </section>
  );
}

export function LightsOut() {
  return (
    <footer className="sh-window sh-lights" data-scene="lantern">
      <div className="sh-lights__inner">
        <Mark className="sh-lights__mark" />
        <p className="sh-lights__title" data-reveal="">
          {lightsOut.title}
        </p>
        <p className="sh-lights__sub">{lightsOut.sub}</p>
        <nav className="sh-lights__nav" aria-label="Footer">
          <ul role="list">
            {lightsOut.links.map((link) => (
              <li key={link.href}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
