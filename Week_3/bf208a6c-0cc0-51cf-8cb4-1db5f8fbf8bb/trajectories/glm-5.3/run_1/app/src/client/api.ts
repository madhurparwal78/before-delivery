export interface SessionUser {
  id: string;
  display_name: string;
  email: string;
}

export interface Author {
  id: string;
  display_name: string;
}

export interface Attachment {
  id: string;
  file_name: string;
  content_type: string;
  size: number;
  url: string;
}

export interface Post {
  id: string;
  board_id: string;
  section_id: string;
  position: number | null;
  title: string;
  body: string;
  author: Author;
  state: 'published' | 'awaiting_approval';
  likes: number;
  score: number;
  comments: number;
  liked: boolean;
  my_vote: number;
  attachment: Attachment | null;
  version: number;
  created_at: string;
  push: 'sent' | 'pending' | null;
}

export interface Section {
  id: string;
  title: string;
  count: number;
  posts: Post[];
}

export interface Board {
  id: string;
  title: string;
  layout: 'columns' | 'rows';
  sort: 'by_hand' | 'newest' | 'oldest' | 'most_liked';
  group: 'section' | 'author';
  privacy: 'private' | 'password' | 'public';
  approval: boolean;
  link_access: 'off' | 'view' | 'contribute';
  role: 'owner' | 'moderator' | 'contributor' | 'viewer' | null;
  sections: { id: string; title: string; count: number }[];
  share_path: string | null;
  embed_path: string | null;
}

export interface PostsListing {
  sections: Section[];
  held: Post[];
}

export interface CommentItem {
  id: string;
  author: Author;
  text: string;
  created_at: string;
}

export type Role = 'owner' | 'moderator' | 'contributor' | 'viewer';

export const ROLE_ORDER: Role[] = ['viewer', 'contributor', 'moderator', 'owner'];

export function roleAtLeast(role: Role | null, floor: Role): boolean {
  if (!role) return false;
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(floor);
}

export const SORT_LABELS: Record<Board['sort'], string> = {
  by_hand: 'By hand',
  newest: 'Newest first',
  oldest: 'Oldest first',
  most_liked: 'Most liked',
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T & { error?: string; errors?: Record<string, string> }) : (undefined as T);
  if (!res.ok) {
    const err = new Error(res.statusText) as Error & { status: number; body: unknown };
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data as T;
}
