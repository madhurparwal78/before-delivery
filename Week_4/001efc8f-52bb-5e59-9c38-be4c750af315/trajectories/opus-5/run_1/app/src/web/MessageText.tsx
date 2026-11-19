import { Fragment, type ReactElement } from 'react';
import { splitMessageText } from '../shared/linkify';

/** Message text is plain text; only http and https runs become safe links. */
export function MessageText({ text }: { text: string }): ReactElement {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {lineIndex > 0 ? <br /> : null}
          {splitMessageText(line).map((segment, index) =>
            segment.kind === 'link' ? (
              <a key={index} href={segment.href} target="_blank" rel="noopener noreferrer">
                {segment.value}
              </a>
            ) : (
              <Fragment key={index}>{segment.value}</Fragment>
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}
