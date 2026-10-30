import type { JSX } from 'react';
import { CircleAlert, TriangleAlert } from 'lucide-react';

/**
 * A vermilion mark always carries a word as well, so the icon only repeats what the copy says and
 * never joins the text a reader or a test reads.
 */
export function ClashMark(props: { text: string }): JSX.Element {
  return (
    <span className="clash">
      <TriangleAlert aria-hidden="true" focusable="false" size={16} />
      <span>{props.text}</span>
    </span>
  );
}

export function ProblemMark(props: { label: string; text: string }): JSX.Element {
  return (
    <p className="alert" role="alert" aria-label={props.label}>
      {props.text === '' ? null : (
        <CircleAlert aria-hidden="true" focusable="false" size={16} />
      )}
      <span>{props.text}</span>
    </p>
  );
}

export function FieldError(props: { id: string; text: string }): JSX.Element {
  return (
    <p className="field-error" id={props.id}>
      <CircleAlert aria-hidden="true" focusable="false" size={14} />
      <span>{props.text}</span>
    </p>
  );
}
