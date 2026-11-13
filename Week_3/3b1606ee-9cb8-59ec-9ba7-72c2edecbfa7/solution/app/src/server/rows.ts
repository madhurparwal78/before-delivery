export interface AccountRow {
  id: string;
  username: string;
  key_id: string;
  public_key: Buffer;
  recovery_salt: Buffer;
  recovery_hash: Buffer;
  read_receipts: boolean;
  preview: 'name_and_letter' | 'name_only' | 'none';
  profile_iv: Buffer | null;
  profile_ciphertext: Buffer | null;
  profile_photo_blob_id: string | null;
  username_changed_at: Date | null;
  created_at: Date;
}

export interface BlobRow {
  id: string;
  owner_id: string;
  kind: 'image' | 'file' | 'photo';
  size: number;
  state: 'uploading' | 'stored';
  created_at: Date;
  discarded_at: Date | null;
  object_removed: boolean;
}

export interface LetterRow {
  seq: number;
  id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  class: 'letter' | 'control';
  state: 'sent' | 'delivered' | 'read' | 'failed';
  failure: 'returned' | null;
  held_at: Date;
  delivered_at: Date | null;
  read_at: Date | null;
  returned_at: Date | null;
  retracted_at: Date | null;
  sender_key_id: string;
  recipient_key_id: string;
  iv: Buffer | null;
  ciphertext: Buffer | null;
  attachment_id: string | null;
  content_digest: Buffer;
}

type MemberStatus = 'unseen' | 'request' | 'accepted' | 'deleted';

export interface MemberRow {
  conversation_id: string;
  account_id: string;
  status: MemberStatus;
  visible_from_seq: number;
  read_through_seq: number;
  muted_until: Date | null;
  muted_always: boolean;
}

export interface ConversationRow {
  id: string;
  starter_id: string;
  member_low: string;
  member_high: string;
  created_at: Date;
  updated_at: Date;
}
