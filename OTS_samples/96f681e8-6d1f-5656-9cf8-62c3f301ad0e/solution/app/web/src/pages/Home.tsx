import { BallIcon } from "../components/Icons";
import { CourtLines, Facets } from "../components/Bands";
import { CourtIllustration } from "../components/CourtIllustration";
import { MatchCarousel } from "../components/MatchCarousel";
import { SearchPill } from "../components/SearchPill";
import { spokenDuration } from "../format";
import { useClub } from "../hooks";
import { useMatches } from "../matches";

const homeCards = 12;

const steps = [
  { title: "Hold it", body: "Pick a free cell and it is yours while the halo runs." },
  { title: "Split it", body: "Add three friends and each one gets their own share by email." },
  { title: "Play it", body: "Show up, check in at the desk, and play." },
];

const coaches = [
  { name: "Marta Sol", initials: "MS", levels: "1.0 to 4.0", line: "Patient drills for new and returning players." },
  { name: "Owen Pryce", initials: "OP", levels: "3.5 to 7.0", line: "Match tactics for competitive pairs." },
];

const defaultRules = {
  hold_seconds: 600,
  share_settle_seconds: 21600,
  match_cutoff_seconds: 7200,
  free_cancel_seconds: 86400,
  rule_description: "Free cancellation up to 24 hours before start. Later cancellations keep half as a fee and credit the rest.",
};

export function Home() {
  const club = useClub();
  const rules = club ?? defaultRules;
  const { matches, failed, joins, join } = useMatches({});
  const shown = matches ? matches.slice(0, homeCards) : null;

  return (
    <>
      <section className="hero">
        <CourtLines />
        <div className="hero__inner">
          <div className="hero__copy">
            <h1>
              Hold your court. <em>Split the bill.</em> Be on time.
            </h1>
            <p className="hero__sub">Seven courts at Marlowe Yard. Hold a slot, send each friend their share, and find a match at your level.</p>
            <SearchPill />
          </div>
          <div className="hero__art">
            <CourtIllustration />
          </div>
        </div>
      </section>

      <section className="steps">
        <Facets />
        <div className="column">
          <h2>How a hold works</h2>
          <div className="steps__cards">
            {steps.map((step, index) => (
              <article key={step.title} className="step-card" aria-label={step.title}>
                <header>
                  <span className="step-card__badge" aria-hidden="true">
                    {index + 1}
                  </span>
                  <h3>{step.title}</h3>
                </header>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="band band--white">
        <div className="column">
          <h2 id="open-matches-heading">Open matches</h2>
          <MatchCarousel matches={shown} failed={failed} joins={joins} onJoin={join} />
        </div>
      </section>

      <section className="band band--white house-rules" id="house-rules">
        <div className="column house-rules__inner">
          <div className="house-rules__card" aria-hidden="true">
            <svg viewBox="0 0 240 180" width="100%" height="100%">
              <rect width="240" height="180" fill="#f5f7ff" />
              <rect x="30" y="22" width="180" height="136" rx="8" fill="none" stroke="#335fff" strokeWidth="5" />
              <path d="M120 22v136M30 90h180M75 22v136M165 22v136" stroke="#335fff" strokeWidth="3" opacity="0.6" />
              <circle cx="92" cy="58" r="11" fill="#d4ff1a" stroke="#0e2433" strokeWidth="2" />
              <circle cx="150" cy="120" r="11" fill="#d4ff1a" stroke="#0e2433" strokeWidth="2" />
            </svg>
          </div>
          <div>
            <h2 id="house-rules-heading">House rules</h2>
            {!club && <p className="visually-hidden">Loading…</p>}
            {/* Until /api/club answers, the default rules hold the block's size so nothing below moves. */}
            <div style={club ? undefined : { visibility: "hidden" }} aria-hidden={club ? undefined : true}>
              <p className="lead">
                Holds last <mark>{spokenDuration(rules.hold_seconds)}</mark>, unpaid shares go on the organiser&apos;s card{" "}
                <mark>{spokenDuration(rules.share_settle_seconds)} before</mark> start, open matches close{" "}
                <mark>{spokenDuration(rules.match_cutoff_seconds)} before</mark> start, and cancelling up to{" "}
                <mark>{spokenDuration(rules.free_cancel_seconds)}</mark> ahead is free.
              </p>
              <p>{rules.rule_description}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="band band--white coaches" id="coaches">
        <div className="column">
          <h2 id="coaches-heading">Coaches</h2>
          <div className="coaches__cards">
            {coaches.map((coach) => (
              <article key={coach.name} className="coach-card" aria-label={coach.name}>
                <header>
                  <span className="coach-card__avatar" aria-hidden="true">
                    {coach.initials}
                  </span>
                  <div>
                    <h3>{coach.name}</h3>
                    <p>Coach, levels {coach.levels}</p>
                  </div>
                </header>
                <p>{coach.line}</p>
                <div className="coach-card__balls" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <BallIcon key={i} size={20} />
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
