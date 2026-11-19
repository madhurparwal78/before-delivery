import { Fragment } from 'react';

/** `http://` or `https://` up to the next whitespace, and `mailto:` addresses: the only links plain text may carry here. */
const WEB_LINK = /((?:https?:\/\/|mailto:)\S+)/g;

/**
 * Renders author text as plain text with line breaks and web links only. Nothing typed becomes an element
 * except an anchor for a published link pattern; the line breaks are the text's own (`white-space: pre-wrap`).
 */
export function RichText({ text }: { text: string }) {
  return (
    <span className="rich-text">
      {text.split(WEB_LINK).map((part, index) =>
        index % 2 === 1 ? (
          <a key={index} href={part} rel="noreferrer noopener" target="_blank">
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </span>
  );
}
