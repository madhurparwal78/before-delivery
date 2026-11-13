import { ERRORS } from "../../../shared/copy.js";
import { Link, usePlace } from "../router.js";
import { edition, shelf } from "../state/market.js";
import { goToProgress } from "../state/scroll.js";
import { chooseSound, sound } from "../state/sound.js";
import { useStore } from "../state/store.js";
import { Alert, Button } from "../ui.js";
import { LABELS } from "./copy.js";
import { SoundIcon } from "./icons.js";
import { useExtent } from "./layout.js";
import { Search } from "./Search.js";
import type { View } from "./routes.js";

const SalesBanner = () => {
  const shelfState = useStore(shelf);
  const editionInfo = useStore(edition);
  const text = editionInfo?.salesOpen === false ? ERRORS.edition_closed.message() : shelfState.salesPaused ? ERRORS.sales_paused.message() : "";
  return (
    <Alert label={LABELS.banner} className="banner">
      {text}
    </Alert>
  );
};

const SoundToggle = () => {
  const choice = useStore(sound);
  return (
    <Button variant="ghost" className="topbar__sound" aria-pressed={choice === "on"} onClick={() => chooseSound(choice === "on" ? "off" : "on")}>
      <SoundIcon on={choice === "on"} />
      <span className="topbar__sound-word">{LABELS.sound.toggle}</span>
    </Button>
  );
};

/** The quiet top bar over the scene: the three places, and on the story the search and the sound switch. */
export const Header = ({ view }: { view: View }) => {
  const { pathname } = usePlace();
  const chrome = useExtent("chrome");
  const links = [
    { href: "/", label: LABELS.nav.story },
    { href: "/shelf", label: LABELS.nav.shelf },
    { href: "/lookup", label: LABELS.nav.lookup },
  ];
  return (
    <header className={`topbar topbar--${view.kind === "story" ? "story" : "sheet"}`} ref={chrome}>
      <div className="topbar__row">
        <nav aria-label={LABELS.nav.name} className="topbar__nav">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
              onClick={link.href === "/" ? () => goToProgress(0) : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        {view.kind === "story" ? (
          <>
            <Search />
            <SoundToggle />
          </>
        ) : null}
      </div>
      <SalesBanner />
    </header>
  );
};
