import { Member, ModelView, PolicyView, SystemView, TeamView, api } from './api';
import { setOrgZone } from './format';

export interface AppState {
  member: Member | null;
  teams: TeamView[];
  models: ModelView[];
  policy: PolicyView | null;
  selectedTeamId: string;
  system: SystemView;
}

export const state: AppState = {
  member: null,
  teams: [],
  models: [],
  policy: null,
  selectedTeamId: '',
  system: { storage: 'up', billing: 'up', checked_at: new Date().toISOString() },
};

export function modelBySlug(slug: string): ModelView | undefined {
  return state.models.find((model) => model.slug === slug);
}

export function modelName(slug: string): string {
  return modelBySlug(slug)?.name ?? slug;
}

export function unitLabel(unit: string): string {
  return state.models.find((model) => model.unit === unit)?.unit_label ?? unit;
}

export function teamName(teamId: string): string {
  return state.teams.find((team) => team.id === teamId)?.name ?? teamId;
}

export function canReach(screen: string): boolean {
  const role = state.member?.role;
  if (!role) return false;
  switch (screen) {
    case 'run':
      return role === 'member';
    case 'jobs':
    case 'library':
      return true;
    case 'webhooks':
      return role === 'member' || role === 'admin';
    case 'finance':
      return role === 'finance' || role === 'admin';
    case 'admin':
      return role === 'admin' || role === 'finance';
    default:
      return false;
  }
}

export function homePath(): string {
  const role = state.member?.role;
  if (role === 'member') return '/run';
  if (role === 'finance') return '/finance';
  if (role === 'admin') return '/admin';
  return '/library';
}

export async function loadSignedIn(): Promise<void> {
  const me = await api.get<{ member: Member }>('/api/me');
  const [teams, models] = await Promise.all([
    api.get<{ teams: TeamView[] }>('/api/teams'),
    api.get<{ models: ModelView[] }>('/api/models'),
  ]);
  state.member = me.member;
  state.teams = teams.teams;
  state.models = models.models;
  state.selectedTeamId = me.member.team_id ?? teams.teams[0]?.id ?? '';
  if (me.member.role === 'admin' || me.member.role === 'finance') {
    const policy = await api.get<{ policy: PolicyView }>('/api/policy');
    state.policy = policy.policy;
    setOrgZone(0, policy.policy.timezone);
  }
  await refreshSystem();
}

export async function refreshSystem(): Promise<void> {
  state.system = await api.get<SystemView>('/api/system');
}

/** The org zone offset is read from a meter period, whose start is local midnight on the 1st. */
export function noteZoneFromPeriod(label: string, startsAt: string): void {
  const [monthName, yearText] = label.split(' ');
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const monthIndex = months.indexOf(monthName ?? '');
  if (monthIndex < 0 || yearText === undefined) return;
  const localMidnight = Date.UTC(Number.parseInt(yearText, 10), monthIndex, 1);
  setOrgZone(localMidnight - new Date(startsAt).getTime(), state.policy?.timezone ?? '');
}
