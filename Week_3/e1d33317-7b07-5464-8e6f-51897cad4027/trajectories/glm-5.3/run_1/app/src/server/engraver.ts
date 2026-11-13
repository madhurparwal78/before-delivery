import {
  Clef,
  Pitch,
  TimeSignature,
  Transpose,
  DURATION_TICKS,
  DurationName,
} from '../domain/values.js';
import { PositionedEvent, StaffRecord } from '../domain/scoremodel.js';
import { writtenPitch, diatonicIndex } from '../domain/pitch.js';
import { chunkTicks } from '../domain/timeline.js';

/** SMuFL codepoints in the private-use area, from the Bravura font. */
const G = {
  gClef: '\u{E050}',
  fClef: '\u{E062}',
  cClef: '\u{E05C}',
  percussionClef: '\u{E069}',
  timeSig0: '\u{E080}',
  timeSig1: '\u{E081}',
  timeSig2: '\u{E082}',
  timeSig3: '\u{E083}',
  timeSig4: '\u{E084}',
  timeSig5: '\u{E085}',
  timeSig6: '\u{E086}',
  timeSig7: '\u{E087}',
  timeSig8: '\u{E088}',
  timeSig9: '\u{E089}',
  noteheadWhole: '\u{E0A2}',
  noteheadHalf: '\u{E0A3}',
  noteheadBlack: '\u{E0A4}',
  restWhole: '\u{E4E3}',
  restHalf: '\u{E4E4}',
  restQuarter: '\u{E4E5}',
  rest8th: '\u{E4E6}',
  rest16th: '\u{E4E7}',
  rest32nd: '\u{E4E8}',
  flag8thUp: '\u{E240}',
  flag16thUp: '\u{E242}',
  flag32ndUp: '\u{E243}',
  flag8thDown: '\u{E241}',
  flag16thDown: '\u{E245}',
  flag32ndDown: '\u{E246}',
  accidentalSharp: '\u{E262}',
  accidentalFlat: '\u{E260}',
  accidentalNatural: '\u{E261}',
  accidentalDoubleSharp: '\u{E263}',
  accidentalDoubleFlat: '\u{E264}',
  augmentationDot: '\u{E1E7}',
  tie: '\u{E145}',
  dynamicP: '\u{E520}',
  dynamicM: '\u{E521}',
  dynamicF: '\u{E522}',
  dynamicZ: '\u{E525}',
  dynamicS: '\u{E524}',
  metronomeMark: '\u{E24B}',
};

const PAPER = '#faf6ec';
const INK = '#1b1613';
const GREY = '#7d7263';
const VERMILION = '#c33c1e';

export interface EngravedSystem {
  index: number;
  page: number;
  firstMeasure: number;
  lastMeasure: number;
  svg: string;
}

export interface EngraveRequest {
  view: 'score' | 'part';
  partId: string | null;
  limit: number;
  cursor: { systemIndex: number } | null;
  systemBreaks: number[];
  pageBreaks: number[];
  maxSystemsPerPage: number;
}

const SYSTEM_WIDTH = 1120;
const STAFF_SPACE = 8; // px per staff step (half a space)

/**
 * The engraver: it draws each system as server-made SVG with Bravura glyphs.
 * System breaks come only from here, so every client shows the same layout.
 */
export class Engraver {
  engrave(
    staves: StaffRecord[],
    voices: Map<string, PositionedEvent[]>, // key staffId:voice
    timeSignatures: TimeSignature[],
    measureCount: number,
    req: EngraveRequest,
  ): { systems: EngravedSystem[]; nextCursor: { systemIndex: number } | null } {
    const visibleStaves = staves.filter((s) => !req.partId || s.partId === req.partId);
    const systems = this.planSystems(visibleStaves, voices, timeSignatures, measureCount, req);
    const start = req.cursor ? req.cursor.systemIndex : 0;
    const slice = systems.slice(start, start + req.limit);
    const engraved: EngravedSystem[] = slice.map((sys, i) => ({
      index: start + i + 1,
      page: sys.page,
      firstMeasure: sys.firstMeasure,
      lastMeasure: sys.lastMeasure,
      svg: this.drawSystem(sys, visibleStaves, voices, timeSignatures),
    }));
    const nextIndex = start + slice.length;
    return { systems: engraved, nextCursor: nextIndex < systems.length ? { systemIndex: nextIndex } : null };
  }

  /** Decides which measures share each system, honouring hand-placed breaks. */
  planSystems(
    staves: StaffRecord[],
    voices: Map<string, PositionedEvent[]>,
    timeSignatures: TimeSignature[],
    measureCount: number,
    req: EngraveRequest,
  ): { firstMeasure: number; lastMeasure: number; page: number }[] {
    const breaks = new Set(req.systemBreaks);
    const pageBreaks = new Set(req.pageBreaks);
    const systems: { firstMeasure: number; lastMeasure: number; page: number }[] = [];
    let measure = 1;
    let page = 1;
    let countInPage = 0;
    const sigAt = (m: number): TimeSignature => {
      let cur: TimeSignature = timeSignatures[0] ?? { measure: 1, beats: 4, beatType: 4 };
      for (const ts of timeSignatures) {
        if (ts.measure <= m) cur = ts;
        else break;
      }
      return cur;
    };
    const widthBudget = SYSTEM_WIDTH - 100;
    while (measure <= measureCount) {
      let last = measure;
      let width = 70; // clef + time signature
      for (let m = measure; m <= measureCount; m++) {
        const sig = sigAt(m);
        const measureWidth = this.measureWidth(staves, voices, m, sig);
        if (m > measure && (width + measureWidth > widthBudget || breaks.has(m - 1))) break;
        width += measureWidth;
        last = m;
        if (pageBreaks.has(m)) break;
      }
      systems.push({ firstMeasure: measure, lastMeasure: last, page });
      countInPage++;
      if (pageBreaks.has(last) || countInPage >= req.maxSystemsPerPage) {
        page++;
        countInPage = 0;
      }
      measure = last + 1;
    }
    return systems;
  }

  private measureWidth(staves: StaffRecord[], voices: Map<string, PositionedEvent[]>, measure: number, sig: TimeSignature): number {
    let eventCount = 0;
    for (const staff of staves) {
      for (const voice of [1, 2]) {
        const events = voices.get(`${staff.id}:${voice}`) ?? [];
        eventCount += events.filter((e) => e.measure === measure).length;
      }
    }
    const beatWidth = 34;
    const byCount = Math.max(sig.beats, 1) * beatWidth;
    return Math.max(56, Math.min(byCount + eventCount * 18, 300));
  }

  private drawSystem(
    sys: { firstMeasure: number; lastMeasure: number; page: number },
    staves: StaffRecord[],
    voices: Map<string, PositionedEvent[]>,
    timeSignatures: TimeSignature[],
  ): string {
    const height = 60 + staves.length * 76;
    const top = 42;
    const parts: string[] = [];
    parts.push(`<rect width="${SYSTEM_WIDTH}" height="${height}" fill="${PAPER}"/>`);
    const sigAt = (m: number): TimeSignature => {
      let cur: TimeSignature = timeSignatures[0] ?? { measure: 1, beats: 4, beatType: 4 };
      for (const ts of timeSignatures) {
        if (ts.measure <= m) cur = ts;
        else break;
      }
      return cur;
    };

    const yOf = (staffIndex: number) => top + staffIndex * 76;

    // title and system label
    parts.push(
      `<text x="18" y="26" fill="${GREY}" font-family="'IBM Plex Mono', monospace" font-size="13">${sys.firstMeasure}–${sys.lastMeasure}</text>`,
    );

    let x = 20;
    const firstSig = sigAt(sys.firstMeasure);
    const signatureChanges = new Set<number>();
    for (let m = sys.firstMeasure; m <= sys.lastMeasure; m++) {
      for (const ts of timeSignatures) if (ts.measure === m) signatureChanges.add(m);
    }

    for (let i = 0; i < staves.length; i++) {
      const staff = staves[i];
      const y = yOf(i);
      // staff lines
      for (let line = 0; line < 5; line++) {
        parts.push(`<line x1="12" y1="${y + line * STAFF_SPACE}" x2="${SYSTEM_WIDTH - 12}" y2="${y + line * STAFF_SPACE}" stroke="${INK}" stroke-width="1"/>`);
      }
      // clef
      const clefGlyph = this.clefGlyph(staff.clef);
      const clefY = this.clefY(staff.clef, y);
      parts.push(`<text x="${x}" y="${clefY}" fill="${INK}" font-family="Bravura" font-size="62">${clefGlyph}</text>`);
      // time signature at system start or change
      if (sys.firstMeasure === 1 || signatureChanges.has(sys.firstMeasure)) {
        const tsx = x + 44;
        const numGlyphs = String(firstSig.beats).split('').map((d) => G.timeSig0!.codePointAt(0)! + Number(d));
        const denGlyphs = String(firstSig.beatType).split('').map((d) => G.timeSig0!.codePointAt(0)! + Number(d));
        parts.push(
          `<text x="${tsx}" y="${y + STAFF_SPACE * 3}" fill="${INK}" font-family="Bravura" font-size="40">${String.fromCodePoint(...numGlyphs)}</text>`,
        );
        parts.push(
          `<text x="${tsx}" y="${y + STAFF_SPACE}" fill="${INK}" font-family="Bravura" font-size="40">${String.fromCodePoint(...denGlyphs)}</text>`,
        );
      }
      // staff name at left of first system is drawn by the caller shell; keep name small above staff
      parts.push(
        `<text x="14" y="${y - 6}" fill="${GREY}" font-family="'IBM Plex Sans', sans-serif" font-size="11">${escapeXml(staff.name)}</text>`,
      );
    }

    // measures across the system
    let mx = x + 96;
    for (let m = sys.firstMeasure; m <= sys.lastMeasure; m++) {
      const sig = sigAt(m);
      const mw = this.measureWidth(staves, voices, m, sig);
      for (let i = 0; i < staves.length; i++) {
        const staff = staves[i];
        const y = yOf(i);
        this.drawMeasureEvents(parts, staff, voices, m, mx, mw, y, i === 0);
      }
      // barline
      for (let i = 0; i < staves.length; i++) {
        const y = yOf(i);
        const isLast = m === sys.lastMeasure;
        parts.push(
          `<line x1="${mx + mw}" y1="${y}" x2="${mx + mw}" y2="${y + STAFF_SPACE * 4}" stroke="${INK}" stroke-width="${isLast ? 2.2 : 1.1}"/>`,
        );
      }
      // measure number below first staff
      parts.push(
        `<text x="${mx + mw / 2}" y="${top + staves.length * 76 + 6}" fill="${GREY}" font-family="'IBM Plex Mono', monospace" font-size="11" text-anchor="middle">${m}</text>`,
      );
      mx += mw;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SYSTEM_WIDTH}" height="${height}" viewBox="0 0 ${SYSTEM_WIDTH} ${height}" role="img">${parts.join('')}</svg>`;
  }

  private drawMeasureEvents(
    parts: string[],
    staff: StaffRecord,
    voices: Map<string, PositionedEvent[]>,
    measure: number,
    measureX: number,
    measureWidth: number,
    staffY: number,
    isTopStaff: boolean,
  ): void {
    for (const voice of [1, 2]) {
      const events = voices.get(`${staff.id}:${voice}`) ?? [];
      const inMeasure = events.filter((e) => e.measure === measure);
      const totalTicks = inMeasure.reduce((n, e) => n + e.ticks, 0) || 1;
      let cursor = measureX + 8;
      const usable = measureWidth - 16;
      for (const ev of inMeasure) {
        const slot = (ev.ticks / totalTicks) * usable;
        const cx = cursor + slot / 2;
        this.drawEvent(parts, staff, ev, cx, staffY, voice, isTopStaff);
        cursor += slot;
      }
      // show trailing space as nothing (rests are explicit events)
    }
  }

  private drawEvent(
    parts: string[],
    staff: StaffRecord,
    ev: PositionedEvent,
    cx: number,
    staffY: number,
    voice: number,
    isTopStaff: boolean,
  ): void {
    const y = staffY;
    if (voice === 2) {
      // small voice-2 marker offsets the stem direction
    }
    if (ev.kind === 'rest') {
      const glyph = this.restGlyph(ev);
      const ry = y + STAFF_SPACE * 2;
      parts.push(`<text x="${cx}" y="${ry}" fill="${INK}" font-family="Bravura" font-size="40" text-anchor="middle">${glyph}</text>`);
    } else if (ev.pitch) {
      const written = writtenPitch(ev.pitch, staff.transpose);
      const step = this.staffStep(written, staff.clef);
      const ny = y + STAFF_SPACE * 4 - step * STAFF_SPACE / 2;
      const isWhole = ev.duration === 'whole' && ev.dots === 0;
      const isHalf = ev.duration === 'half' && ev.dots === 0;
      const head = isWhole ? G.noteheadWhole : isHalf ? G.noteheadHalf : G.noteheadBlack;
      const stemUp = step <= 4;
      parts.push(`<text x="${cx}" y="${ny}" fill="${INK}" font-family="Bravura" font-size="36" text-anchor="middle">${head}</text>`);
      if (!isWhole) {
        const stemX = cx + (stemUp ? 8.6 : -8.6);
        const stemY1 = stemUp ? ny - 1 : ny + 1;
        const stemY2 = stemUp ? ny - 56 : ny + 56;
        parts.push(`<line x1="${stemX}" y1="${stemY1}" x2="${stemX}" y2="${stemY2}" stroke="${INK}" stroke-width="1.6"/>`);
        const flags = ev.duration === 'eighth' ? 1 : ev.duration === '16th' ? 2 : ev.duration === '32nd' ? 3 : 0;
        for (let f = 0; f < flags; f++) {
          const glyph = stemUp
            ? f === 0 ? G.flag8thUp : f === 1 ? G.flag16thUp : G.flag32ndUp
            : f === 0 ? G.flag8thDown : f === 1 ? G.flag16thDown : G.flag32ndDown;
          const fy = stemUp ? stemY2 + 2 + f * 26 : stemY2 - 2 - f * 26 + 26;
          parts.push(`<text x="${stemX - 8}" y="${fy}" fill="${INK}" font-family="Bravura" font-size="34">${glyph}</text>`);
        }
      }
      if (written.alter !== 0) {
        const acc = this.accidentalGlyph(written.alter);
        parts.push(`<text x="${cx - 22}" y="${ny}" fill="${INK}" font-family="Bravura" font-size="34" text-anchor="middle">${acc}</text>`);
      }
      for (let d = 0; d < ev.dots; d++) {
        parts.push(`<circle cx="${cx + 16 + d * 8}" cy="${ny - 4}" r="2.6" fill="${INK}"/>`);
      }
      if (ev.tie) {
        parts.push(`<path d="M ${cx + 8} ${ny + (stemUp ? 8 : -8)} q 9 ${stemUp ? 8 : -8} 18 0" fill="none" stroke="${INK}" stroke-width="1.4"/>`);
      }
      if (ev.dynamic) {
        const dy = ev.dynamicPlacement === 'above' ? ny - 74 : ny + 30;
        parts.push(`<text x="${cx}" y="${dy}" fill="${INK}" font-family="Bravura" font-size="26" text-anchor="middle">${this.dynamicGlyph(ev.dynamic)}</text>`);
      }
      if (ev.text && isTopStaff) {
        const ty = ny - 92;
        parts.push(`<text x="${cx}" y="${ty}" fill="${INK}" font-family="'IBM Plex Sans', sans-serif" font-size="13" font-style="italic" text-anchor="middle">${escapeXml(ev.text)}</text>`);
      }
    }
  }

  private clefGlyph(clef: Clef): string {
    switch (clef) {
      case 'treble': return G.gClef;
      case 'bass': return G.fClef;
      case 'alto': return G.cClef;
      case 'tenor': return G.cClef;
      case 'percussion': return G.percussionClef;
    }
  }

  private clefY(clef: Clef, staffTop: number): number {
    const line2 = staffTop + STAFF_SPACE * 2;
    switch (clef) {
      case 'treble': return line2 + 30;
      case 'bass': return line2 - 30;
      case 'alto': return line2 + 21;
      case 'tenor': return line2 + 7;
      case 'percussion': return line2 + 21;
    }
  }

  /** Diatonic staff step (0 = bottom line) for a written pitch under a clef. */
  staffStep(p: Pitch, clef: Clef): number {
    // reference: middle line position per clef (B4 treble, C4 alto, A3 tenor, D3 bass)
    const reference: Record<Clef, Pitch> = {
      treble: { step: 'B', alter: 0, octave: 4 },
      alto: { step: 'C', alter: 0, octave: 4 },
      tenor: { step: 'A', alter: 0, octave: 3 },
      bass: { step: 'D', alter: 0, octave: 3 },
      percussion: { step: 'B', alter: 0, octave: 4 },
    };
    const ref = reference[clef];
    const diff = diatonicIndex(p) - diatonicIndex(ref);
    return 4 + Math.round(diff / 2);
  }

  private restGlyph(ev: PositionedEvent): string {
    if (ev.duration === 'whole' && ev.dots === 0) return G.restWhole;
    if (ev.duration === 'half' && ev.dots === 0) return G.restHalf;
    if (ev.duration === 'quarter') return G.restQuarter;
    if (ev.duration === 'eighth') return G.rest8th;
    if (ev.duration === '16th') return G.rest16th;
    return G.rest32nd;
  }

  private accidentalGlyph(alter: number): string {
    if (alter === 2) return G.accidentalDoubleSharp;
    if (alter === 1) return G.accidentalSharp;
    if (alter === -1) return G.accidentalFlat;
    if (alter === -2) return G.accidentalDoubleFlat;
    return G.accidentalNatural;
  }

  private dynamicGlyph(mark: string): string {
    switch (mark) {
      case 'p': return G.dynamicP;
      case 'm': return G.dynamicM;
      case 'f': return G.dynamicF;
      case 's': return G.dynamicS;
      case 'z': return G.dynamicZ;
      default: return G.dynamicP;
    }
  }

  dynamicsText(mark: string): string {
    const out: string[] = [];
    for (const ch of mark) out.push(this.dynamicGlyph(ch));
    return out.join('');
  }
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The 200-character plain text of a filtered expression, tags rendered inline. */
export function renderTextToSvg(filtered: string): string {
  return filtered.replace(/<br\s*\/?>/g, '\n');
}

export { chunkTicks, DURATION_TICKS, SYSTEM_WIDTH, PAPER, INK, GREY, VERMILION };
export type { DurationName, Transpose, TimeSignature };
