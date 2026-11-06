/** Status shapes, so no state is carried by colour alone. */

import { Clock } from 'lucide-react';
import {
  REVIEW_CODE_LABELS,
  REVIEW_CODE_SHAPES,
  type ReviewCode,
  type ShapeName,
} from '../../shared/domain.js';
import { formatDate } from '../../shared/format.js';

export function Shape({ name }: { name: ShapeName }): JSX.Element {
  if (name === 'clock') {
    return (
      <span className="shape" data-shape="clock" role="img" aria-hidden="true">
        <Clock size={16} strokeWidth={2} aria-hidden="true" />
      </span>
    );
  }
  const paths: Record<Exclude<ShapeName, 'clock'>, JSX.Element> = {
    circle: <circle cx="8" cy="8" r="6" fill="currentColor" />,
    ring: <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />,
    square: <rect x="2.5" y="2.5" width="11" height="11" fill="currentColor" />,
    diamond: <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill="currentColor" />,
    triangle: <path d="M8 2 14.5 14 1.5 14Z" fill="none" stroke="currentColor" strokeWidth="2" />,
    cross: (
      <path
        d="M3 3 13 13 M13 3 3 13"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    ),
  };
  return (
    <span className="shape" data-shape={name} role="img" aria-hidden="true">
      <svg viewBox="0 0 16 16" width="16" height="16" focusable="false" aria-hidden="true">
        {paths[name]}
      </svg>
    </span>
  );
}

export function ReviewCodeBadge({ code }: { code: ReviewCode }): JSX.Element {
  return (
    <span className="badge" data-code={code}>
      <Shape name={REVIEW_CODE_SHAPES[code]} />
      {REVIEW_CODE_LABELS[code]}
    </span>
  );
}

export function ReviewDueBadge({
  overdue,
  reviewDueOn,
}: {
  overdue: boolean;
  reviewDueOn: string;
}): JSX.Element {
  if (overdue) {
    return (
      <span className="badge badge-overdue">
        <Shape name="clock" />
        Review overdue
      </span>
    );
  }
  return <span className="badge">{`Due ${formatDate(reviewDueOn)}`}</span>;
}
