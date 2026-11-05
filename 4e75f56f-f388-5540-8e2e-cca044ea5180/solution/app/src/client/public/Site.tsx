import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { call, type Content, type Evening } from "../api.js";
import { CHAPTERS, EVENT, SEATS_TOTAL } from "../catalogue.js";
import { PRICES } from "../../shared/prices.js";
import { dollars } from "../format.js";
import { Dialog } from "../ui/Dialog.js";
import { Icon, NARROW, REDUCED_MOTION, useMedia } from "../ui/kit.js";
import { AuthDialog, Checkout, GroupCheckout, HoldEnded } from "./Dialogs.js";
import { HoldPanel, LabStage, benchMapStop, useCountdown } from "./Lab.js";
import { store, useStore } from "./store.js";
import { mmss } from "../format.js";

type ChapterId = (typeof CHAPTERS)[number]["id"];

/** Jumps to a chapter at once: the brief allows no motion beyond the preloader, ring and countdown. */
function goTo(id: ChapterId): void {
  const section = document.getElementById(id);
  const heading = document.getElementById(`${id}-title`);
  section?.scrollIntoView({ behavior: "instant", block: "start" });
  heading?.focus({ preventScroll: true });
}

/** The chapter that fills most of the viewport. */
function useCurrentChapter(): ChapterId {
  const [current, setCurrent] = useState<ChapterId>("overture");
  useEffect(() => {
    const update = () => {
      let best: ChapterId = "overture";
      let most = -1;
      for (const chapter of CHAPTERS) {
        const rect = document.getElementById(chapter.id)?.getBoundingClientRect();
        if (!rect) continue;
        const visible = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
        if (visible > most) {
          most = visible;
          best = chapter.id;
        }
      }
      setCurrent(best);
    };
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    update();
    return () => {
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, []);
  return current;
}

function ChapterLinks({ current, onPick }: { current: ChapterId; onPick: (id: ChapterId) => void }) {
  return (
    <nav aria-label="Chapters" class="chapters">
      <ol>
        {CHAPTERS.map((chapter) => (
          <li key={chapter.id}>
            <a
              href={`#${chapter.id}`}
              aria-current={current === chapter.id ? "true" : undefined}
              onClick={(event) => {
                event.preventDefault();
                onPick(chapter.id);
              }}
            >
              <span class="chapters__number mono">{chapter.number}</span> <span class="chapters__title">{chapter.title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function CountingSeats({ value }: { value: number }) {
  const reduced = useMedia(REDUCED_MOTION);
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced || shown === value) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = requestAnimationFrame(function step() {
      const t = Math.min(1, (performance.now() - start) / 600);
      const eased = 1 - (1 - t) ** 3;
      const next = Math.round(origin + (value - origin) * eased);
      setShown(next);
      from.current = next;
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  return <span class="num">{shown}</span>;
}

function ReserveBar({ narrow, onPay, onReserve }: { narrow: boolean; onPay: (kind: "deposit" | "full" | "group") => void; onReserve: () => void }) {
  const s = useStore();
  const left = useCountdown();
  if (narrow && (s.hold || s.holding.length || s.selection.length)) {
    return (
      <div class="reserve-bar reserve-bar--dock">
        <HoldPanel onPay={onPay} compact />
      </div>
    );
  }
  return (
    <div class={`reserve-bar ${narrow ? "reserve-bar--dock" : ""}`}>
      {s.hold && !narrow ? (
        <p class="reserve-bar__hold" aria-hidden="true">
          Bench {s.hold.labels.join(", ")} <span class="mono">{mmss(left ?? 0)}</span>
        </p>
      ) : (
        <p class="reserve-bar__seats">
          <CountingSeats value={s.seatsRemaining} /> of {SEATS_TOTAL} seats remaining
        </p>
      )}
      {!s.hold && (
        <button type="button" class="button button--primary reserve-bar__button" onClick={onReserve}>
          Reserve a bench
        </button>
      )}
    </div>
  );
}

function Headline({ id, lines, as = "h2" }: { id: string; lines: [string, string]; as?: "h1" | "h2" }) {
  const Tag = as;
  return (
    <Tag class="headline" id={id} tabIndex={-1}>
      <span class="headline__line">{lines[0]}</span> <em class="headline__line">{lines[1]}</em>
    </Tag>
  );
}

function Chapter(props: { chapter: (typeof CHAPTERS)[number]; className?: string; children: ComponentChildren; sectionRef?: { current: HTMLElement | null } }) {
  const { chapter } = props;
  return (
    <section id={chapter.id} class={`chapter ${props.className ?? ""}`} aria-labelledby={`${chapter.id}-title`} ref={props.sectionRef}>
      <p class="eyebrow">
        <span class="mono">{chapter.number}</span> {chapter.title}
      </p>
      {props.children}
    </section>
  );
}

function useContent() {
  const s = useStore();
  const [content, setContent] = useState<Content | null>(null);
  const [failed, setFailed] = useState(false);
  const signedIn = s.signedIn;
  useLayoutEffect(() => {
    void call<Content>("GET", "/api/content")
      .then((reply) => {
        if (reply.ok) {
          setContent(reply.data);
          setFailed(false);
        } else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, [signedIn]);
  return { content, failed };
}

const SLOW = "The programme is loading slowly. Refresh in a moment.";

function Agenda({ content, failed }: { content: Content | null; failed: boolean }) {
  const [day, setDay] = useState(1);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const select = (next: number) => {
    setDay(next);
    tabs.current[next - 1]?.focus();
  };
  const sessions = content?.sessions.filter((session) => session.day === day) ?? [];
  return (
    <div class="agenda">
      <div class="agenda__tabs" role="tablist" aria-label="Agenda days">
        {[1, 2].map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            id={`day-tab-${d}`}
            ref={(el) => {
              tabs.current[d - 1] = el;
            }}
            aria-selected={day === d}
            aria-controls={`day-panel-${d}`}
            tabIndex={day === d ? 0 : -1}
            class="agenda__tab"
            onClick={() => select(d)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                select(d === 1 ? 2 : 1);
              }
            }}
          >
            <span class="num">Day {d}</span>
            <span class="agenda__date">{d === 1 ? "Fri 16 April" : "Sat 17 April"}</span>
          </button>
        ))}
      </div>
      <div class="agenda__panel" role="tabpanel" id={`day-panel-${day}`} aria-labelledby={`day-tab-${day}`}>
        {failed && <p class="slow">{SLOW}</p>}
        {!content && !failed && (
          <ol class="sessions" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <li class="session session--placeholder" key={i} />
            ))}
          </ol>
        )}
        <ol class="sessions">
          {sessions.map((session) => (
            <li class="session" key={session.id}>
              <p class="session__meta">
                <span class="mono session__number">{String(session.number).padStart(2, "0")}</span>
                <span class={`tag ${session.format === "hands-on" ? "tag--hands" : ""}`}>{session.format === "hands-on" ? "Hands-on" : "Lecture"}</span>
                <span class="num session__minutes">{session.minutes} min</span>
              </p>
              <h3 class="session__title">{session.title}</h3>
              {session.outcomes && <p class="session__outcomes">{session.outcomes}</p>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function EveningCard({ evening }: { evening: Evening }) {
  const [open, setOpen] = useState(false);
  const atelier = evening.tier === "atelier";
  const detailsId = `evening-${evening.id}`;
  return (
    <article class={`evening ${atelier ? "evening--atelier" : ""}`}>
      <p class="evening__day">
        Day <span class="num">{evening.day}</span> · {evening.day === 1 ? "Friday 16 April" : "Saturday 17 April"}
      </p>
      <h3 class="evening__title">{evening.title}</h3>
      <p class={`evening__tier ${atelier ? "gold" : ""}`}>
        {atelier ? (
          <>
            <Icon name="lock" /> Atelier guests
          </>
        ) : (
          "All guests"
        )}
      </p>
      <button
        type="button"
        class="button button--quiet evening__toggle"
        aria-expanded={open}
        aria-controls={detailsId}
        aria-label={`Details for ${evening.title}`}
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide details" : "Details"}
      </button>
      <div id={detailsId} class="evening__details" hidden={!open}>
        {open &&
          (evening.gated ? (
            <p>The time, place and menu are shared with Atelier seat holders once their seat is paid.</p>
          ) : (
            <>
              <p class="evening__when">
                <span class="num">{evening.starts_at}</span> · {evening.venue}
              </p>
              <p>{evening.description}</p>
            </>
          ))}
      </div>
    </article>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const id = `faq-${question.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return (
    <li class="faq__item">
      <h3 class="faq__question">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          {question}
          <span class="faq__mark" aria-hidden="true">
            {open ? "−" : "+"}
          </span>
        </button>
      </h3>
      <div id={id} class="faq__answer" hidden={!open}>
        {open && <p>{answer}</p>}
      </div>
    </li>
  );
}

function AccountEntry() {
  const s = useStore();
  if (!s.me) {
    return (
      <div class="entry">
        <p>Holding a bench needs an account. Practitioners book one seat; clinic accounts hold up to six and pay one group invoice.</p>
        <button type="button" class="button button--primary" onClick={() => store.openSignIn()}>
          Sign in
        </button>
      </div>
    );
  }
  const role = s.me.account.role;
  return (
    <div class="entry">
      <p>
        Signed in as <strong>{s.me.account.name}</strong>.
      </p>
      <div class="entry__links">
        {(role === "practitioner" || role === "clinic") && (
          <a class="button button--primary" href="/account">
            My seats
          </a>
        )}
        {role === "registrar" && (
          <a class="button button--primary" href="/desk">
            Registrar desk
          </a>
        )}
        {role === "director" && (
          <a class="button button--primary" href="/desk/content">
            Content desk
          </a>
        )}
        {role === "frontdesk" && (
          <a class="button button--primary" href="/checkin">
            Check-in
          </a>
        )}
        <button
          type="button"
          class="button button--quiet"
          onClick={() => void call("POST", "/api/auth/signout", {}).then(() => location.assign("/"))}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

export function Site() {
  const s = useStore();
  const narrow = useMedia(NARROW);
  const current = useCurrentChapter();
  const { content, failed } = useContent();
  const [drawer, setDrawer] = useState(false);
  const [checkout, setCheckout] = useState<{ kind: "deposit" | "full" | "group"; opener: HTMLElement | null } | null>(null);
  const labRef = useRef<HTMLElement | null>(null);
  const pendingChapter = useRef<ChapterId | null>(null);

  useLayoutEffect(() => store.start(), []);

  const onPay = (kind: "deposit" | "full" | "group") => setCheckout({ kind, opener: document.activeElement as HTMLElement | null });
  const reserve = () => {
    goTo("lab");
    benchMapStop()?.focus({ preventScroll: true });
  };

  return (
    <div class={`site ${narrow ? "site--narrow" : ""}`}>
      <a class="skip" href="#lab">
        Skip to the bench map
      </a>
      <header class="masthead">
        <a class="brand" href="/">
          <span class="brand__mark" aria-hidden="true" />
          <span>
            <span class="brand__institute">{EVENT.institute}</span> {EVENT.name}
          </span>
        </a>
        {narrow ? (
          <button type="button" class="button button--quiet masthead__menu" onClick={() => setDrawer(true)}>
            <Icon name="menu" /> Menu
          </button>
        ) : (
          <ReserveBar narrow={false} onPay={onPay} onReserve={reserve} />
        )}
      </header>
      {!narrow && (
        <div class="rail">
          <ChapterLinks current={current} onPick={goTo} />
        </div>
      )}
      {drawer && (
        <Dialog
          label="Chapters"
          onClose={() => setDrawer(false)}
          className="drawer"
          returnFocus={() => {
            const id = pendingChapter.current;
            pendingChapter.current = null;
            if (!id) return null;
            goTo(id);
            return document.getElementById(`${id}-title`);
          }}
        >
          <div class="drawer__head">
            <p class="eyebrow">Opaline Bench Days</p>
            <button type="button" class="button button--quiet" onClick={() => setDrawer(false)}>
              <Icon name="close" /> Close menu
            </button>
          </div>
          <ChapterLinks
            current={current}
            onPick={(id) => {
              pendingChapter.current = id;
              setDrawer(false);
            }}
          />
        </Dialog>
      )}

      <main id="main">
        <Chapter chapter={CHAPTERS[0]} className="chapter--overture">
          <Headline id="overture-title" as="h1" lines={["Layer the light", "back into the tooth."]} />
          <div class="overture__facts">
            <p class="overture__brand">
              {EVENT.institute} · {EVENT.name}
            </p>
            <p class="overture__course">{EVENT.course}</p>
            <p>
              <span class="num">{EVENT.dates}</span> · {EVENT.city}
            </p>
            <p class="overture__seats">
              <span class="num">{SEATS_TOTAL}</span> benches · <span class="num">{EVENT.credits}</span> CE credits · two days at the bench
            </p>
          </div>
        </Chapter>

        <Chapter chapter={CHAPTERS[1]}>
          <Headline id="method-title" lines={["Dentin, effects,", "enamel. In that order."]} />
          <div class="columns">
            <div class="prose">
              <p class="lead">
                Two days of direct composite layering at a lit bench of your own: a typodont, a curing light, loupes on, and the instructor's hands
                on the screen in front of you.
              </p>
              <p>
                You map shade and translucency on a natural incisor, build a palatal shell from a silicone index, layer a Class IV to a natural
                incisal edge, then move to the posterior with sectional matrices and finish to gloss under cross-polarised light.
              </p>
            </div>
            <aside class="facts">
              <h3 class="facts__title">Instructor and course director</h3>
              <p>{EVENT.director}</p>
              <h3 class="facts__title">Continuing education</h3>
              <p>
                <span class="num">{EVENT.credits}</span> credits · {EVENT.format}
              </p>
              <p>
                Provider: {EVENT.provider}, provider ID <span class="num">{EVENT.providerId}</span>
              </p>
              <p>Subject code: {EVENT.subject}</p>
            </aside>
          </div>
        </Chapter>

        <Chapter chapter={CHAPTERS[2]}>
          <Headline id="two-days-title" lines={["Two days,", "eight sessions."]} />
          <Agenda content={content} failed={failed} />
        </Chapter>

        <Chapter chapter={CHAPTERS[3]} className="chapter--lab" sectionRef={labRef}>
          <Headline id="lab-title" lines={["Pick your bench", "in the lab."]} />
          <p class="lab__lead">Rows A and B sit nearest the demo station and are Atelier benches. A hold runs on the lab clock, whatever your device says.</p>
          <LabStage onPay={onPay} chapter={labRef} />
        </Chapter>

        <Chapter chapter={CHAPTERS[4]}>
          <Headline id="evenings-title" lines={["After the lights", "go down."]} />
          {failed && <p class="slow">{SLOW}</p>}
          <div class="evenings">
            {content?.hospitality.map((evening) => <EveningCard key={evening.id} evening={evening} />)}
          </div>
        </Chapter>

        <Chapter chapter={CHAPTERS[5]}>
          <Headline id="venue-title" lines={["West Kinzie,", "a short walk from the Loop."]} />
          <div class="venue">
            <address class="venue__address">
              <h3>{EVENT.venue}</h3>
              <p>{EVENT.street}</p>
              <p>{EVENT.locality}</p>
            </address>
            <div class="venue__hotels">
              <h3 class="facts__title">Hotels nearby</h3>
              {failed && <p class="slow">{SLOW}</p>}
              <ul class="hotels">
                {content?.hotels.map((hotel) => (
                  <li class="hotel" key={hotel.id}>
                    <p class="hotel__name">{hotel.name}</p>
                    <p class="hotel__meta">
                      <span class="num">{hotel.distance}</span> · <span class="num">{hotel.rate}</span>
                    </p>
                    <a class="hotel__map" href={hotel.map_url} target="_blank" rel="noopener noreferrer" aria-label={`Map for ${hotel.name}`}>
                      <Icon name="map" /> Map
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Chapter>

        <Chapter chapter={CHAPTERS[6]}>
          <Headline id="reserve-title" lines={["Hold a bench.", "Keep your place."]} />
          <div class="reserve">
            <div class="prices">
              {(["bench", "atelier"] as const).map((tier) => (
                <div class={`price price--${tier}`} key={tier}>
                  <h3 class="price__tier">
                    {tier === "atelier" && <Icon name="lock" class="gold" />} {tier === "bench" ? "Bench" : "Atelier"}
                  </h3>
                  <p class="price__full num">${dollars(PRICES[tier].full)}</p>
                  <p class="price__parts">
                    <span class="num">Deposit ${dollars(PRICES[tier].deposit)}</span>
                    <span class="num">Balance ${dollars(PRICES[tier].balance)}</span>
                  </p>
                  <p class="price__note">{tier === "bench" ? "Rows C and D." : "Rows A and B, nearest the demo station, with the Atelier dinner. Ten places."}</p>
                </div>
              ))}
            </div>
            <div class="terms">
              <h3 class="facts__title">Deadlines</h3>
              <p>
                Deposits close and balances fall due on <span class="num">19 March 2027</span>. From <span class="num">20 March 2027</span> seats are sold in
                full only.
              </p>
              <h3 class="facts__title">Refund schedule</h3>
              <ul class="schedule">
                <li>
                  <span class="schedule__when num">On or before 15 January 2027</span>
                  <span>
                    The amount paid minus <span class="num">$250.00</span>.
                  </span>
                </li>
                <li>
                  <span class="schedule__when num">16 January to 19 March 2027</span>
                  <span>Half the amount paid.</span>
                </li>
                <li>
                  <span class="schedule__when num">From 20 March 2027</span>
                  <span>No refund; assign the seat to a colleague instead.</span>
                </li>
              </ul>
            </div>
            <div class="faq">
              <h3 class="facts__title">Questions</h3>
              {failed && <p class="slow">{SLOW}</p>}
              <ul class="faq__list">
                {content?.faq.map((entry) => <FaqItem key={entry.id} question={entry.question} answer={entry.answer} />)}
              </ul>
            </div>
            <AccountEntry />
          </div>
        </Chapter>
      </main>
      <footer class="footer">
        <p>
          {EVENT.name} · {EVENT.course} · {EVENT.venue}, {EVENT.street}, {EVENT.locality}
        </p>
      </footer>
      {narrow && <ReserveBar narrow onPay={onPay} onReserve={reserve} />}

      {s.signInFor && <AuthDialog returnFocus={() => store.signInOpener} />}
      {checkout && checkout.kind !== "group" && <Checkout kind={checkout.kind} opener={checkout.opener} onClose={() => setCheckout(null)} />}
      {checkout?.kind === "group" && <GroupCheckout opener={checkout.opener} onClose={() => setCheckout(null)} />}
      <HoldEnded />
    </div>
  );
}
