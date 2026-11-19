export interface MessageView {
  id: string;
  channel_id: string;
  client_message_id: string;
  author: { id: string; name: string; role: string };
  text: string;
  version: number;
  edited: boolean;
  sent_at: string;
  edited_at: string | null;
  editable_until: string;
  thread_root_id: string | null;
  reply_count: number;
  quote: Record<string, unknown> | null;
  attachments: Record<string, unknown>[];
  pinned: boolean;
  pinned_by: { id: string; name: string } | null;
  recipient_count: number;
  delivered_count: number;
  read_count: number;
  deleted: boolean;
}
