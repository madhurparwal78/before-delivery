export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kinfold_users (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_lower TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT,
  colour TEXT NOT NULL,
  initials TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kinfold_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES kinfold_users(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kinfold_workspaces (
  workspace_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kinfold_workspace_members (
  workspace_id TEXT NOT NULL REFERENCES kinfold_workspaces(workspace_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES kinfold_users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS kinfold_boards (
  board_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES kinfold_workspaces(workspace_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('workspace','private')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kinfold_board_members (
  board_id TEXT NOT NULL REFERENCES kinfold_boards(board_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES kinfold_users(user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('observer','member','admin','removed')),
  PRIMARY KEY (board_id, user_id)
);

CREATE TABLE IF NOT EXISTS kinfold_lists (
  list_id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES kinfold_boards(board_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INT NOT NULL
);
CREATE INDEX IF NOT EXISTS kinfold_lists_board_idx ON kinfold_lists (board_id, position);

CREATE TABLE IF NOT EXISTS kinfold_cards (
  card_id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES kinfold_boards(board_id) ON DELETE CASCADE,
  list_id TEXT NOT NULL REFERENCES kinfold_lists(list_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  rank INT,
  labels TEXT[] NOT NULL DEFAULT '{}',
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','archived')),
  version INT NOT NULL DEFAULT 1,
  owner_user_id TEXT REFERENCES kinfold_users(user_id) ON DELETE SET NULL,
  last_versioned_by TEXT,
  last_versioned_change TEXT NOT NULL DEFAULT 'created',
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kinfold_cards_list_idx ON kinfold_cards (list_id, rank);
CREATE INDEX IF NOT EXISTS kinfold_cards_board_idx ON kinfold_cards (board_id);

CREATE TABLE IF NOT EXISTS kinfold_checklist_items (
  item_id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES kinfold_cards(card_id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  position INT NOT NULL
);
CREATE INDEX IF NOT EXISTS kinfold_checklist_card_idx ON kinfold_checklist_items (card_id, position);

CREATE TABLE IF NOT EXISTS kinfold_card_private_members (
  card_id TEXT NOT NULL REFERENCES kinfold_cards(card_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES kinfold_users(user_id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, user_id)
);

CREATE TABLE IF NOT EXISTS kinfold_attachments (
  attachment_id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES kinfold_cards(card_id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by TEXT NOT NULL REFERENCES kinfold_users(user_id)
);
CREATE INDEX IF NOT EXISTS kinfold_attachments_card_idx ON kinfold_attachments (card_id);

CREATE TABLE IF NOT EXISTS kinfold_idempotency_keys (
  key_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  title TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kinfold_permission_log (
  entry_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES kinfold_workspaces(workspace_id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES kinfold_users(user_id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('user','board','card')),
  target_id TEXT NOT NULL,
  board_id TEXT,
  before TEXT,
  after TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kinfold_permlog_ws_idx ON kinfold_permission_log (workspace_id, at DESC);
`;

export interface SeedPerson {
  displayName: string;
  email: string;
  password: string;
  phone: string;
  colour: string;
  initials: string;
}

export const SEED_PEOPLE: SeedPerson[] = [
  { displayName: 'Ruth Hale', email: 'ruth@kinfold.test', password: 'Kinfold-ruth-2026', phone: '+1 312 555 0140', colour: 'sage', initials: 'RH' },
  { displayName: 'Sam Hale', email: 'sam@kinfold.test', password: 'Kinfold-sam-2026', phone: '+1 312 555 0141', colour: 'clay', initials: 'SH' },
  { displayName: 'Priya Hale', email: 'priya@kinfold.test', password: 'Kinfold-priya-2026', phone: '+1 312 555 0142', colour: 'plum', initials: 'PH' },
  { displayName: 'Dolores Vance', email: 'dolores@kinfold.test', password: 'Kinfold-dolores-2026', phone: '+1 312 555 0143', colour: 'ochre', initials: 'DV' },
  { displayName: 'Theo Marsh', email: 'theo@kinfold.test', password: 'Kinfold-theo-2026', phone: '+1 312 555 0144', colour: 'slate', initials: 'TM' },
  { displayName: 'Grace Ng', email: 'grace@kinfold.test', password: 'Kinfold-grace-2026', phone: '+1 206 555 0150', colour: 'rose', initials: 'GN' },
];

// ids are fixed so the seed is deterministic and idempotent
export const SEED_IDS = {
  users: {
    ruth: 'seed-user-ruth-hale-000001',
    sam: 'seed-user-sam-hale-000002',
    priya: 'seed-user-priya-hale-000003',
    dolores: 'seed-user-dolores-vance-0004',
    theo: 'seed-user-theo-marsh-000005',
    grace: 'seed-user-grace-ng-000000006',
  },
  workspaces: {
    hale: 'seed-workspace-hale-family-0001',
    ng: 'seed-workspace-ng-family-00002',
  },
  boards: {
    weekly: 'seed-board-weekly-care-00000001',
    money: 'seed-board-money-and-house-0002',
    dad: 'seed-board-dads-week-00000000003',
  },
  lists: {
    inbox: 'seed-list-weekly-inbox-000000001',
    pharmacy: 'seed-list-weekly-pharmacy-000002',
    appointments: 'seed-list-weekly-appt-0000003',
    aideVisits: 'seed-list-weekly-aide-00000004',
    waiting: 'seed-list-weekly-waiting-000005',
    bills: 'seed-list-money-bills-00000001',
    house: 'seed-list-money-house-00000002',
    documents: 'seed-list-money-documents-00003',
    todo: 'seed-list-ng-todo-0000000000001',
  },
  cards: {
    refill: 'seed-card-refill-lisinopril-000001',
    hearing: 'seed-card-hearing-batteries-0002',
    podiatry: 'seed-card-podiatry-followup-003',
    eyeDrops: 'seed-card-pickup-eye-drops-0004',
    organiser: 'seed-card-pill-organiser-000005',
    metformin: 'seed-card-metformin-mail-000006',
    cardiology: 'seed-card-cardiology-ride-00007',
    memory: 'seed-card-memory-clinic-000008',
    dental: 'seed-card-dental-cleaning-0009',
    tuesday: 'seed-card-tuesday-visit-000010',
    friday: 'seed-card-friday-visit-000011',
    medicare: 'seed-card-medicare-premium-00012',
    insurance: 'seed-card-home-insurance-00013',
    railing: 'seed-card-back-step-railing-014',
    estate: 'seed-card-estate-agent-00000015',
    scan: 'seed-card-insurance-scan-000016',
    ito: 'seed-card-ito-office-000000017',
  },
  checklist: {
    lunch: 'seed-chk-tuesday-lunch-00000001',
    eveningPills: 'seed-chk-tuesday-pills-00000002',
    walk: 'seed-chk-tuesday-walk-00000003',
    linen: 'seed-chk-friday-linen-00000001',
    groceries: 'seed-chk-friday-groceries-000002',
  },
};
