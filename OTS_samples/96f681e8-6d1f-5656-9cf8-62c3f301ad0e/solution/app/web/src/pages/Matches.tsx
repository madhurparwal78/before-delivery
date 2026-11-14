import { MatchCarousel } from "../components/MatchCarousel";
import { SearchPill } from "../components/SearchPill";
import { useMatches } from "../matches";
import { useLocation } from "../router";

export function Matches() {
  const { search } = useLocation();
  const level = search.get("level") ?? "";
  const day = search.get("day") ?? "";
  const { matches, failed, joins, join } = useMatches({ level: level || undefined, day: day || undefined });
  return (
    <div className="page">
      <div className="column">
        <h1 className="page__title">Matches</h1>
        <div className="page__search">
          <SearchPill level={level} day={day} />
        </div>
        <MatchCarousel matches={matches} failed={failed} joins={joins} onJoin={join} />
      </div>
    </div>
  );
}
