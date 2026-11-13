/** The records the API publishes, shared by the exchange and the browser. */

export type PreviewSetting = 'name_and_letter' | 'name_only' | 'none';
export type SealStatus = 'verified' | 'unverified' | 'changed';
export type ConversationStatus = 'accepted' | 'request';
export type LetterClass = 'letter' | 'control';
export type LetterState = 'sent' | 'delivered' | 'read' | 'failed';
export type BlobKind = 'image' | 'file' | 'photo';
export type BlobState = 'uploading' | 'stored';
export type MuteDuration = '1h' | '8h' | '1w' | 'always' | 'off';

export interface SealedProfile {
  iv: string;
  ciphertext: string;
  photo_blob_id: string | null;
}

export interface AccountSettings {
  read_receipts: boolean;
  preview: PreviewSetting;
}

export interface AccountRecord {
  id: string;
  username: string;
  key_id: string;
  public_key: string;
  settings: AccountSettings;
  profile: SealedProfile | null;
  username_changed_at: string | null;
  created_at: string;
}

export interface PeerRecord {
  id: string;
  username: string;
  key_id: string;
  public_key: string;
  seal: SealStatus;
  profile: SealedProfile | null;
}

export interface LetterRecord {
  id: string;
  conversation_id: string;
  seq: number;
  sender_id: string;
  recipient_id: string;
  class: LetterClass;
  state: LetterState;
  failure: null | 'returned';
  held_at: string;
  delivered_at: string | null;
  read_at: string | null;
  returned_at: string | null;
  retracted_at: string | null;
  can_retract: boolean;
  sender_key_id: string;
  recipient_key_id: string;
  iv: string | null;
  ciphertext: string | null;
  attachment_id: string | null;
}

export interface ConversationRecord {
  id: string;
  status: ConversationStatus;
  peer: PeerRecord;
  unread: number;
  muted_until: string | 'always' | null;
  blocked: boolean;
  last_letter: LetterRecord | null;
  updated_at: string;
}

export interface BlobRecord {
  id: string;
  kind: BlobKind;
  size: number;
  state: BlobState;
}

export interface BlockRecord {
  account_id: string;
  username: string;
  blocked_at: string;
}

export interface KeyRecord {
  key_id: string;
  public_key: string;
  created_at: string;
  current: boolean;
}

export interface KeyBackupRecord {
  key_id: string;
  iv: string;
  ciphertext: string;
  created_at: string;
}

export interface LookupRecord {
  id: string;
  username: string;
  key_id: string;
  public_key: string;
  profile: SealedProfile | null;
}

export interface ConfigRecord {
  attachment_max_bytes: number;
  timers: {
    undo_ms: number;
    connecting_delay_ms: number;
    availability_debounce_ms: number;
    retry_base_ms: number;
    retry_cap_ms: number;
    toast_ms: number;
  };
  grading: boolean;
}

export type AvailabilityReason =
  | null
  | 'taken'
  | 'length'
  | 'characters'
  | 'first_character'
  | 'last_character';

export interface AvailabilityRecord {
  username: string;
  available: boolean;
  reason: AvailabilityReason;
}

export type SocketFrame =
  | { type: 'letter'; letter: LetterRecord }
  | { type: 'conversation'; conversation: ConversationRecord }
  | { type: 'keys'; account_id: string }
  | { type: 'signed_out' };

/** Letter body shapes, sealed in the browser. */
export interface AttachmentDescriptor {
  blob_id: string;
  key: string;
  iv: string;
  digest: string;
  size: number;
  name: string;
  type: string;
  width?: number;
  height?: number;
  thumb?: string;
}

export type LetterBody =
  | { v: 1; kind: 'text'; text: string }
  | { v: 1; kind: 'image'; text: string; attachment: AttachmentDescriptor }
  | { v: 1; kind: 'file'; text: ''; attachment: AttachmentDescriptor }
  | { v: 1; kind: 'profile'; profile_key: string };

export interface ProfileBody {
  v: 1;
  display_name: string;
  photo: null | {
    blob_id: string;
    key: string;
    iv: string;
    digest: string;
    type: string;
  };
}
