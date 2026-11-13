export interface KeyRef {
  key_id: string;
  public_key: string; // raw 65-byte uncompressed point, base64url
}

export type PreviewSetting = 'name_and_letter' | 'name_only' | 'none';

export interface AccountSettings {
  read_receipts: boolean;
  preview: PreviewSetting;
}

export interface SealedProfile {
  iv: string;
  ciphertext: string;
  photo_blob_id: string | null;
}

export interface Account {
  id: string;
  username: string;
  key_id: string;
  public_key: string;
  settings: AccountSettings;
  profile: SealedProfile | null;
  username_changed_at: string | null;
  created_at: string;
}

export type SealStatus = 'verified' | 'unverified' | 'changed';

export interface ConversationPeer {
  id: string;
  username: string;
  key_id: string;
  public_key: string;
  seal: SealStatus;
  profile: SealedProfile | null;
}

export interface Attachment {
  blob_id: string;
  key: string; // b64url 32 bytes
  iv: string; // b64url 12 bytes
  digest: string; // SHA-256 of sealed bytes, b64url
  size: number; // unsealed byte count
  name: string;
  type: string;
  width?: number;
  height?: number;
  thumb?: string; // base64url JPEG, long edge <= 32px
}

export type LetterKind = 'text' | 'image' | 'file';

export interface LetterBodyText { v: 1; kind: 'text'; text: string }
export interface LetterBodyImage { v: 1; kind: 'image'; text: string; attachment: Attachment }
export interface LetterBodyFile { v: 1; kind: 'file'; text: string; attachment: Attachment }
export interface ControlBodyProfile { v: 1; kind: 'profile'; profile_key: string }
export type LetterBody = LetterBodyText | LetterBodyImage | LetterBodyFile | ControlBodyProfile;

export type LetterClass = 'letter' | 'control';
export type LetterState = 'sent' | 'delivered' | 'read' | 'failed';
export type LetterFailure = null | 'returned';

export interface Letter {
  id: string;
  conversation_id: string;
  seq: number;
  sender_id: string;
  recipient_id: string;
  class: LetterClass;
  state: LetterState;
  failure: LetterFailure;
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

export interface Conversation {
  id: string;
  status: 'accepted' | 'request';
  peer: ConversationPeer;
  unread: number;
  muted_until: string | 'always' | null;
  blocked: boolean;
  last_letter: Letter | null;
  updated_at: string;
}

export type BlobKind = 'image' | 'file' | 'photo';
export type BlobState = 'uploading' | 'stored';

export interface BlobRecord {
  id: string;
  kind: BlobKind;
  size: number;
  state: BlobState;
}

export interface AppConfig {
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

export interface KeyHistoryEntry {
  key_id: string;
  public_key: string;
  created_at: string;
  current: boolean;
}

export interface KeyBackup {
  key_id: string;
  iv: string;
  ciphertext: string;
  created_at: string;
}

export interface BlockEntry {
  account_id: string;
  username: string;
  blocked_at: string;
}

export interface RecoverResult {
  account: Account;
  key_backups: KeyBackup[];
}

export interface LookupResult {
  id: string;
  username: string;
  key_id: string;
  public_key: string;
  profile: SealedProfile | null;
}

export interface InboxAckResult {
  delivered: number;
}

export interface LettersPage {
  letters: Letter[];
}

export interface ConversationsPage {
  conversations: Conversation[];
}

export interface BlocksPage {
  blocks: BlockEntry[];
}

export interface SealResult {
  account_id: string;
  key_id: string;
  seal: SealStatus;
}

export interface KeysPage {
  keys: KeyHistoryEntry[];
}

export type ClientLetterDelivery =
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';
