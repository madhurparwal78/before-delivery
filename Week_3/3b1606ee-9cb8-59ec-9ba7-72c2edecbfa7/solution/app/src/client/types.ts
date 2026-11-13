import type { DeliveryState, Iso } from '../shared/types';

export interface Attachment {
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
  | { v: 1; kind: 'image'; text: string; attachment: Attachment }
  | { v: 1; kind: 'file'; text: ''; attachment: Attachment };

export interface ProfileKeyBody {
  v: 1;
  kind: 'profile';
  profile_key: string;
}

export interface ProfileBody {
  v: 1;
  display_name: string;
  photo: null | { blob_id: string; key: string; iv: string; digest: string; type: string };
}

/**
 * Where a letter is in its life in this browser. Sending letters are `queued` or `uploading`; the rest follow the
 * brief's postmarks. `upload_failed` and `refused` are letters the exchange never holds.
 */
type Phase = 'queued' | 'uploading' | 'posted' | 'upload_failed' | 'refused' | 'received';

/** What a person chose to send, kept until the attachment is sealed into the letter body. */
interface Draft {
  kind: 'text' | 'image' | 'file';
  text: string;
  name?: string;
  type?: string;
  size?: number;
  width?: number;
  height?: number;
  thumb?: string;
}

interface SealedPost {
  iv: string;
  ciphertext: string;
  recipientKeyId: string;
}

export interface LocalLetter {
  id: string;
  conversationId: string;
  direction: 'sent' | 'received';
  letterClass: 'letter' | 'control';
  /** The opened body; null for a letter not yet sealed with its attachment and for a retracted letter. */
  body: LetterBody | null;
  draft: Draft | null;
  /** A control letter carries only the profile key it sends. */
  profileKey: string | null;
  writtenAt: number;
  phase: Phase;
  sealed: SealedPost | null;
  blobId: string | null;
  seq: number | null;
  state: DeliveryState | null;
  failure: 'returned' | null;
  heldAt: Iso | null;
  deliveredAt: Iso | null;
  readAt: Iso | null;
  returnedAt: Iso | null;
  retractedAt: Iso | null;
  canRetract: boolean;
}

export interface PeerProfile {
  displayName: string;
  photo: ProfileBody['photo'];
}
