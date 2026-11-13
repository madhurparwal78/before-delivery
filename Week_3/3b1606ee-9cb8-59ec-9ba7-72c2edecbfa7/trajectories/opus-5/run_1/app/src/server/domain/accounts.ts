import { base64urlEncode } from '../../shared/scheme.js';
import type { AccountRecord, PreviewSetting } from '../../shared/types.js';
import { iso } from '../clock.js';
import type { Db } from '../db.js';
import { accountRow, currentKey, sealedProfile } from './conversations.js';

export async function accountRecord(db: Db, accountId: string): Promise<AccountRecord> {
  const account = await accountRow(db, accountId);
  const key = await currentKey(db, accountId);
  return {
    id: account.id,
    username: account.username,
    key_id: key.key_id,
    public_key: base64urlEncode(key.public_key),
    settings: {
      read_receipts: account.read_receipts,
      preview: account.preview as PreviewSetting,
    },
    profile: sealedProfile(account),
    username_changed_at: iso(account.username_changed_at),
    created_at: account.created_at.toISOString(),
  };
}
