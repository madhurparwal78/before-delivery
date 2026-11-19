import { Fragment, ReactNode } from 'react';

const KEY = /("(?:[^"\\]|\\.)*")(\s*:)/g;

/** Keys in white against pink values; structure is shown by weight, never by a second hue. */
function renderLine(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let position = 0;
  for (const match of line.matchAll(KEY)) {
    const start = match.index ?? 0;
    if (start > last) {
      parts.push(
        <span key={position++} className="json-value">
          {line.slice(last, start)}
        </span>,
      );
    }
    parts.push(
      <span key={position++} className="json-key">
        {match[1]}
      </span>,
    );
    parts.push(
      <span key={position++} className="json-value">
        {match[2]}
      </span>,
    );
    last = start + match[0].length;
  }
  if (last < line.length) {
    parts.push(
      <span key={position++} className="json-value">
        {line.slice(last)}
      </span>,
    );
  }
  return parts;
}

export function JsonBlock({
  text,
  docId,
  className,
}: {
  text: string;
  docId?: string;
  className?: string;
}): JSX.Element {
  return (
    <pre className={className ? `code-pane ${className}` : 'code-pane'} data-doc-id={docId}>
      {text.split('\n').map((line, index) => (
        <Fragment key={index}>
          {renderLine(line)}
          {'\n'}
        </Fragment>
      ))}
    </pre>
  );
}
