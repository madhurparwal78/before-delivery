import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Mention } from '../../types';

/**
 * Post, comment and message text is plain text with line breaks. Only three kinds of link are built from it:
 * resolved mentions, hashtags and web links. Everything else, typed markup included, stays literal characters.
 */
const TOKEN = /(^|\s)(@[a-z0-9-]{3,30}(?![a-z0-9-])|#[A-Za-z0-9_]{1,50}(?![A-Za-z0-9_]))|(https?:\/\/\S+|mailto:\S+)/g;

function lines(text: string, key: string): ReactNode[] {
  return text.split('\n').flatMap((line, index) => (index === 0 ? [line] : [<br key={`${key}-${index}`} />, line]));
}

export function RichText({ text, mentions }: { text: string; mentions: Mention[] }) {
  const byHandle = new Map(mentions.map((mention) => [mention.handle, mention]));
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TOKEN)) {
    const lead = match[1] ?? '';
    const token = match[2];
    const web = match[3];
    const start = match.index + lead.length;
    parts.push(<Fragment key={`t${cursor}`}>{lines(text.slice(cursor, start), `l${cursor}`)}</Fragment>);
    cursor = start + (token ?? web ?? '').length;
    if (web) {
      parts.push(
        <a key={`w${start}`} href={web} target="_blank" rel="noreferrer noopener">
          {web}
        </a>,
      );
    } else if (token?.startsWith('#')) {
      parts.push(
        <Link key={`h${start}`} to={`/hashtag/${token.slice(1).toLowerCase()}`}>
          {token}
        </Link>,
      );
    } else {
      const mention = token ? byHandle.get(token.slice(1)) : undefined;
      parts.push(
        mention ? (
          <Link key={`m${start}`} to={`/in/${mention.handle}`} data-mention-id={mention.member_id}>
            {mention.name}
          </Link>
        ) : (
          <Fragment key={`p${start}`}>{token}</Fragment>
        ),
      );
    }
  }
  parts.push(<Fragment key="rest">{lines(text.slice(cursor), 'rest')}</Fragment>);
  return <>{parts}</>;
}
