import { PRACTICE_THINKING, PRACTICE_TURN_DONE, shotReceipt } from '../shared/copy.js';
import { simulateShot } from '../shared/physics.js';
import { applyShot, newMatchState, requiresCalledPocket } from '../shared/referee.js';
import { FOOT_SPOT, HEAD_SPOT, predictFirstBall, rackPositions } from '../shared/table-geometry.js';
import type { MatchState, Point, Seat, ShotInput } from '../shared/types.js';
import { resolveAnnouncement, turnText } from '../shared/view.js';

export type LocalKind = 'tutorial' | 'practice' | 'free';
export type Difficulty = 'Rookie' | 'Regular' | 'Shark' | 'Free table';

const AIM_ERROR: Record<string, number> = { Rookie: 7, Regular: 3, Shark: 0.8 };

export interface LocalSnapshot {
  kind: LocalKind;
  difficulty: Difficulty;
  state: MatchState;
  announcements: string[];
  banner: string;
  step: number;
}

export class LocalGame {
  kind: LocalKind;
  difficulty: Difficulty;
  state: MatchState;
  announcements: string[] = [];
  banner = '';
  receipt = '';
  step = 1;
  thinking = false;
  private readonly onChange: () => void;
  private readonly onComplete?: () => void;
  private readonly names: Record<Seat, string>;

  constructor(options: {
    kind: LocalKind;
    difficulty: Difficulty;
    playerName: string;
    onChange: () => void;
    onComplete?: () => void;
    snapshot?: LocalSnapshot;
  }) {
    this.kind = options.kind;
    this.difficulty = options.difficulty;
    this.onChange = options.onChange;
    this.onComplete = options.onComplete;
    this.names = { 1: options.playerName, 2: options.difficulty };
    if (options.snapshot) {
      this.state = options.snapshot.state;
      this.announcements = options.snapshot.announcements;
      this.banner = options.snapshot.banner;
      this.step = options.snapshot.step;
    } else if (options.kind === 'tutorial') {
      this.state = this.tutorialState(1);
    } else {
      const positions = rackPositions('eight-ball');
      this.state = newMatchState('eight-ball', positions, Object.keys(positions).map((key) => Number(key)));
      if (options.kind === 'practice') {
        this.state.activeSeat = 2;
        window.setTimeout(() => this.runAiTurn(), 400);
      }
    }
  }

  snapshot(): LocalSnapshot {
    return {
      kind: this.kind,
      difficulty: this.difficulty,
      state: this.state,
      announcements: this.announcements,
      banner: this.banner,
      step: this.step,
    };
  }

  private tutorialState(step: number): MatchState {
    const ball = step === 2 ? 9 : 1;
    const positions: Record<number, Point> = { [ball]: { ...FOOT_SPOT }, 0: { ...HEAD_SPOT } };
    const state = newMatchState('eight-ball', positions, [ball]);
    state.groups = { 1: 'solids', 2: 'stripes' };
    state.phase = 'groups';
    return state;
  }

  get myTurn(): boolean {
    if (this.kind !== 'practice') return true;
    return this.state.activeSeat === 1 && !this.thinking;
  }

  get turn(): string {
    if (this.kind !== 'practice') return 'Your turn';
    return turnText(this.state, { seat: 1, names: this.names });
  }

  get calledPocketRequired(): boolean {
    if (this.kind === 'tutorial') return false;
    return requiresCalledPocket(this.state, this.state.activeSeat);
  }

  shoot(shot: ShotInput): void {
    if (!this.myTurn || this.state.over) return;
    this.playShot(1, shot);
    if (this.kind === 'practice' && this.state.activeSeat === 2 && !this.state.over) {
      window.setTimeout(() => this.runAiTurn(), 400);
    }
  }

  place(across: number, along: number): void {
    this.state.positions[0] = { across, along };
    this.state.ballInHand = false;
    this.state.behindHeadString = false;
    this.onChange();
  }

  private playShot(seat: Seat, shot: ShotInput): void {
    const cueBall = this.state.positions[0] ?? { ...HEAD_SPOT };
    const prediction = predictFirstBall(cueBall, shot.aimDegrees, this.state.positions, this.state.balls);
    const simulated = simulateShot(cueBall, this.state.balls, this.state.positions, shot);
    this.receipt = shotReceipt(simulated.outcome.firstContact, prediction.cutAngle);

    if (this.kind === 'tutorial') {
      if (this.step < 3) {
        this.step += 1;
        this.state = this.tutorialState(this.step);
      } else {
        this.state.positions = { ...simulated.positions, 0: simulated.cueBall };
        this.state.balls = this.state.balls.filter((ball) => simulated.positions[ball] !== undefined);
        this.onComplete?.();
      }
      this.onChange();
      return;
    }

    const ruling = applyShot({
      state: this.state,
      seat,
      outcome: simulated.outcome,
      calledPocket: shot.calledPocket,
      names: this.names,
      positions: { ...simulated.positions, 0: simulated.cueBall },
    });
    this.state = ruling.state;
    if (this.kind === 'free') {
      this.state.activeSeat = 1;
      this.banner = '';
    } else {
      this.banner = ruling.banner ? resolveAnnouncement(ruling.banner, { seat: 1, names: this.names }) : '';
    }
    for (const announcement of ruling.announcements) {
      if (this.kind === 'free' && announcement.type !== 'plain') continue;
      this.announcements.push(resolveAnnouncement(announcement, { seat: 1, names: this.names }));
    }
    this.onChange();
  }

  addLine(line: string): void {
    this.announcements.push(line);
    this.onChange();
  }

  private runAiTurn(): void {
    if (this.kind !== 'practice' || this.state.over) return;
    let shots = 0;
    const takeShot = (): void => {
      if (this.state.activeSeat !== 2 || this.state.over || shots >= 3) {
        this.thinking = false;
        if (!this.state.over) {
          this.state.activeSeat = 1;
          this.announcements.push(PRACTICE_TURN_DONE(this.difficulty));
        }
        this.onChange();
        return;
      }
      shots += 1;
      this.thinking = true;
      this.announcements.push(PRACTICE_THINKING(this.difficulty));
      this.onChange();
      window.setTimeout(() => {
        this.thinking = false;
        if (this.state.ballInHand) {
          this.state.positions[0] = { ...HEAD_SPOT };
          this.state.ballInHand = false;
          this.state.behindHeadString = false;
        }
        this.playShot(2, this.aiShot());
        window.setTimeout(takeShot, 300);
      }, 1200);
    };
    takeShot();
  }

  private aiShot(): ShotInput {
    const cue = this.state.positions[0] ?? { ...HEAD_SPOT };
    if (this.state.phase === 'break') {
      const apex = this.state.positions[1] ?? { ...FOOT_SPOT };
      const breakAim = (Math.atan2(apex.across - cue.across, (apex.along - cue.along) * 2) * 180) / Math.PI;
      return {
        aimDegrees: Math.round((((breakAim + (Math.random() - 0.5)) % 360) + 360) % 360 * 10) / 10,
        power: 90,
        sideSpin: 0,
        topSpin: 0,
        calledPocket: null,
      };
    }
    const group = this.state.groups[2];
    const targets = this.state.balls.filter((ball) => {
      if (this.state.phase !== 'groups' || !group) return ball !== 8 || this.state.balls.length === 1;
      if (group === 'solids') return ball <= 7;
      return ball >= 9;
    });
    const pool = targets.length > 0 ? targets : this.state.balls;
    const target = pool[Math.floor(Math.random() * pool.length)] ?? 8;
    const point = this.state.positions[target] ?? { ...FOOT_SPOT };
    const dx = point.across - cue.across;
    const dy = (point.along - cue.along) * 2;
    const base = (Math.atan2(dx, dy) * 180) / Math.PI;
    const error = (AIM_ERROR[this.difficulty] ?? 3) * (Math.random() * 2 - 1);
    const aim = ((base + error) % 360 + 360) % 360;
    const needsPocket = requiresCalledPocket(this.state, 2);
    return {
      aimDegrees: Math.round(aim * 10) / 10,
      power: 55 + Math.round(Math.random() * 25),
      sideSpin: 0,
      topSpin: 0,
      calledPocket: needsPocket ? 'top-left' : null,
    };
  }
}
