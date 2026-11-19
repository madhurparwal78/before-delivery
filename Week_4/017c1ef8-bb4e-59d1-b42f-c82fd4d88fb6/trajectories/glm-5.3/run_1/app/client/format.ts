const fmtNumber = (n: number): string => n.toLocaleString('en-US');

export const limitText = (limit: number): string => fmtNumber(limit);

export const dateInZone = (instant: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'short', day: 'numeric', year: 'numeric',
  }).format(instant);
  return parts.replace(/, (\d{4})/, ', $1').replace(/(\d+),/, '$1,');
};

export const timeInZone = (instant: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-US', {
    timeZone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(instant).replace(/\u202f/g, ' ').replace(/\s?([AP])M/, ' $1M');

/** Relative time on the business clock; every division rounds down. */
export const relativeTime = (createdAt: string, now: Date, timeZone: string): string => {
  const ms = now.getTime() - Date.parse(createdAt);
  if (ms < 0) return 'now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 28) return `${Math.floor(days / 7)}w`;
  return dateInZone(new Date(Date.parse(createdAt)), timeZone);
};

export const degreeLabel = (degree: string): string =>
  degree === '1' ? '1st' : degree === '2' ? '2nd' : degree === '3' ? '3rd+' : 'Out of network';

export const degreeNumeral = (degree: string): string =>
  degree === '1' ? '1' : degree === '2' ? '2' : degree === '3' ? '3' : '—';

export const mutualLineText = (count: number, namedName: string | null): string => {
  if (count === 0) return '';
  if (count === 1) return '1 mutual connection';
  const name = namedName ?? '';
  if (count === 2) return `${name} and 1 other mutual connection`;
  return `${name} and ${count - 1} other mutual connections`;
};

export const firstNameOf = (name: string): string => name.split(' ')[0] ?? name;

export const reactionSummaryText = (summary: { count: number; mine: string | null; text: string }): string => summary.text;

export const counterText = (used: number, limit: number): string => {
  if (used > limit) return `${used - limit} over the limit`;
  return `${used} / ${fmtNumber(limit)}`;
};

export const REACTION_TYPES: { value: string; label: string }[] = [
  { value: 'like', label: 'Like' },
  { value: 'celebrate', label: 'Celebrate' },
  { value: 'support', label: 'Support' },
  { value: 'insightful', label: 'Insightful' },
  { value: 'funny', label: 'Funny' },
];

export const stageLabel = (state: string): string =>
  ({ applied: 'Applied', viewed: 'Viewed', interviewing: 'Interviewing', offered: 'Offered',
     rejected: 'Rejected', withdrawn: 'Withdrawn' })[state] ?? state;

export const statusText = (state: string): string =>
  ({ applied: 'Application submitted', viewed: 'Viewed by the hiring team', interviewing: 'Interviewing',
     offered: 'Offer extended', rejected: 'Not selected', withdrawn: 'Withdrawn' })[state] ?? state;

export const legalMoves: Record<string, string[]> = {
  applied: ['viewed', 'rejected', 'withdrawn'],
  viewed: ['interviewing', 'rejected', 'withdrawn'],
  interviewing: ['offered', 'rejected', 'withdrawn'],
  offered: ['rejected'],
  rejected: [],
  withdrawn: [],
};

/** The one allowlist renderer: text, line breaks, mentions, hashtags and web links only. */
export const renderBody = (text: string, mentions: { handle: string; member_id: string; name: string }[]): { kind: 'text' | 'mention' | 'hashtag' | 'link'; value: string; handle?: string; name?: string; id?: string }[] => {
  const out: { kind: 'text' | 'mention' | 'hashtag' | 'link'; value: string; handle?: string; name?: string; id?: string }[] = [];
  const pattern = /(^|\s)(@[a-z0-9-]{3,30}|#[A-Za-z0-9_]{1,50}|https?:\/\/\S+|mailto:[^\s@]+@[^\s@]+\.[^\s@]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) out.push({ kind: 'text', value: text.slice(lastIndex, match.index) });
    const token = match[2];
    const mention = token.startsWith('@') ? mentions.find((m) => m.handle === token.slice(1)) : undefined;
    if (mention) {
      out.push({ kind: 'mention', value: token, handle: mention.handle, name: mention.name, id: mention.member_id });
    } else if (token.startsWith('@')) {
      out.push({ kind: 'text', value: match[1] + token });
    } else if (token.startsWith('#')) {
      out.push({ kind: 'hashtag', value: token });
    } else {
      out.push({ kind: 'link', value: match[1] + token });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) out.push({ kind: 'text', value: text.slice(lastIndex) });
  return out;
};

export const formatDateInZone = (instant: Date, timeZone: string): string => dateInZone(instant, timeZone);
export const formatTimeInZone = (instant: Date, timeZone: string): string => timeInZone(instant, timeZone);
export const isoToLocalInput = (instant: string, timeZone: string): string => {
  const d = new Date(instant);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
};

export const localInputToIso = (value: string, timeZone: string): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  // Interpret in the configured zone, then convert to UTC.
  const utcGuess = new Date(`${y}-${mo}-${d}T${h}:${mi}:00Z`);
  const offsetParts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(utcGuess);
  const get = (t: string): string => offsetParts.find((p) => p.type === t)?.value ?? '00';
  const asZone = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')),
    Number(get('hour')) === 24 ? 0 : Number(get('hour')), Number(get('minute')));
  const offset = asZone - utcGuess.getTime();
  const final = new Date(asZone - offset);
  // verify
  const check = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(final);
  const checkFlat = check.replace(/(\d{4}),?\s*/, '$1-').replace(',', '').replace(/\//g, '-').replace(/\s+/, 'T');
  const [cy, cm, cd] = checkFlat.split('T')[0].split('-');
  const chh = checkFlat.split('T')[1].split(':')[0].padStart(2, '0');
  const cmi = checkFlat.split('T')[1].split(':')[1];
  if (cy !== y || cm !== mo || cd !== d || chh !== h || cmi !== mi) return null;
  return final.toISOString();
};

export const skillRowText = (name: string, endorsements: number): string =>
  endorsements === 0 ? `${name} · No endorsements yet` : endorsements === 1 ? `${name} · 1 endorsement` : `${name} · ${endorsements} endorsements`;

export const searchCountText = (total: number, query: string): string => {
  if (total === 0) return `No results for “${query}”`;
  if (total === 1) return '1 result';
  return `${fmtNumber(total)} results`;
};
