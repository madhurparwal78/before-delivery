import type { Command, Definition, Metrics, Ticket } from '../shared/types.js';
import { WorkingSurface } from './layout.js';
import { clear, h } from './dom.js';
import { dialogs } from './dialogs.js';
import { feedback } from './feedback.js';

export type ViewName =
  | 'Account'
  | 'Tutorial'
  | 'Campaign'
  | 'Loadout'
  | 'Defence'
  | 'Result'
  | 'Editor'
  | 'Community'
  | 'Leaderboard'
  | 'Replay'
  | 'Rules';

export interface Account {
  id: string;
  email: string;
  playerName: string;
}

export interface Progress {
  completed: string[];
  unlocked: string[];
}

export interface Encounter {
  id: string;
  title: string;
  definition: Definition;
  digest: string;
  unlocked: boolean;
  completed: boolean;
}

export interface ProofView {
  runId: string;
  revision: number;
  state: string;
}

export interface LevelView {
  id: string;
  revision: number;
  state: string;
  definition: Definition;
  digest: string;
  proofRunId: string | null;
  challengeDigest: string | null;
  proofs: ProofView[];
  indexing: 'pending' | 'current';
}

export interface ChallengeView {
  digest: string;
  ruleset: string;
  title: string;
  description: string;
  difficulty: string;
  creatorName: string;
  definition: Definition;
  proofRunId: string;
  completions: number;
}

export interface BoardRowView {
  rank: number;
  accountId: string;
  playerName: string;
  runId: string;
  breaches: number;
  completionTick: number;
  remainingCharge: number;
}

export interface BoardView {
  digest: string;
  ruleset: string;
  rows: BoardRowView[];
  personalBest: BoardRowView | null;
  completions: number;
  crewUsage: { device: string; deployments: number; tenthsPercent: number }[];
}

export interface ResultView {
  runId: string;
  state: string;
  evidenceDigest: string | null;
  metrics: Metrics | null;
  failure: { tick: number; seq: number | null; reason: string } | null;
}

export interface SeasonView {
  instant: string;
  localTime: string;
  seasonDay: string;
  dailyDigest: string | null;
  standings: BoardView | null;
  streak: number | null;
}

export interface ClientState {
  account: Account | null;
  view: ViewName;
  campaign: { encounters: Encounter[]; progress: Progress } | null;
  progress: Progress | null;
  selectedEncounter: string | null;
  loadout: string[];
  ticket: Ticket | null;
  runDefinition: Definition | null;
  localMetrics: Metrics | null;
  localCommands: Command[];
  localEndTick: number | null;
  result: ResultView | null;
  resultRunId: string | null;
  levels: LevelView[];
  editorLevelId: string | null;
  editorDraft: Definition | null;
  editorSaved: LevelView | null;
  searchText: string;
  filterDifficulty: string;
  filterRuleset: string;
  challenges: ChallengeView[];
  indexing: 'pending' | 'current';
  selectedChallenge: ChallengeView | null;
  board: BoardView | null;
  boardDigest: string | null;
  replayRunId: string | null;
  season: SeasonView | null;
  seasonInstant: string;
  stale: boolean;
  tutorialStep: string;
  tutorialComplete: boolean;
}

export const NAVIGATION: ViewName[] = ['Account', 'Tutorial', 'Campaign', 'Editor', 'Community', 'Rules'];

export class Shell {
  readonly state: ClientState = {
    account: null,
    view: 'Account',
    campaign: null,
    progress: null,
    selectedEncounter: null,
    loadout: [],
    ticket: null,
    runDefinition: null,
    localMetrics: null,
    localCommands: [],
    localEndTick: null,
    result: null,
    resultRunId: null,
    levels: [],
    editorLevelId: null,
    editorDraft: null,
    editorSaved: null,
    searchText: '',
    filterDifficulty: '',
    filterRuleset: '',
    challenges: [],
    indexing: 'current',
    selectedChallenge: null,
    board: null,
    boardDigest: null,
    replayRunId: null,
    season: null,
    seasonInstant: '',
    stale: false,
    tutorialStep: '',
    tutorialComplete: false,
  };

  readonly main: HTMLElement;
  readonly surface: WorkingSurface;
  private readonly navigation: HTMLElement;
  private readonly identity: HTMLElement;
  private renderers = new Map<ViewName, (shell: Shell) => void>();
  private entries = new Map<ViewName, (shell: Shell) => Promise<void>>();

  constructor(root: HTMLElement) {
    this.surface = new WorkingSurface();
    this.main = h('main', { class: 'main' });
    this.navigation = h('nav', { role: 'navigation', 'aria-label': 'Harbour navigation', class: 'navigation' });
    this.identity = h('section', { role: 'region', 'aria-label': 'Current player', class: 'identity' });
    root.append(
      h('header', { class: 'masthead' }, [h('h1', { class: 'product' }, ['Squallglass']), this.navigation]),
      this.identity,
      h('div', { class: 'live-regions' }, [feedback.status, feedback.error]),
      this.main,
    );
    dialogs.mount(root);
    for (const name of NAVIGATION) {
      this.navigation.append(
        h('button', { type: 'button', class: 'nav-button', onclick: () => this.navigate(name) }, [name]),
      );
    }
  }

  registerView(
    name: ViewName,
    renderer: (shell: Shell) => void,
    enter?: (shell: Shell) => Promise<void>,
  ): void {
    this.renderers.set(name, renderer);
    if (enter !== undefined) this.entries.set(name, enter);
  }

  navigate(view: ViewName): void {
    this.state.view = view;
    this.render();
    const enter = this.entries.get(view);
    if (enter !== undefined) void enter(this).then(() => this.render());
  }

  render(): void {
    clear(this.identity);
    this.identity.append(
      h('p', {}, [
        this.state.account === null
          ? 'Signed out'
          : `Signed in as ${this.state.account.playerName} (${this.state.account.email})`,
      ]),
    );
    for (const element of this.navigation.querySelectorAll('.nav-button')) {
      element.setAttribute('aria-current', element.textContent === this.state.view ? 'page' : 'false');
    }
    clear(this.main);
    const renderer = this.renderers.get(this.state.view);
    renderer?.(this);
  }
}
