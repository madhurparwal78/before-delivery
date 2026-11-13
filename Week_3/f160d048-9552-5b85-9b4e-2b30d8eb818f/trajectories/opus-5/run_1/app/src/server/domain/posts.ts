import {
  roleFamilyName,
  type Outcome,
  type PostKind,
  type PostState,
  type RoleFamilyId,
  type CityId,
} from '../../shared/reference';
import { db, type Db } from '../db/pool';

export interface PostRow {
  id: string;
  kind: PostKind;
  company_id: string;
  company_name: string;
  company_slug: string;
  author_id: string | null;
  state: PostState;
  created_at: Date;
  deleted_at: Date | null;
  claimed_by: string | null;
  claimed_at: Date | null;
  lease_started_at: Date | null;
  last_lapsed_by: string | null;
  decided_by: string | null;
  reason: string | null;
  overall: number | null;
  work_life: number | null;
  pay: number | null;
  management: number | null;
  title: string | null;
  pros: string | null;
  cons: string | null;
  role_family: RoleFamilyId | null;
  city: CityId | null;
  annual_pay: number | null;
  years_experience: number | null;
  difficulty: number | null;
  outcome: Outcome | null;
  body_text: string | null;
}

const POST_COLUMNS = `p.id, p.kind, p.company_id, c.name AS company_name, c.slug AS company_slug, p.author_id, p.state,
  p.created_at, p.deleted_at, p.claimed_by, p.claimed_at, p.lease_started_at, p.last_lapsed_by, p.decided_by, p.reason,
  p.overall, p.work_life, p.pay, p.management, p.title, p.pros, p.cons, p.role_family, p.city, p.annual_pay,
  p.years_experience, p.difficulty, p.outcome, p.body_text`;

export async function findPost(id: string, runner: Db = db): Promise<PostRow | null> {
  return runner.one<PostRow>(
    `SELECT ${POST_COLUMNS} FROM posts p JOIN companies c ON c.id = p.company_id WHERE p.id = $1`,
    [id],
  );
}

export function postLabel(post: Pick<PostRow, 'kind' | 'title' | 'role_family' | 'company_name'>): string {
  if (post.kind === 'review') return post.title ?? '';
  const role = roleFamilyName(post.role_family ?? '');
  const prefix = post.kind === 'pay_report' ? 'Pay report' : 'Interview note';
  return `${prefix}: ${role} at ${post.company_name}`;
}

/** The content fields the queue shows for each kind. */
export function postContent(post: PostRow): Record<string, unknown> {
  if (post.kind === 'review') {
    return {
      title: post.title,
      overall: post.overall,
      work_life: post.work_life,
      pay: post.pay,
      management: post.management,
      pros: post.pros,
      cons: post.cons,
    };
  }
  if (post.kind === 'pay_report') {
    return {
      role_family: post.role_family,
      role_name: roleFamilyName(post.role_family ?? ''),
      city: post.city,
      annual_pay: post.annual_pay,
      years_experience: post.years_experience,
    };
  }
  return {
    role_family: post.role_family,
    role_name: roleFamilyName(post.role_family ?? ''),
    difficulty: post.difficulty,
    outcome: post.outcome,
    text: post.body_text,
  };
}
