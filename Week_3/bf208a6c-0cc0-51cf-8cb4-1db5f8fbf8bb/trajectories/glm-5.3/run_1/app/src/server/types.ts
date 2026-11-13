import type { ServerResponse, IncomingMessage } from 'node:http';
import type { Role, PostState, Layout, Sort, Group, Privacy, LinkAccess } from '../shared/types.js';

export interface AuthedRequest {
  method: string;
  url: string;
  pathname: string;
  query: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  raw: IncomingMessage;
  res: ServerResponse;
  cookies: Record<string, string>;
  userId: string | null;
  sessionUser: SessionUser | null;
  setSessionCookie: (value: string | null) => void;
  clearPassCookie?: () => void;
  addPassUnlock?: (boardId: string, generation: number) => void;
  body: unknown;
  params: Record<string, string>;
  rawBody?: Buffer;
  multipart?: MultipartResult | null;
}

export interface SessionUser {
  id: string;
  display_name: string;
  email: string;
}

export interface MultipartFile {
  fieldName: string;
  fileName: string;
  contentType: string;
  data: Buffer;
}

export interface MultipartResult {
  fields: Record<string, string>;
  file: MultipartFile | null;
}

export interface BoardAccess {
  board: BoardRow;
  role: Role | null;
}

export interface BoardRow {
  id: string;
  title: string;
  layout: Layout;
  sort: Sort;
  group: Group;
  privacy: Privacy;
  approval: boolean;
  link_access: LinkAccess;
  link_token: string | null;
  pass_hash: string | null;
  pass_gen: number;
  owner_id: string;
  deleted: boolean;
}

export interface SectionRow {
  id: string;
  title: string;
  position: number;
}

export interface PostRow {
  id: string;
  board_id: string;
  section_id: string;
  position: number | null;
  title: string;
  body: string;
  author_id: string;
  state: PostState;
  version: number;
  created_at: Date;
  last_moved_by: string | null;
  push_state: 'sent' | 'pending' | null;
  held_notified: boolean;
  attachment_id: string | null;
}

export interface AttachmentRow {
  id: string;
  post_id: string;
  board_id: string;
  file_name: string;
  content_type: string;
  size: number;
  stored: boolean;
}

export interface RouteContext {
  req: AuthedRequest;
  match: Record<string, string>;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;
