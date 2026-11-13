export type Role = 'owner' | 'moderator' | 'contributor' | 'viewer';
export type Layout = 'columns' | 'rows';
export type Sort = 'by_hand' | 'newest' | 'oldest' | 'most_liked';
export type Group = 'section' | 'author';
export type Privacy = 'private' | 'password' | 'public';
export type LinkAccess = 'off' | 'view' | 'contribute';
export type PostState = 'published' | 'awaiting_approval' | 'rejected';

export interface AuthorRef {
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

export interface PostDTO {
  id: string;
  board_id: string;
  section_id: string;
  position: number | null;
  title: string;
  body: string;
  author: AuthorRef;
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

export interface SectionDTO {
  id: string;
  title: string;
  count: number;
  posts: PostDTO[];
}

export interface BoardDTO {
  id: string;
  title: string;
  layout: Layout;
  sort: Sort;
  group: Group;
  privacy: Privacy;
  approval: boolean;
  link_access: LinkAccess;
  role: Role | null;
  sections: { id: string; title: string; count: number }[];
  share_path: string | null;
  embed_path: string | null;
}

export interface PostsDTO {
  sections: SectionDTO[];
  held: PostDTO[];
}

export interface UserDTO {
  id: string;
  display_name: string;
  email: string;
}
