import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ServiceStatus } from "../shared/api.ts";
import type { Locale } from "../shared/domain.ts";
import { focusHeading, reducedMotion, RISE_MS, riseIn, riseOut, useApp } from "./context.tsx";
import { Icon } from "./ui.tsx";

type Service = "billing" | "mail";

/** Service notice (brief: Outage notices): shown while a service is down; dismissal lasts until that service's status next changes. */
function ServiceNotice() {
  const { t, status } = useApp();
  const [dismissed, setDismissed] = useState<Partial<Record<Service, ServiceStatus[Service]>>>({});
  const ref = useRef<HTMLDivElement>(null);
  const down = (["billing", "mail"] as const).filter((s) => status?.[s] === "down" && dismissed[s] !== "down");
  const shown = down.length > 0;
  // While the notice leaves it keeps the paragraphs it last showed, then hides.
  const [leaving, setLeaving] = useState<Service[]>([]);
  const lastShown = useRef<Service[]>([]);
  if (shown) lastShown.current = down;
  const paragraphs = shown ? down : leaving;
  useLayoutEffect(() => {
    if (!status) return;
    setDismissed((current) => {
      const next = { ...current };
      for (const s of ["billing", "mail"] as const) if (next[s] !== undefined && next[s] !== status[s]) delete next[s];
      return next;
    });
  }, [status?.billing, status?.mail]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (shown) {
      setLeaving([]);
      riseIn(element);
      return;
    }
    const gone = lastShown.current;
    lastShown.current = [];
    if (!element || gone.length === 0 || reducedMotion()) return;
    setLeaving(gone);
    const fade = riseOut(element);
    const timer = window.setTimeout(() => {
      fade.cancel();
      setLeaving([]);
    }, RISE_MS);
    return () => {
      window.clearTimeout(timer);
      fade.cancel();
    };
  }, [shown]);
  return (
    <div ref={ref} class="notice" role="alert" aria-label={t.serviceNotice} hidden={paragraphs.length === 0}>
      <Icon name="alert" />
      <div class="notice-text">
        {paragraphs.includes("billing") ? <p>{t.billingNotice}</p> : null}
        {paragraphs.includes("mail") ? <p>{t.mailNotice}</p> : null}
      </div>
      <button type="button" class="button ghost" onClick={() => {
        const next = { ...dismissed };
        for (const s of down) next[s] = "down";
        setDismissed(next);
        focusHeading();
      }}>{t.dismissNotice}</button>
    </div>
  );
}

function LanguageButton({ onSwitch }: { onSwitch: (locale: Locale) => void }) {
  const { locale, t } = useApp();
  const target: Locale = locale === "en" ? "fr" : "en";
  const next = location.pathname + location.search;
  return (
    <form class="language-form" method="get" action={`/locale/${target}`} onSubmit={(e) => { e.preventDefault(); onSwitch(target); }}>
      <input type="hidden" name="next" value={next} />
      <button type="submit" class="button ghost language" lang={target}>
        <Icon name="languages" />
        <span>{t.switchTo}</span>
      </button>
    </form>
  );
}

export function Layout({ onSwitch, wide, children }: { onSwitch: (locale: Locale) => void; wide?: boolean; children: ComponentChildren }) {
  const { locale, t, me } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const accountHref = me ? (me.role === "patron" ? `/${locale}/account` : `/${locale}/staff`) : `/${locale}/signin`;
  const here = location.pathname.replace(/^\/(en|fr)/, "");
  const links: [string, string][] = [
    [`/${locale}/`, t.navProgramme],
    [`/${locale}/membership`, t.navMembership],
    [`/${locale}/gift`, t.navGift],
    [`/${locale}/contact`, t.navContact],
    [accountHref, me ? t.navAccount : t.navSignIn],
  ];
  return (
    <>
      <a class="skip-link" href="#main" onClick={(e) => { e.preventDefault(); focusHeading(); }}>{t.skip}</a>
      <header class="site-header">
        <a class="wordmark" href={`/${locale}/`}>
          <span class="wordmark-name">{t.wordmark}</span>
          <span class="wordmark-sub">{t.wordmarkSub}</span>
        </a>
        <button type="button" class="button ghost menu-button" aria-expanded={menuOpen ? "true" : "false"} aria-controls="primary-nav"
          onClick={() => setMenuOpen(!menuOpen)}>
          <Icon name={menuOpen ? "close" : "menu"} />
          <span>{t.menu}</span>
        </button>
        <nav id="primary-nav" class={menuOpen ? "primary-nav is-open" : "primary-nav"} aria-label={t.primary}>
          <ul>
            {links.map(([href, label]) => {
              const current = href.replace(/^\/(en|fr)/, "") === (here || "/");
              return <li key={label}><a href={href} aria-current={current ? "page" : undefined}>{label}</a></li>;
            })}
          </ul>
        </nav>
        <LanguageButton onSwitch={onSwitch} />
      </header>
      <ServiceNotice />
      <main id="main" class={wide ? "main wide" : "main"}>{children}</main>
      <footer class="site-footer"><p>{t.footer}</p></footer>
    </>
  );
}
