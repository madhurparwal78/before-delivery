// The sticky station-and-date rail: site, previous and next day, date, station type and the site clock.
import { useId, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, isIsoDate, type IsoDate } from "../shared/time.ts";
import type { Site } from "../shared/api.ts";

export type StationFilter = "all" | "oven" | "mixer" | "blast_chiller" | "prep_table";

const FILTERS: [StationFilter, string][] = [
  ["all", "All"],
  ["oven", "Ovens"],
  ["mixer", "Mixers"],
  ["blast_chiller", "Blast chillers"],
  ["prep_table", "Prep tables"],
];

interface RailProps {
  sites: Site[];
  siteId: string;
  /** Book: the site picker. Without it (Site day) the site name shows as text. */
  onSite?: (id: string) => void;
  date: IsoDate;
  onDate: (date: IsoDate) => void;
  filter?: StationFilter;
  onFilter?: (filter: StationFilter) => void;
}

export function Rail({ sites, siteId, onSite, date, onDate, filter, onFilter }: RailProps): ReactNode {
  const id = useId();
  const site = sites.find((s) => s.id === siteId);
  return (
    <div className="rail">
      {onSite ? (
        <div className="field rail-site">
          <label htmlFor={`${id}-site`}>Site</label>
          <select id={`${id}-site`} value={siteId} onChange={(event) => onSite(event.target.value)}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="rail-site rail-site-name">Site: {site?.name ?? ""}</p>
      )}
      <div className="rail-dates">
        <button type="button" className="icon-button" aria-label="Previous day" onClick={() => onDate(addDays(date, -1))}>
          <ChevronLeft aria-hidden="true" size={20} />
        </button>
        <div className="field">
          <label htmlFor={`${id}-date`}>Date</label>
          <input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(event) => {
              if (isIsoDate(event.target.value)) onDate(event.target.value);
            }}
          />
        </div>
        <button type="button" className="icon-button" aria-label="Next day" onClick={() => onDate(addDays(date, 1))}>
          <ChevronRight aria-hidden="true" size={20} />
        </button>
      </div>
      <p className="site-time">
        Site time <span className="mono">{site ? site.local_now.slice(11, 16) : "--:--"}</span>
      </p>
      {filter && onFilter && (
        <div role="radiogroup" aria-label="Station type" className="rail-filter">
          {FILTERS.map(([value, label]) => (
            <label key={value} className="radio">
              <input type="radio" name={`${id}-filter`} value={value} checked={filter === value} onChange={() => onFilter(value)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
