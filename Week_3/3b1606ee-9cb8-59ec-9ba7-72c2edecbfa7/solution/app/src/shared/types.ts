export type Iso = string;

export type PreviewSetting = 'name_and_letter' | 'name_only' | 'none';
type SealStatus = 'verified' | 'unverified' | 'changed';
type LetterClass = 'letter' | 'control';
export type DeliveryState = 'sent' | 'delivered' | 'read' | 'failed';
export type BlobKind = 'image' | 'file' | 'photo';
export type MuteDuration = '1h' | '8h' | '1w' | 'always' | 'off';

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
  settings: { read_receipts: boolean; preview: PreviewSetting };
  profile: SealedProfile | null;
  username_changed_at: Iso | null;
  created_at: Iso;
}

interface Peer {
  id: string;
  username: string;
  key_id: string;
  public_key: string;
  seal: SealStatus;
  profile: SealedProfile | null;
}

export interface Letter {
  id: string;
  conversation_id: string;
  seq: number;
  sender_id: string;
  recipient_id: string;
  class: LetterClass;
  state: DeliveryState;
  failure: 'returned' | null;
  held_at: Iso;
  delivered_at: Iso | null;
  read_at: Iso | null;
  returned_at: Iso | null;
  retracted_at: Iso | null;
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
  peer: Peer;
  unread: number;
  muted_until: Iso | 'always' | null;
  blocked: boolean;
  last_letter: Letter | null;
  updated_at: Iso;
}

export interface BlobRecord {
  id: string;
  kind: BlobKind;
  size: number;
  state: 'uploading' | 'stored';
}

export interface Config {
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

export interface KeyBackup {
  key_id: string;
  iv: string;
  ciphertext: string;
  created_at: Iso;
}

export interface KeyEntry {
  key_id: string;
  public_key: string;
  created_at: Iso;
  current: boolean;
}

export interface BlockEntry {
  account_id: string;
  username: string;
  blocked_at: Iso;
}

export type ServerFrame =
  | { type: 'letter'; letter: Letter }
  | { type: 'conversation'; conversation: Conversation }
  | { type: 'keys'; account_id: string }
  | { type: 'signed_out' };
