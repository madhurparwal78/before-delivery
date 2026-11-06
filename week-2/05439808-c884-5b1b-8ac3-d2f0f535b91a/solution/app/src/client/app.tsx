// Routing and the signed-in shell: top rule, Queues rail, the island stage, context panels, dialogs.
import { useLayoutEffect } from 'preact/hooks';
import { ClanPanel, DonateDialog } from './clan';
import { QueuesRail, TopRule } from './chrome';
import { SIGNED_OUT } from './copy';
import { GhostBar, IslandView } from './island';
import { OpsScreen } from './ops';
import { LeaguePanel, ProfilePanel, RaidLogPanel, RewardsPanel } from './panels';
import { Forgot, Reset, SignIn, SignUp, Verify } from './public';
import { RaidScreen, ScoutScreen } from './raid';
import { ReplayScreen } from './replay';
import type { ViewMode } from './scene/types';
import { navigate, notify, openPanel, query, signedOutHere, type Panel } from './store';
import { LiveRegions, OutageBanner, useStore } from './ui';
import { BuildDialog, BuildingDetails, Dock, TrainPanel, VillageStage } from './village';

type Route =
  | { kind: 'signin' | 'signup' | 'forgot' | 'reset' | 'verify' }
  | { kind: 'village' | 'ops' | 'unknown' }
  | { kind: 'scout'; id: string | null }
  | { kind: 'raid' | 'replay'; id: string };

function route(path: string): Route {
  const publicScreens = { '/signin': 'signin', '/signup': 'signup', '/forgot': 'forgot', '/reset': 'reset', '/verify': 'verify' } as const;
  if (path in publicScreens) return { kind: publicScreens[path as keyof typeof publicScreens] };
  if (path === '/') return { kind: 'village' };
  if (path === '/ops') return { kind: 'ops' };
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'scout' && parts.length <= 2) return { kind: 'scout', id: parts[1] ?? null };
  if (parts[0] === 'raids' && parts.length === 2) return { kind: 'raid', id: parts[1] as string };
  if (parts[0] === 'raids' && parts.length === 3 && parts[2] === 'replay') return { kind: 'replay', id: parts[1] as string };
  return { kind: 'unknown' };
}

const PUBLIC = new Set(['signin', 'signup', 'forgot', 'reset', 'verify']);
const STAGES: Record<string, ViewMode> = { village: 'village', scout: 'scout', raid: 'raid', replay: 'replay' };
const PANEL_KINDS: Panel['kind'][] = ['raid-log', 'clan', 'league', 'rewards', 'profile'];

export function App() {
  const s = useStore();
  const r = route(s.path);
  const isPublic = PUBLIC.has(r.kind);
  useLayoutEffect(() => {
    if (!s.booted) return;
    if (!isPublic && !s.me) {
      navigate('/signin', true);
      if (signedOutHere()) notify(SIGNED_OUT);
    } else if (s.me && (r.kind === 'signin' || r.kind === 'signup' || r.kind === 'forgot')) {
      navigate(s.me.role === 'operator' ? '/ops' : '/', true);
    } else if (s.me && (r.kind === 'unknown' || (r.kind === 'ops' && s.me.role !== 'operator'))) {
      navigate('/', true);
    }
  }, [s.booted, s.me === null, s.path]);
  if (!s.booted || (!isPublic && !s.me)) {
    return (
      <div class="public">
        <OutageBanner />
        <LiveRegions />
      </div>
    );
  }
  if (isPublic) {
    return (
      <div class="public">
        <OutageBanner />
        {r.kind === 'signin' && <SignIn />}
        {r.kind === 'signup' && <SignUp />}
        {r.kind === 'forgot' && <Forgot />}
        {r.kind === 'reset' && <Reset />}
        {r.kind === 'verify' && <Verify />}
        <LiveRegions />
      </div>
    );
  }
  return <Shell r={r} />;
}

function PanelHost({ village }: { village: boolean }) {
  const s = useStore();
  const p = s.panel;
  if (!p) return null;
  switch (p.kind) {
    case 'details':
      return village ? <BuildingDetails key={`details-${p.id}`} id={p.id} focus={p.focus} /> : null;
    case 'train':
      return village ? <TrainPanel key="train" /> : null;
    case 'raid-log':
      return <RaidLogPanel key="raid-log" />;
    case 'clan':
      return <ClanPanel key="clan" />;
    case 'league':
      return <LeaguePanel key="league" />;
    case 'rewards':
      return <RewardsPanel key="rewards" />;
    case 'profile':
      return <ProfilePanel key="profile" />;
    default:
      return null;
  }
}

function Shell({ r }: { r: Route }) {
  const s = useStore();
  const islander = s.me?.role === 'islander';
  const mode = STAGES[r.kind];
  useLayoutEffect(() => {
    document.body.classList.toggle('stage', mode !== undefined);
    return () => document.body.classList.remove('stage');
  }, [mode]);
  useLayoutEffect(() => {
    const kind = s.panel?.kind;
    if (kind === 'details' || kind === 'train' || kind === 'scout' || kind === 'raid-result') openPanel(null);
  }, [r.kind]);
  useLayoutEffect(() => {
    const wanted = query('panel') as Panel['kind'] | null;
    if (wanted && PANEL_KINDS.includes(wanted)) openPanel({ kind: wanted } as Panel);
  }, []);
  return (
    <div class={s.panel ? 'shell panel-open' : 'shell'}>
      <TopRule />
      <OutageBanner />
      {islander && <QueuesRail />}
      {islander && r.kind === 'village' && <Dock />}
      {mode && <IslandView mode={mode} />}
      {r.kind === 'village' && !islander && (
        <div class="empty-stage">
          <p>The studio account has no island. Operations holds the service status, raid re-runs and the ledger check.</p>
        </div>
      )}
      {r.kind === 'ops' && <OpsScreen />}
      <PanelHost village={r.kind === 'village' && islander} />
      {r.kind === 'village' && islander && <VillageStage />}
      {r.kind === 'scout' && <ScoutScreen villageId={r.id} />}
      {r.kind === 'raid' && <RaidScreen raidId={r.id} />}
      {r.kind === 'replay' && <ReplayScreen raidId={r.id} />}
      {r.kind === 'village' && islander && <GhostBar />}
      {s.dialog?.kind === 'build' && r.kind === 'village' && <BuildDialog />}
      {s.dialog?.kind === 'donate' && <DonateDialog request={s.dialog.request} opener={s.dialog.opener} />}
      <LiveRegions />
    </div>
  );
}
