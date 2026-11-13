import {
  CLEF_MIDDLE_PITCH,
  capitalise,
  durationWord,
  formatBeat,
  formatPitch,
  moveOctave,
  moveSemitone,
  nearestOctave,
  nextSpelling,
} from '../shared/music.js';
import type {
  DurationName,
  DynamicMark,
  ElementId,
  Operation,
  Pitch,
  SetField,
  Voice,
  VoiceEvent,
} from '../shared/types.js';
import type { Regions } from './regions.js';
import type { ScoreState } from './score-state.js';

const DURATION_KEYS: Record<string, DurationName> = {
  '7': 'whole',
  '6': 'half',
  '5': 'quarter',
  '4': 'eighth',
  '3': '16th',
  '2': '32nd',
};

const DYNAMIC_CYCLE: (DynamicMark | null)[] = [null, 'pp', 'p', 'mp', 'mf', 'f', 'ff'];
const PITCH_KEYS = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g']);

export interface EditorChange {
  kind: 'caret' | 'entry' | 'music' | 'text';
}

/** The caret, the chosen duration and every keyboard edit in the score editor. */
export class Editor {
  entryStaffId: string;
  voice: Voice = 1;
  caret = 0;
  duration: DurationName = 'quarter';
  dotted = false;
  onChange: ((change: EditorChange) => void) | null = null;
  onTextRequest: ((event: VoiceEvent) => void) | null = null;
  onPlayToggle: (() => void) | null = null;

  constructor(
    private readonly state: ScoreState,
    private readonly regions: Regions,
  ) {
    const own = state.head.staves.find((staff) => state.canEdit(staff.id));
    this.entryStaffId = (own ?? state.head.staves[0]!).id;
    this.caret = this.events().length;
  }

  events(): VoiceEvent[] {
    return this.state.events(this.entryStaffId, this.voice);
  }

  currentEvent(): VoiceEvent | null {
    return this.events()[this.caret - 1] ?? null;
  }

  caretPosition(): { measure: number; beat: number } {
    const events = this.events();
    let ticks = 0;
    for (let index = 0; index < this.caret && index < events.length; index += 1) {
      ticks += events[index]!.ticks;
    }
    return this.state.meter.position(ticks);
  }

  setCaretToEvent(id: ElementId): void {
    const events = this.events();
    const index = events.findIndex(
      (event) => event.id.lamport === id.lamport && event.id.site === id.site,
    );
    if (index !== -1) this.caret = index + 1;
    this.announceCaret();
  }

  setEntryStaff(staffId: string): void {
    this.entryStaffId = staffId;
    this.caret = Math.min(this.caret, this.events().length);
    this.regions.say(
      'Entry',
      `Entering on ${this.state.staff(staffId).name}, voice ${this.voice}.`,
    );
    this.onChange?.({ kind: 'entry' });
  }

  private announceCaret(): void {
    this.state.setCursor({ staffId: this.entryStaffId, ...this.caretPosition() });
    this.onChange?.({ kind: 'caret' });
  }

  private refuse(): boolean {
    if (this.state.canEdit(this.entryStaffId)) return false;
    this.regions.say('Entry', 'That edit was refused: You can edit only your own staves.');
    return true;
  }

  private previousNote(): Pitch | null {
    const events = this.events();
    for (let index = this.caret - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event && event.kind === 'note' && event.pitch) return event.pitch;
    }
    return null;
  }

  /** The octave that puts a new note nearest the previous one, or the staff's middle line. */
  private octaveFor(step: Pitch['step']): number {
    const reference =
      this.previousNote() ?? CLEF_MIDDLE_PITCH[this.state.staff(this.entryStaffId).clef]!;
    return nearestOctave(step, reference);
  }

  private afterId(): ElementId | null {
    const events = this.events();
    return this.caret === 0 ? null : (events[this.caret - 1]?.id ?? null);
  }

  private send(op: Operation): void {
    this.state.submit([op]);
  }

  private announceEntry(pitch: Pitch | null, duration: DurationName, dots: number): void {
    const events = this.events();
    const event = events[this.caret - 1];
    if (!event) return;
    const where = `measure ${event.measure}, beat ${formatBeat(event.beat)}`;
    const base =
      pitch === null
        ? `${capitalise(durationWord(duration, dots))} rest, ${where}.`
        : `${formatPitch(pitch)} ${durationWord(duration, dots)}, ${where}.`;
    const crossing =
      event.pieces.length > 1
        ? ` Tied across the barline into measure ${event.pieces[event.pieces.length - 1]!.measure}.`
        : '';
    this.regions.say('Entry', `${base}${crossing}`);
  }

  private insert(pitch: Pitch | null): void {
    if (this.refuse()) return;
    const dots = this.dotted ? 1 : 0;
    const id = this.state.nextStamp();
    const op: Operation = {
      id,
      type: 'insert',
      staffId: this.entryStaffId,
      voice: this.voice,
      after: this.afterId(),
      event:
        pitch === null
          ? { kind: 'rest', duration: this.duration, dots }
          : { kind: 'note', pitch, duration: this.duration, dots },
    };
    this.send(op);
    this.caret += 1;
    this.announceEntry(pitch, this.duration, dots);
    this.announceCaret();
    this.onChange?.({ kind: 'music' });
  }

  private setField(field: SetField, value: unknown): void {
    const event = this.currentEvent();
    if (!event || this.refuse()) return;
    this.send({
      id: this.state.nextStamp(),
      type: 'set',
      staffId: this.entryStaffId,
      voice: this.voice,
      target: event.id,
      field,
      value,
    });
    this.onChange?.({ kind: 'music' });
  }

  saveText(event: VoiceEvent, text: string): void {
    if (this.refuse()) return;
    this.send({
      id: this.state.nextStamp(),
      type: 'set',
      staffId: this.entryStaffId,
      voice: this.voice,
      target: event.id,
      field: 'text',
      value: text,
    });
    this.regions.say('Text', 'Text saved.');
    this.onChange?.({ kind: 'text' });
  }

  private movePitch(direction: 1 | -1, octave: boolean): void {
    const event = this.currentEvent();
    if (!event || event.pitch === null) return;
    const pitch = octave
      ? moveOctave(event.pitch, direction)
      : moveSemitone(event.pitch, direction);
    this.setField('pitch', pitch);
    this.regions.say('Entry', `Now ${formatPitch(pitch)}.`);
  }

  private respell(): void {
    const event = this.currentEvent();
    if (!event || event.pitch === null) return;
    const pitch = nextSpelling(event.pitch);
    this.setField('pitch', pitch);
    this.regions.say('Entry', `Respelled as ${formatPitch(pitch)}.`);
  }

  private toggleTie(): void {
    const event = this.currentEvent();
    if (!event) return;
    this.setField('tie', !event.tie);
    this.regions.say('Entry', event.tie ? 'Tie removed.' : 'Tie added.');
  }

  private cycleDynamic(): void {
    const event = this.currentEvent();
    if (!event) return;
    const here = DYNAMIC_CYCLE.indexOf(event.dynamic);
    const next = DYNAMIC_CYCLE[(here + 1) % DYNAMIC_CYCLE.length]!;
    this.setField('dynamic', next);
    this.regions.say('Entry', next === null ? 'Dynamic removed.' : `Dynamic ${next}.`);
  }

  private flipDynamic(): void {
    const event = this.currentEvent();
    if (!event) return;
    const next = event.dynamicPlacement === 'above' ? 'below' : 'above';
    this.setField('dynamicPlacement', next);
    this.regions.say(
      'Entry',
      next === 'above' ? 'Dynamic above the staff.' : 'Dynamic below the staff.',
    );
  }

  private remove(): void {
    const event = this.currentEvent();
    if (!event || this.refuse()) return;
    this.send({
      id: this.state.nextStamp(),
      type: 'delete',
      staffId: this.entryStaffId,
      voice: this.voice,
      target: event.id,
    });
    this.caret -= 1;
    this.regions.say(
      'Entry',
      event.kind === 'rest'
        ? `Deleted ${durationWord(event.duration, event.dots)} rest.`
        : `Deleted ${formatPitch(event.pitch!)} ${durationWord(event.duration, event.dots)}.`,
    );
    this.announceCaret();
    this.onChange?.({ kind: 'music' });
  }

  private chooseDuration(duration: DurationName): void {
    this.duration = duration;
    this.regions.say('Entry', `${capitalise(durationWord(duration, 0))} selected.`);
  }

  private toggleDot(): void {
    this.dotted = !this.dotted;
    this.regions.say('Entry', this.dotted ? 'Dot on.' : 'Dot off.');
  }

  private changeVoice(): void {
    this.voice = this.voice === 1 ? 2 : 1;
    this.caret = this.events().length;
    this.regions.say(
      'Entry',
      `Entering on ${this.state.staff(this.entryStaffId).name}, voice ${this.voice}.`,
    );
    this.onChange?.({ kind: 'entry' });
  }

  private stepStaff(direction: 1 | -1): void {
    const staves = this.state.head.staves;
    const here = staves.findIndex((staff) => staff.id === this.entryStaffId);
    const next = staves[here + direction];
    if (next) this.setEntryStaff(next.id);
  }

  /** The score editor keys. The key and the Shift modifier decide, never the letter's case. */
  handleKey(event: KeyboardEvent): boolean {
    const key = event.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;
    const octaveModifier = event.ctrlKey || event.metaKey;

    if (key === ' ') {
      this.onPlayToggle?.();
      return true;
    }
    if (event.shiftKey) {
      if (lower === 'd') {
        this.cycleDynamic();
        return true;
      }
      if (lower === 'f') {
        this.flipDynamic();
        return true;
      }
      return false;
    }
    if (key === 'ArrowLeft') {
      this.caret = Math.max(0, this.caret - 1);
      this.announceCaret();
      return true;
    }
    if (key === 'ArrowRight') {
      this.caret = Math.min(this.events().length, this.caret + 1);
      this.announceCaret();
      return true;
    }
    if (key === 'Home') {
      this.caret = 0;
      this.announceCaret();
      return true;
    }
    if (key === 'End') {
      this.caret = this.events().length;
      this.announceCaret();
      return true;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const direction = key === 'ArrowUp' ? 1 : -1;
      if (event.altKey) {
        this.stepStaff(key === 'ArrowUp' ? -1 : 1);
        return true;
      }
      this.movePitch(direction, octaveModifier);
      return true;
    }
    if (key === 'Backspace') {
      this.remove();
      return true;
    }
    if (DURATION_KEYS[key]) {
      this.chooseDuration(DURATION_KEYS[key]!);
      return true;
    }
    if (key === '.') {
      this.toggleDot();
      return true;
    }
    if (lower === 'r') {
      this.insert(null);
      return true;
    }
    if (lower === 'v') {
      this.changeVoice();
      return true;
    }
    if (lower === 'j') {
      this.respell();
      return true;
    }
    if (lower === 't') {
      this.toggleTie();
      return true;
    }
    if (lower === 'x') {
      const current = this.currentEvent();
      if (current) this.onTextRequest?.(current);
      return true;
    }
    if (PITCH_KEYS.has(lower)) {
      const step = lower.toUpperCase() as Pitch['step'];
      this.insert({ step, alter: 0, octave: this.octaveFor(step) });
      return true;
    }
    return false;
  }
}
