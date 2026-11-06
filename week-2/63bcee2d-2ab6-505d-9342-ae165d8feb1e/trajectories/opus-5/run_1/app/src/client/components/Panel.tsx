/** Office panels, each headed like a drawing title block. */

import type { ReactNode } from 'react';
import { HK_ZONE } from '../../shared/domain.js';
import { formatInstantDate } from '../../shared/format.js';

export function TitleBlock({
  sheetCode,
  revision,
  name,
}: {
  sheetCode: string;
  revision: string;
  name: string;
}): JSX.Element {
  return (
    <div className="title-block">
      <span className="title-block-cell">
        <span className="title-block-key">Sheet</span>
        <span className="title-block-value">{sheetCode}</span>
      </span>
      <span className="title-block-cell">
        <span className="title-block-key">Panel</span>
        <span className="title-block-value">{name}</span>
      </span>
      <span className="title-block-cell">
        <span className="title-block-key">Rev</span>
        <span className="title-block-value">{revision}</span>
      </span>
      <span className="title-block-cell">
        <span className="title-block-key">Date</span>
        <span className="title-block-value">{formatInstantDate(new Date(), HK_ZONE)}</span>
      </span>
    </div>
  );
}

export function Panel({
  sheetCode,
  revision,
  name,
  heading,
  children,
}: {
  sheetCode: string;
  revision: string;
  name: string;
  heading: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="panel">
      <TitleBlock sheetCode={sheetCode} revision={revision} name={name} />
      {heading}
      {children}
    </section>
  );
}

/** A table region that scrolls sideways inside itself and takes focus. */
export function TableRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      className={`table-region ${className ?? ''}`.trim()}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
