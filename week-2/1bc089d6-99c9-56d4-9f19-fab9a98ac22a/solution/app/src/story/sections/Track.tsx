import { RITUALS } from "../../shared/rituals";
import { ChapterDial } from "../components/ChapterDial";
import { track } from "../content";

/**
 * Pinned chapter: while it scrolls past, the ritual cards travel sideways over the moon scene.
 * Each card's toggle adds the ritual to the visitor's hour (kept in the page URL).
 */
export function Track() {
  return (
    <section className="sh-window sh-track" data-scene="moon" aria-labelledby="sh-ch4-title">
      <div className="sh-track__pin">
        <div className="sh-track__rail" data-track-rail="">
          <div className="sh-track__intro">
            <ChapterDial index={track.index} eyebrow={track.eyebrow} />
            <h2 className="sh-chapter__title" id="sh-ch4-title" data-reveal="">
              {track.title}
            </h2>
            <p className="sh-chapter__body" data-reveal="">
              {track.body}
            </p>
            <p className="sh-visually-hidden" role="status" aria-label={track.updates} data-ritual-updates="" />
          </div>
          <div className="sh-track__cards">
            {RITUALS.map((ritual, index) => (
              <div key={ritual.id} className="sh-ritual" role="group" aria-label={ritual.title} data-ritual={ritual.id}>
                <div className="sh-ritual__media">
                  <video
                    className="sh-ritual__clip"
                    muted
                    playsInline
                    loop
                    preload="none"
                    poster={`/images/ritual-${ritual.clip}.webp`}
                    aria-hidden="true"
                    tabIndex={-1}
                  >
                    <source src={`/video/ritual-${ritual.clip}.webm`} type="video/webm" />
                    <source src={`/video/ritual-${ritual.clip}.mp4`} type="video/mp4" />
                  </video>
                </div>
                <div className="sh-ritual__text">
                  <p className="sh-ritual__meta">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <span>{track.minutes(ritual.minutes)}</span>
                  </p>
                  <h3 className="sh-ritual__title">{ritual.title}</h3>
                  <p className="sh-ritual__summary">{ritual.summary}</p>
                  <button className="sh-button sh-button--line sh-ritual__toggle" type="button" aria-pressed="false">
                    {track.add(ritual.title)}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
