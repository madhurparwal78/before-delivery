export type PageStatus = 'live' | 'ended' | 'none';

export interface PageRow {
  readonly id: string;
  readonly token: string;
  readonly issued_at: Date;
  readonly ends_at: Date;
  readonly ended_at: Date | null;
}

/** The one private page lifetime rule: live until its end instant or an explicit end. */
export function pageStatus(page: PageRow | null, now: Date): PageStatus {
  if (page === null) return 'none';
  if (page.ended_at !== null) return 'ended';
  return now.getTime() >= page.ends_at.getTime() ? 'ended' : 'live';
}
