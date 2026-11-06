// The boundary tally: connectors morph, markers stagger, tallies roll.

import { Derived, PageDocument } from '../shared/types.js';
import { boundaryAnnouncements } from '../shared/pageRules.js';
import { Editor } from './editor.js';

export interface TallyPlay {
  derivedBefore: Derived;
  derivedAfter: Derived;
  pageBefore: PageDocument;
  pageAfter: PageDocument;
  movedShapeIds: string[];
  movedZoneId: string | null;
  zoneResized: boolean;
  reverse: boolean;
}

const CONNECTOR_MORPH_MS = 200;
const MARKER_STAGGER_MS = 40;
const TALLY_ROLL_MS = 300;

export class BoundaryTally {
  private editor: Editor;
  private running: TallyPlay | null = null;
  private timeout: number | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  cancel(): void {
    if (this.timeout !== null) {
      window.clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.running = null;
  }

  play(play: TallyPlay): void {
    // A running sequence jumps to its end state first.
    this.jumpToEnd();
    this.running = play;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      this.finish();
      return;
    }
    let wait = 0;
    if (play.reverse) {
      // Undo: tallies roll back first, markers follow, connectors morph last.
      this.rollTallies();
      wait += TALLY_ROLL_MS;
      this.timeout = window.setTimeout(() => {
        this.updateMarkers();
        wait += Math.min(12, countChanges(play.derivedAfter)) * MARKER_STAGGER_MS;
        this.timeout = window.setTimeout(() => {
          this.morphConnectors(play);
          this.finish();
        }, Math.min(12, countChanges(play.derivedAfter)) * MARKER_STAGGER_MS);
      }, TALLY_ROLL_MS);
    } else {
      this.morphConnectors(play);
      const markerCount = Math.min(12, countChanges(play.derivedAfter));
      this.timeout = window.setTimeout(() => {
        this.updateMarkers();
        wait += markerCount * MARKER_STAGGER_MS;
        this.timeout = window.setTimeout(() => {
          this.rollTallies();
          this.finish();
        }, markerCount * MARKER_STAGGER_MS);
      }, CONNECTOR_MORPH_MS);
    }
  }

  private morphConnectors(play: TallyPlay): void {
    const view = this.editor.viewPublic();
    for (const connector of play.pageAfter.connectors) {
      const old = play.pageBefore.connectors.find((c) => c.id === connector.id);
      if (old === undefined || pathChanged(old.points, connector.points)) {
        view.morphConnector(connector.id, connector.points, CONNECTOR_MORPH_MS);
      }
    }
  }

  private updateMarkers(): void {
    this.editor.render();
  }

  private rollTallies(): void {
    // The tally's accessible name holds the new value from the start; the
    // visible digits roll to it.
    this.editor.render();
  }

  private finish(): void {
    const play = this.running as TallyPlay;
    this.running = null;
    if (this.timeout !== null) {
      window.clearTimeout(this.timeout);
      this.timeout = null;
    }
    const sentences = boundaryAnnouncements({
      pageBefore: play.pageBefore,
      pageAfter: play.pageAfter,
      movedShapeIds: play.movedShapeIds,
      movedZoneId: play.movedZoneId,
      zoneResized: play.zoneResized,
    });
    this.editor.announce(sentences.join(' '));
  }

  jumpToEnd(): void {
    if (this.running === null) return;
    if (this.timeout !== null) {
      window.clearTimeout(this.timeout);
      this.timeout = null;
    }
    const play = this.running;
    this.running = null;
    this.editor.render();
    void play;
  }
}

function countChanges(derived: Derived): number {
  return derived.crossings.length;
}

function pathChanged(a: [number, number][], b: [number, number][]): boolean {
  if (a.length !== b.length) return true;
  return a.some((p, i) => p[0] !== b[i][0] || p[1] !== b[i][1]);
}
