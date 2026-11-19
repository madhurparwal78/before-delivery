export type Config = {
  post_max_chars: number;
  see_more_chars: number;
  typing_timeout_ms: number;
  max_skills: number;
  photo_max_bytes: number;
  resume_max_bytes: number;
  feed_page_size: number;
  time_zone: string;
  now: string;
};

export type Member = { id: string; handle: string; name: string };

export type SkillRow = {
  name: string; endorsements: number; endorsed_by_me: boolean;
  featured_position: number | null; endorser_line: string | null;
};

export type ExperienceEntry = { title: string; company: string; start: string; end: string | null };
export type EducationEntry = { school: string; degree: string; start: string; end: string | null };

export type Profile = {
  id: string; handle: string; name: string; headline?: string; location?: string;
  photo_url: string | null; visibility: string; degree: string;
  connection_state?: string; following?: boolean;
  mutual?: { count: number; named?: { id: string; name: string; handle: string } };
  email?: string; versions?: Record<string, number>;
  about?: string; experience?: ExperienceEntry[]; education?: EducationEntry[];
  skills?: SkillRow[];
};

export type PersonCard = {
  id: string; handle: string; name: string; headline: string; photo_url: string | null;
  degree: string; connection_state: string; mutual_count: number;
  requested_at?: string; connected_at?: string;
};

export type ReactionSummary = { count: number; mine: string | null; top_types: string[]; text: string };

export type Post = {
  id: string;
  author: { id: string; handle: string; name: string; headline: string; degree: string };
  text: string;
  mentions: { handle: string; member_id: string; name: string }[];
  hashtags: string[];
  created_at: string; edited_at: string | null; editable: boolean;
  photo_url: string | null;
  reactions: ReactionSummary;
  comment_count: number; repost_count: number; reposted_by_me: boolean;
  shared: Post | { unavailable: true } | null;
};

export type Comment = {
  id: string; post_id: string; parent_id: string | null;
  author: { id: string; handle: string; name: string; headline: string } | null;
  text: string; mentions: { handle: string; member_id: string; name: string }[]; hashtags: string[];
  created_at: string; deleted: boolean;
  replies: Comment[];
};

export type FeedEntry = {
  entry_id: string; kind: 'post' | 'repost'; created_at: string;
  post: Post; reposter: { id: string; name: string; handle: string } | null;
};

export type Conversation = {
  id: string; other: { id: string; name: string; handle: string; photo_url: string | null };
  last_message: { text: string; sent_at: string; sender_id: string } | null;
  unread_count: number;
};

export type Message = {
  id: string; sender_id: string; text: string; sent_at: string; read_at: string | null;
};

export type NotificationItem = {
  id: string; kind: string; count: number; actors: { id: string; name: string }[];
  text: string; target_url: string; created_at: string; updated_at: string; unread: boolean;
};

export type Question = {
  id: string; type: 'short_answer' | 'yes_no' | 'single_choice' | 'number';
  text: string; required: boolean;
  knock_out?: boolean; ideal?: string | null; options?: string[] | null;
  accepted?: string[] | null; minimum?: number | null; maximum?: number | null;
};

export type JobCard = {
  id: string; title: string;
  company: { id: string; name: string; handle: string };
  location: string; workplace: string;
  posted_at: string; closes_at: string;
  open: boolean; saved: boolean; applied: boolean;
  my_application?: { id: string; state: string; status_text: string } | null;
};

export type JobDetail = JobCard & {
  description: string;
  poster_id: string;
  stages: { state: string; label: string; status_text: string; moved_by: string }[];
  questions: Question[];
};

export type Application = {
  id: string;
  job: { id: string; title: string; company: { id: string; name: string } };
  state: string; status_text: string;
  history: { state: string; status_text: string; at: string; by: string; reason: string | null }[];
  applicant?: PersonCard;
  resume_url?: string | null;
};

export type BoardCard = {
  id: string; applicant: { id: string; name: string; handle: string; headline: string };
  state: string; entered_at: string;
};

export type JobEditor = {
  fields: {
    title: { value: string; version: number };
    location: { value: string; version: number };
    workplace: { value: string; version: number };
    closes_at: { value: string; version: number };
    description: { value: string; version: number };
    questions: { value: Question[]; version: number };
  };
  editing: { id: string; name: string }[];
};

export type CompanyPage = {
  id: string; handle: string; name: string; location: string; about: string;
  follower_count: number; following: boolean; is_admin: boolean;
  open_jobs: JobCard[];
};

export type Company = {
  id: string; name: string; handle: string;
};
