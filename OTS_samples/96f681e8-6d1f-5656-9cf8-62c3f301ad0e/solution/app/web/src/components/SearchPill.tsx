import { type FormEvent, useEffect, useState } from "react";
import { addDays, clubToday, levelOptions } from "../format";
import { navigate } from "../router";
import { serverNow } from "../clock";
import { SearchIcon } from "./Icons";


interface Props {
  level?: string;
  day?: string;
}

/** The level and day search pill: `search "Find a match"`. */
export function SearchPill({ level = "", day = "" }: Props) {
  const [chosenLevel, setLevel] = useState(level);
  const [chosenDay, setDay] = useState(day);
  const [today, setToday] = useState(() => clubToday(serverNow()));

  useEffect(() => setLevel(level), [level]);
  useEffect(() => setDay(day), [day]);
  useEffect(() => {
    const refresh = () => setToday(clubToday(serverNow()));
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const query = new URLSearchParams();
    if (chosenLevel) query.set("level", chosenLevel);
    if (chosenDay) query.set("day", chosenDay);
    navigate(`/matches${query.size ? `?${query}` : ""}`);
  };

  const enter = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") submit();
  };

  return (
    <form className="search-pill" role="search" aria-label="Find a match" onSubmit={submit}>
      <SearchIcon size={24} className="search-pill__icon" />
      <label className="search-pill__field">
        <span className="visually-hidden">Level</span>
        <select aria-label="Level" value={chosenLevel} onChange={(e) => setLevel(e.target.value)} onKeyDown={enter}>
          <option value="">Any level</option>
          {levelOptions.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="search-pill__field">
        <span className="visually-hidden">Day</span>
        <select aria-label="Day" value={chosenDay} onChange={(e) => setDay(e.target.value)} onKeyDown={enter}>
          <option value="">Any day</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="pill pill--cobalt">
        Find matches
      </button>
    </form>
  );
}
