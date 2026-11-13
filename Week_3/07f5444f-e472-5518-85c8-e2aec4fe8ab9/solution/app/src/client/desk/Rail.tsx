// The works rail: every season programme as a large numeral, and under the current one its works
// with their copy figures and parts to mark.

import type { ProgrammeDetail, ProgrammeSummary } from "../../shared/api";
import { PROGRAMME_STATUS_LABELS } from "../../shared/api";
import { linkTo } from "../router";
import { Figure } from "../ui/Figure";

interface RailProps {
  programmes: ProgrammeSummary[];
  current: ProgrammeDetail | null;
  selectedWorkId: string | null;
  onChoose?: () => void;
}

export function RailContent({ programmes, current, selectedWorkId, onChoose }: RailProps) {
  return (
    <div className="rail__content">
      <p className="rail__heading">Season programmes</p>
      <ol className="rail__programmes">
        {programmes.map((summary) => {
          const programme = current?.id === summary.id ? current : summary;
          const isCurrent = current?.id === summary.id;
          return (
            <li key={programme.id} className={`rail__programme${isCurrent ? " rail__programme--current" : ""}`}>
              <div className="rail__entry">
                <a
                  className="rail__link"
                  aria-label={`Programme ${programme.number} · ${programme.title}`}
                  aria-current={isCurrent ? "page" : undefined}
                  {...linkTo(`/desk/${programme.id}`, onChoose)}
                >
                  <span className="rail__numeral">{programme.number}</span>{" "}
                  <span className="rail__title">{programme.title}</span>
                </a>
                <span className="rail__status">{PROGRAMME_STATUS_LABELS[programme.status]}</span>
              </div>
              {isCurrent && current && (
                <ul className="rail__works" aria-label="Works in programme">
                  {current.works.map((work) => (
                    <li key={work.id} className={`rail__work${work.id === selectedWorkId ? " rail__work--selected" : ""}`}>
                      <a
                        className="rail__work-link"
                        aria-current={work.id === selectedWorkId ? "true" : undefined}
                        {...linkTo(`/desk/${current.id}?work=${encodeURIComponent(work.id)}`, onChoose)}
                      >
                        {work.title}
                      </a>
                      <span className="rail__figures">
                        <Figure label="Needed" value={work.copies.needed} />
                        <Figure label="On hand" value={work.copies.on_hand} />
                        <Figure label="Short" value={work.copies.shortfall} caution />
                        <span className="figure">
                          <span className="mono">{work.parts_to_mark}</span> to mark
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
