/** The Results pane: live count, result rows in alternating bands, the empty state and Show more homes. */
import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { PublicUnit } from "../../shared/api-types.js";
import { COPY, countText } from "../../shared/copy.js";
import { BAND_LABEL, VIEW_LABEL, type Band, type ViewTag } from "../../shared/domain.js";
import { dollars, groupedNumber } from "../format.js";

interface Props {
  readonly rows: readonly PublicUnit[];
  readonly total: number | null;
  readonly busy: boolean;
  readonly paging: boolean;
  readonly hasMore: boolean;
  readonly firstLoad: boolean;
  readonly currentCode: string | null;
  readonly focusRow: string | null;
  readonly pageError: string | null;
  readonly statusLabel: (unit: PublicUnit) => { text: string; syncing: boolean };
  readonly onOpen: (code: string, element: HTMLElement) => void;
  readonly onMore: () => void;
  readonly onFocused: () => void;
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
}

export const Results = ({
  rows,
  total,
  busy,
  paging,
  hasMore,
  firstLoad,
  currentCode,
  focusRow,
  pageError,
  statusLabel,
  onOpen,
  onMore,
  onFocused,
  scrollRef,
}: Props): ReactNode => {
  const listRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (focusRow === null) return;
    listRef.current?.querySelector<HTMLElement>(`[data-row="${focusRow}"] button`)?.focus({ preventScroll: false });
    onFocused();
  }, [focusRow, onFocused]);

  return (
    <section className="results" aria-label="Results" aria-busy={busy || paging ? "true" : "false"}>
      <div className="results-scroll" ref={scrollRef}>
        <p className="result-count" role="status" aria-label="Result count" aria-live="polite">
          {total === null ? "" : countText(total)}
        </p>
        {pageError ? (
          <p className="banner banner-black" role="alert">
            {pageError}
          </p>
        ) : null}
        {total === 0 ? (
          <div className="empty">
            <h2 className="giant">{COPY.emptyHeading}</h2>
            <p>{COPY.emptyHint}</p>
          </div>
        ) : null}
        {firstLoad ? (
          <div className="skeleton-rows" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : null}
        <ul aria-label="Homes" className="rows" ref={listRef} hidden={rows.length === 0}>
          {rows.map((unit, index) => {
            const status = statusLabel(unit);
            return (
              <li key={unit.code} data-row={unit.code} className={`row ${index % 2 === 0 ? "row-surface" : "row-ground"}${unit.code === currentCode ? " row-current" : ""}`}>
                <button
                  type="button"
                  className="row-button"
                  aria-current={unit.code === currentCode ? "true" : undefined}
                  onClick={(event) => onOpen(unit.code, event.currentTarget)}
                >
                  <span className="row-code">{unit.code}</span>{" "}
                  <span className="row-status">
                    {status.text}
                    {status.syncing ? <span className="tag"> · {COPY.syncing}</span> : null}
                  </span>{" "}
                  <span className="row-price figures">{dollars(unit.price)}</span>{" "}
                  <span className="row-area figures">
                    {unit.areaM2} m² · {groupedNumber(unit.areaSqft)} sq ft
                  </span>{" "}
                  <span className="row-bearing figures">
                    {unit.bearing}° {unit.facing}
                  </span>{" "}
                  <span className="row-bed">{unit.bedrooms} bed</span> <span className="row-view">{VIEW_LABEL[unit.viewTag as ViewTag]}</span>{" "}
                  <span className="row-band">{BAND_LABEL[unit.band as Band]}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {hasMore ? (
          <div className="more">
            <button type="button" className="button" disabled={paging} onClick={onMore}>
              Show more homes
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
};
