import type {
  AppConfig,
  Comment,
  ExportRecord,
  PresencePerson,
  Project,
  ProjectListEntry,
  Role,
  SessionUser,
  WorkloadResponse,
  WorkspaceRef,
} from '../shared/types.js';

export type ViewName = 'gantt' | 'list' | 'workload';

export interface AppState {
  config: AppConfig;
  me: SessionUser | null;
  workspaces: WorkspaceRef[];
  projects: ProjectListEntry[];
  project: Project | null;
  previousProject: Project | null;
  workspaceId: string;
  role: Role;
  presence: PresencePerson[];
  exports: ExportRecord[];
  comments: Map<string, Comment[]>;
  /** Bars the last accepted edit moved. */
  shifted: Set<string>;
  /** Items with an edit in flight. */
  busy: Set<string>;
  /** The snapped place a bar shows while its edit waits for the server. */
  preview: Map<string, { start: string; end: string; duration: number }>;
  pageAlert: string | null;
  view: ViewName;
  showBaseline: boolean;
  highlightCritical: boolean;
  workloadFrom: string;
  workload: WorkloadResponse | null;
  focusedBarId: string | null;
  /** The active Task list cell. A null item is the `Add task` row, so the cell follows its item. */
  activeCell: { itemId: string | null; column: number };
  /** The open Task list cell editor, kept in state so a redraw cannot close it. */
  editing: { itemId: string | null; column: number; value: string; invalid: boolean } | null;
  activeWorkloadCell: { person: number; day: number };
  notFound: boolean;
}

export const state: AppState = {
  config: {
    today: '2000-01-03',
    timeZone: 'UTC',
    assignNoticeDelaySeconds: 60,
    presenceTimeoutSeconds: 15,
    knockOnMs: 220,
    knockOnStaggerMs: 45,
    finishMotionMs: 320,
  },
  me: null,
  workspaces: [],
  projects: [],
  project: null,
  previousProject: null,
  workspaceId: '',
  role: 'viewer',
  presence: [],
  exports: [],
  comments: new Map(),
  shifted: new Set(),
  busy: new Set(),
  preview: new Map(),
  pageAlert: null,
  view: 'gantt',
  showBaseline: false,
  highlightCritical: false,
  workloadFrom: '2000-01-03',
  workload: null,
  focusedBarId: null,
  activeCell: { itemId: null, column: 2 },
  editing: null,
  activeWorkloadCell: { person: 0, day: 0 },
  notFound: false,
};

export function canEdit(): boolean {
  return state.role === 'owner' || state.role === 'editor';
}

export function itemById(id: string): Project['items'][number] | undefined {
  return state.project?.items.find((item) => item.id === id);
}
