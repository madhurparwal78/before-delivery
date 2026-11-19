// Row shapes shared between API handlers.

import type { AccountRow, GuideRow } from './store';

export interface GuideAccess {
  guide: GuideRow;
  isOwner: boolean;
  isCoauthor: boolean;
  viewer: AccountRow | null;
}

export type { AccountRow, GuideRow };
