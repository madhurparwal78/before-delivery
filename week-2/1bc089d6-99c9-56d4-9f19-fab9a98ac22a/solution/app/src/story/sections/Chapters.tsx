import { ChapterDial } from "../components/ChapterDial";
import { breathe, city, flowers, hero, nobodyPlans, numbers, screen, settle, water } from "../content";

export function Hero() {
  return (
    <section className="sh-window sh-hero" data-scene="dusk" aria-labelledby="sh-hero-title">
      <div className="sh-hero__inner">
        <p className="sh-eyebrow sh-hero__eyebrow">{hero.eyebrow}</p>
        <h1 className="sh-hero__title" id="sh-hero-title" tabIndex={-1} aria-label={hero.title}>
          <span className="sh-hero__line" data-split="">
            {hero.titleLines[0]}
          </span>{" "}
          <span className="sh-hero__line" data-split="">
            {hero.titleLines[1]}
          </span>
        </h1>
        <p className="sh-hero__lead">{hero.lead}</p>
        <p className="sh-hero__hint" aria-hidden="true">
          <span className="sh-hero__hint-line" />
          {hero.scrollHint}
        </p>
      </div>
    </section>
  );
}

export function NobodyPlans() {
  return (
    <section className="sh-chapter" data-tone="dusk-1" aria-labelledby="sh-ch1-title">
      <div className="sh-chapter__grid">
        <ChapterDial index={nobodyPlans.index} eyebrow={nobodyPlans.eyebrow} />
        <h2 className="sh-chapter__title" id="sh-ch1-title" data-reveal="">
          {nobodyPlans.title}
        </h2>
        <p className="sh-chapter__body" data-reveal="">
          {nobodyPlans.body}
        </p>
      </div>
    </section>
  );
}

export function Numbers() {
  return (
    <section className="sh-chapter sh-numbers" data-tone="dusk-2" aria-label={numbers.region}>
      <ul className="sh-numbers__list" role="list">
        {numbers.items.map((item) => (
          <li key={item.unit} className="sh-numbers__item">
            <span className="sh-numerals" data-roll={item.value}>
              {item.value.split("").map((digit, place) => (
                <span key={place} className="sh-numerals__column">
                  <span className="sh-numerals__strip" aria-hidden="true" />
                  <span className="sh-numerals__final">{digit}</span>
                </span>
              ))}
            </span>{" "}
            <span className="sh-numbers__unit">{item.unit}</span>
            <span className="sh-numbers__note">{item.note}</span>
          </li>
        ))}
      </ul>
      <p className="sh-numbers__live" data-live-count="" data-state="loading" />
    </section>
  );
}

export function CityWindow() {
  return (
    <section className="sh-window sh-city" data-scene="city" aria-label={city.region}>
      <div className="sh-window__sticky">
        <p className="sh-window__caption" data-city-caption="">
          {city.captions[0]}
        </p>
        <p className="sh-city__counter" data-city-lit="">
          {`${city.windows.toLocaleString("en-US")} windows lit`}
        </p>
      </div>
    </section>
  );
}

export function Screen() {
  return (
    <section className="sh-chapter sh-screen" data-tone="dusk-3" aria-labelledby="sh-ch2-title">
      <div className="sh-chapter__grid">
        <ChapterDial index={screen.index} eyebrow={screen.eyebrow} />
        <h2 className="sh-chapter__title" id="sh-ch2-title" data-reveal="">
          {screen.title}
        </h2>
        <p className="sh-chapter__body" data-reveal="">
          {screen.body}
        </p>
        <div
          className="sh-brightness"
          role="meter"
          aria-label={screen.dialLabel}
          aria-valuemin={screen.dialTo}
          aria-valuemax={screen.dialFrom}
          aria-valuenow={screen.dialFrom}
        >
          <svg className="sh-brightness__ring" viewBox="0 0 240 240" aria-hidden="true" focusable="false">
            <circle className="sh-brightness__track" cx="120" cy="120" r="104" pathLength={1} />
            <circle className="sh-brightness__fill" cx="120" cy="120" r="104" pathLength={1} transform="rotate(-90 120 120)" />
          </svg>
          <p className="sh-brightness__readout">
            <span className="sh-brightness__value" data-brightness="">
              {screen.dialFrom}%
            </span>
            <span className="sh-brightness__label" aria-hidden="true">
              {screen.dialLabel}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

export function WaterWindow() {
  return (
    <section className="sh-window sh-water" data-scene="water" aria-label="Still water">
      <div className="sh-window__sticky">
        <p className="sh-window__title" data-reveal="">
          {water.caption}
        </p>
        <p className="sh-window__sub">{water.sub}</p>
      </div>
    </section>
  );
}

export function Breathe() {
  return (
    <section className="sh-chapter sh-breathe" data-tone="dusk-4" aria-labelledby="sh-ch3-title">
      <div className="sh-chapter__grid">
        <ChapterDial index={breathe.index} eyebrow={breathe.eyebrow} />
        <h2 className="sh-chapter__title" id="sh-ch3-title" data-reveal="">
          {breathe.title}
        </h2>
        <p className="sh-chapter__body" data-reveal="">
          {breathe.body}
        </p>
        <div className="sh-breathe__guide" data-phase="idle">
          <div className="sh-breathe__circle" aria-hidden="true">
            <span className="sh-breathe__core" />
          </div>
          <p className="sh-breathe__phase" role="status" aria-label="Breathing guide">
            {breathe.idle}
          </p>
          <p className="sh-breathe__meta">
            <span className="sh-breathe__round" />
            <span className="sh-breathe__count" aria-hidden="true" />
          </p>
          <button className="sh-button sh-button--ember sh-breathe__toggle" type="button">
            {breathe.start}
          </button>
        </div>
      </div>
    </section>
  );
}

export function FlowerWindow() {
  return (
    <section className="sh-window sh-flowers" data-scene="flowers" aria-label="Moonflowers close">
      <div className="sh-window__sticky">
        <p className="sh-window__title" data-reveal="">
          {flowers.caption}
        </p>
        <p className="sh-window__sub">{flowers.sub}</p>
      </div>
    </section>
  );
}

export function Settle() {
  return (
    <section className="sh-chapter sh-settle" data-tone="dusk-5" aria-label="Let it settle">
      <div className="sh-settle__sticky">
        <p className="sh-settle__line" data-settle="">
          {settle.line}
        </p>
      </div>
    </section>
  );
}
