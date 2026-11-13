import type { VoiceDocument } from '../../shared/crdt.js';
import {
  MeterMap,
  decomposeTicks,
  transposePitch,
} from '../../shared/music.js';
import type {
  Clef,
  DurationName,
  ElementId,
  DynamicPlacement,
  PartLayout,
  Pitch,
  Staff,
  Voice,
} from '../../shared/types.js';
import { voiceKey } from '../store/score.js';
import type { GlyphName } from '../../shared/bravura-metrics.js';
import {
  ACCIDENTAL_GLYPH,
  CONTENT_WIDTH,
  FLAG_DOWN,
  FLAG_UP,
  FOOTROOM_SPACES,
  HEADROOM_SPACES,
  NOTEHEAD,
  PAGE_HEIGHT,
  PAGE_MARGIN,
  PAGE_WIDTH,
  PART_STAFF_SPACE,
  REST_GLYPH,
  STAFF_GAP_SPACES,
  STAFF_SPACE,
  TIME_SIG_DIGITS,
  clefAnchor,
  clefGlyph,
  dynamicGlyphs,
  glyphAdvance,
  glyphText,
  stepsBelowTopLine,
} from './geometry.js';

const INK = '#17181d';
const GREY = '#8c8375';
const PAPER = '#faf6ef';

interface NoteItem {
  elementId: ElementId | null;
  staffId: string;
  voice: Voice;
  measure: number;
  tickInMeasure: number;
  duration: DurationName;
  dots: number;
  kind: 'note' | 'rest';
  pitch: Pitch | null;
  tiedForward: boolean;
  dynamic: string | null;
  placement: DynamicPlacement | null;
  text: string;
  wholeMeasure: boolean;
}

interface StaffLine {
  staff: Staff;
  voices: Map<Voice, NoteItem[]>;
}

export interface SystemPlan {
  index: number;
  page: number;
  firstMeasure: number;
  lastMeasure: number;
  widths: number[];
  prefix: number;
  showTimeSignature: boolean;
}

export interface PagePlan {
  page: number;
  systems: SystemPlan[];
}

export interface EngravePlanInput {
  title: string;
  view: 'score' | 'part';
  partName: string | null;
  staves: Staff[];
  voices: Map<string, VoiceDocument>;
  meter: MeterMap;
  measureCount: number;
  layout: PartLayout;
}

function textRuns(filtered: string): { text: string; italic: boolean; bold: boolean }[][] {
  const lines: { text: string; italic: boolean; bold: boolean }[][] = [[]];
  let italic = 0;
  let bold = 0;
  let index = 0;
  while (index < filtered.length) {
    const next = filtered.indexOf('<', index);
    const chunk = next === -1 ? filtered.slice(index) : filtered.slice(index, next);
    if (chunk.length > 0) {
      lines[lines.length - 1]!.push({
        text: chunk.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
        italic: italic > 0,
        bold: bold > 0,
      });
    }
    if (next === -1) break;
    const close = filtered.indexOf('>', next);
    const tag = filtered.slice(next + 1, close);
    if (tag === 'br') lines.push([]);
    else if (tag === 'i') italic += 1;
    else if (tag === 'b') bold += 1;
    else if (tag === '/i') italic -= 1;
    else if (tag === '/b') bold -= 1;
    index = close + 1;
  }
  return lines;
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** One engraving of a score or a part: measure widths, system breaks, pages and drawing. */
export class Engraving {
  private readonly lines: StaffLine[] = [];
  private readonly widths: number[] = [];
  readonly systems: SystemPlan[] = [];
  readonly pages: PagePlan[] = [];
  readonly space: number;
  private readonly staffHeight: number;
  private readonly systemHeight: number;

  constructor(private readonly input: EngravePlanInput) {
    this.space = input.view === 'part' ? PART_STAFF_SPACE : STAFF_SPACE;
    this.staffHeight = this.space * 4;
    this.systemHeight =
      (HEADROOM_SPACES + FOOTROOM_SPACES) * this.space +
      input.staves.length * this.staffHeight +
      Math.max(0, input.staves.length - 1) * STAFF_GAP_SPACES * this.space;
    this.buildLines();
    this.measureWidths();
    this.breakSystems();
    this.assignPages();
  }

  private buildLines(): void {
    for (const staff of this.input.staves) {
      const voices = new Map<Voice, NoteItem[]>();
      for (const voice of [1, 2] as Voice[]) {
        const document = this.input.voices.get(voiceKey(staff.id, voice));
        voices.set(voice, document ? this.itemsFor(staff, voice, document) : []);
      }
      if (voices.get(1)!.length === 0 && voices.get(2)!.length === 0) {
        voices.set(1, this.restFill(staff.id, 1, 1, this.input.measureCount));
      }
      this.lines.push({ staff, voices });
    }
  }

  private itemsFor(staff: Staff, voice: Voice, document: VoiceDocument): NoteItem[] {
    const items: NoteItem[] = [];
    const events = document.events(this.input.meter);
    for (const event of events) {
      let first = true;
      event.pieces.forEach((piece, pieceIndex) => {
        const lastPiece = pieceIndex === event.pieces.length - 1;
        let offset = 0;
        const parts = decomposeTicks(piece.ticks);
        parts.forEach((part, partIndex) => {
          const lastPart = partIndex === parts.length - 1;
          const measureTicks = this.input.meter.measureTicks(piece.measure);
          const tickInMeasure =
            (piece.beat - 1) * this.input.meter.beatTicks(piece.measure) + offset;
          const pitch =
            event.pitch === null
              ? null
              : this.input.view === 'part'
                ? transposePitch(event.pitch, staff.transpose, -1)
                : event.pitch;
          items.push({
            elementId: first ? event.id : null,
            staffId: staff.id,
            voice,
            measure: piece.measure,
            tickInMeasure,
            duration: part.duration,
            dots: part.dots,
            kind: event.kind,
            pitch,
            tiedForward: !(lastPiece && lastPart) || event.tie,
            dynamic: first ? event.dynamic : null,
            placement: first ? event.dynamicPlacement : null,
            text: first ? event.text : '',
            wholeMeasure: event.kind === 'rest' && piece.ticks === measureTicks,
          });
          offset += part.ticks;
          first = false;
        });
      });
    }
    const total = document.totalTicks();
    const startMeasure = this.input.meter.locate(total).measure;
    if (total < this.input.meter.measureStart(this.input.measureCount + 1)) {
      items.push(...this.restFill(staff.id, voice, startMeasure, this.input.measureCount, total));
    }
    return items;
  }

  private restFill(
    staffId: string,
    voice: Voice,
    fromMeasure: number,
    toMeasure: number,
    fromTicks?: number,
  ): NoteItem[] {
    const items: NoteItem[] = [];
    let cursor = fromTicks ?? this.input.meter.measureStart(fromMeasure);
    const end = this.input.meter.measureStart(toMeasure + 1);
    while (cursor < end) {
      const { measure, tickInMeasure } = this.input.meter.locate(cursor);
      const measureTicks = this.input.meter.measureTicks(measure);
      const room = measureTicks - tickInMeasure;
      let offset = tickInMeasure;
      for (const part of decomposeTicks(room)) {
        items.push({
          elementId: null,
          staffId,
          voice,
          measure,
          tickInMeasure: offset,
          duration: part.duration,
          dots: part.dots,
          kind: 'rest',
          pitch: null,
          tiedForward: false,
          dynamic: null,
          placement: null,
          text: '',
          wholeMeasure: room === measureTicks,
        });
        offset += part.ticks;
      }
      cursor += room;
    }
    return items;
  }

  private measureWidths(): void {
    const minimum = 7.5 * this.space;
    for (let measure = 1; measure <= this.input.measureCount; measure += 1) {
      let busiest = 0;
      for (const line of this.lines) {
        for (const items of line.voices.values()) {
          let width = 0;
          for (const item of items) {
            if (item.measure !== measure) continue;
            width += (item.kind === 'rest' ? 3.2 : 4.4) * this.space;
            if (item.pitch && item.pitch.alter !== 0) width += 1.8 * this.space;
            width += item.dots * 0.9 * this.space;
            if (item.text.length > 0) width += 3 * this.space;
          }
          busiest = Math.max(busiest, width);
        }
      }
      this.widths.push(Math.max(minimum, busiest + 2 * this.space));
    }
  }

  private prefixWidth(clefs: Clef[], showTimeSignature: boolean): number {
    const widest = Math.max(...clefs.map((clef) => glyphAdvance(clefGlyph(clef))));
    return (widest + 1.2 + (showTimeSignature ? 3.2 : 0)) * this.space;
  }

  private breakSystems(): void {
    const clefs = this.input.staves.map((staff) => staff.clef);
    const forcedSystem = new Set(this.input.layout.systemBreaks);
    const forcedPage = new Set(this.input.layout.pageBreaks);
    const signatureMeasures = new Set(this.input.meter.signatureMeasures());
    let measure = 1;
    let index = 0;
    while (measure <= this.input.measureCount) {
      const showTimeSignature = index === 0 || signatureMeasures.has(measure);
      const prefix = this.prefixWidth(clefs, showTimeSignature);
      const widths: number[] = [];
      let used = prefix;
      let last = measure;
      for (let candidate = measure; candidate <= this.input.measureCount; candidate += 1) {
        const width = this.widths[candidate - 1]!;
        if (widths.length > 0 && used + width > CONTENT_WIDTH) break;
        if (widths.length > 0 && signatureMeasures.has(candidate)) break;
        widths.push(width);
        used += width;
        last = candidate;
        if (forcedSystem.has(candidate) || forcedPage.has(candidate)) break;
      }
      index += 1;
      this.systems.push({
        index,
        page: 0,
        firstMeasure: measure,
        lastMeasure: last,
        widths: this.stretch(widths, prefix, last === this.input.measureCount),
        prefix,
        showTimeSignature,
      });
      measure = last + 1;
    }
  }

  private stretch(widths: number[], prefix: number, isLast: boolean): number[] {
    const natural = widths.reduce((sum, width) => sum + width, 0);
    const room = CONTENT_WIDTH - prefix;
    if (natural >= room) return widths;
    if (isLast && natural < room * 0.6) return widths;
    const factor = room / natural;
    return widths.map((width) => width * factor);
  }

  private assignPages(): void {
    const forcedPage = new Set(this.input.layout.pageBreaks);
    const perPage =
      this.input.view === 'part'
        ? this.input.staves.length > 1
          ? 5
          : 10
        : Math.max(1, Math.floor((PAGE_HEIGHT - PAGE_MARGIN * 2 - 40) / (this.systemHeight + 16)));
    let page = 1;
    let onPage = 0;
    for (const system of this.systems) {
      if (onPage >= perPage) {
        page += 1;
        onPage = 0;
      }
      system.page = page;
      onPage += 1;
      if (forcedPage.has(system.lastMeasure) && system !== this.systems[this.systems.length - 1]) {
        page += 1;
        onPage = 0;
      }
    }
    const grouped = new Map<number, SystemPlan[]>();
    for (const system of this.systems) {
      const list = grouped.get(system.page) ?? [];
      list.push(system);
      grouped.set(system.page, list);
    }
    for (const [number, systems] of [...grouped].sort((a, b) => a[0] - b[0])) {
      this.pages.push({ page: number, systems });
    }
  }

  get systemWidth(): number {
    return CONTENT_WIDTH;
  }

  get systemBoxHeight(): number {
    return this.systemHeight;
  }

  /** One system as a standalone SVG, drawn with the Bravura music font. */
  renderSystem(system: SystemPlan, originY = 0): string {
    const parts: string[] = [];
    const topOf = (staffIndex: number): number =>
      originY +
      HEADROOM_SPACES * this.space +
      staffIndex * (this.staffHeight + STAFF_GAP_SPACES * this.space);
    const systemEnd = system.prefix + system.widths.reduce((sum, width) => sum + width, 0);

    this.lines.forEach((line, staffIndex) => {
      const top = topOf(staffIndex);
      for (let step = 0; step < 5; step += 1) {
        const y = top + step * this.space;
        parts.push(
          `<rect x="0" y="${round(y - 0.55)}" width="${round(systemEnd)}" height="1.1" fill="${INK}"/>`,
        );
      }
      const clef = clefGlyph(line.staff.clef);
      parts.push(
        this.glyph(clef, 0.6 * this.space, top + (clefAnchor(line.staff.clef) * this.space) / 2),
      );
      if (system.showTimeSignature) {
        const signature = this.input.meter.signatureAt(system.firstMeasure);
        const x = (glyphAdvance(clef) + 1.2) * this.space;
        parts.push(this.timeSignature(signature.beats, signature.beatType, x, top));
      }
    });

    let measureX = system.prefix;
    system.widths.forEach((width, offsetIndex) => {
      const measure = system.firstMeasure + offsetIndex;
      this.lines.forEach((line, staffIndex) => {
        const top = topOf(staffIndex);
        for (const [, items] of line.voices) {
          for (const item of items) {
            if (item.measure !== measure) continue;
            const drawn = this.drawItem(item, line.staff.clef, measureX, width, measure, top);
            parts.push(
              item.elementId === null
                ? drawn
                : `<g data-lamport="${item.elementId.lamport}" data-site="${escapeXml(
                    item.elementId.site,
                  )}" data-staff="${escapeXml(item.staffId)}" data-voice="${item.voice}">${drawn}</g>`,
            );
          }
        }
        const barX = measureX + width;
        parts.push(
          `<rect x="${round(barX - 0.8)}" y="${round(top)}" width="1.6" height="${round(this.staffHeight)}" fill="${INK}"/>`,
        );
      });
      parts.push(
        `<text x="${round(measureX + 2)}" y="${round(topOf(0) - this.space * 1.4)}" font-family="IBM Plex Mono" font-size="${round(this.space * 1.3)}" fill="${GREY}">${measure}</text>`,
      );
      measureX += width;
    });

    if (this.lines.length > 1) {
      parts.push(
        `<rect x="0" y="${round(topOf(0))}" width="1.6" height="${round(
          topOf(this.lines.length - 1) + this.staffHeight - topOf(0),
        )}" fill="${INK}"/>`,
      );
    }
    if (system.lastMeasure === this.input.measureCount) {
      parts.push(
        `<rect x="${round(systemEnd - 5)}" y="${round(topOf(0))}" width="1.4" height="${round(
          topOf(this.lines.length - 1) + this.staffHeight - topOf(0),
        )}" fill="${INK}"/>`,
        `<rect x="${round(systemEnd - 2.6)}" y="${round(topOf(0))}" width="2.6" height="${round(
          topOf(this.lines.length - 1) + this.staffHeight - topOf(0),
        )}" fill="${INK}"/>`,
      );
    }
    return parts.join('');
  }

  private timeSignature(beats: number, beatType: number, x: number, top: number): string {
    const digits = (value: number, y: number): string =>
      [...String(value)]
        .map((digit, index) =>
          this.glyph(
            TIME_SIG_DIGITS[Number(digit)]!,
            x + index * 1.3 * this.space,
            y,
          ),
        )
        .join('');
    return digits(beats, top + this.space) + digits(beatType, top + this.space * 3);
  }

  private glyph(name: GlyphName, x: number, y: number): string {
    return `<text x="${round(x)}" y="${round(y)}" font-family="Bravura" font-size="${round(
      this.space * 4,
    )}" fill="${INK}">${glyphText(name)}</text>`;
  }

  private drawItem(
    item: NoteItem,
    clef: Clef,
    measureX: number,
    width: number,
    measure: number,
    top: number,
  ): string {
    const measureTicks = this.input.meter.measureTicks(measure);
    const pad = 1.1 * this.space;
    const usable = Math.max(this.space, width - pad * 2);
    const x = item.wholeMeasure
      ? measureX + width / 2 - this.space
      : measureX + pad + (item.tickInMeasure / measureTicks) * usable;
    const parts: string[] = [];

    if (item.kind === 'rest') {
      const glyph = item.wholeMeasure ? 'restWhole' : REST_GLYPH[item.duration];
      const restY = glyph === 'restWhole' ? top + this.space : top + this.space * 2;
      parts.push(this.glyph(glyph, x, restY));
      if (!item.wholeMeasure) {
        for (let dot = 0; dot < item.dots; dot += 1) {
          parts.push(
            this.glyph(
              'augmentationDot',
              x + (1.5 + dot * 0.6) * this.space,
              top + this.space * 1.5,
            ),
          );
        }
      }
      return parts.join('');
    }

    const pitch = item.pitch!;
    const steps = stepsBelowTopLine(pitch, clef);
    const y = top + (steps * this.space) / 2;
    let headX = x;
    if (pitch.alter !== 0) {
      const accidental = ACCIDENTAL_GLYPH[pitch.alter]!;
      parts.push(this.glyph(accidental, headX, y));
      headX += (glyphAdvance(accidental) + 0.25) * this.space;
    }
    const head = NOTEHEAD[item.duration];
    parts.push(this.glyph(head, headX, y));
    const headWidth = glyphAdvance(head) * this.space;
    for (let dot = 0; dot < item.dots; dot += 1) {
      parts.push(
        this.glyph(
          'augmentationDot',
          headX + headWidth + (0.25 + dot * 0.55) * this.space,
          y - (steps % 2 === 0 ? this.space / 2 : 0),
        ),
      );
    }
    for (let line = steps; line < 0; line += 2) {
      const ledgerY = top + (line * this.space) / 2;
      parts.push(
        `<rect x="${round(headX - 0.3 * this.space)}" y="${round(ledgerY - 0.6)}" width="${round(
          headWidth + 0.6 * this.space,
        )}" height="1.2" fill="${INK}"/>`,
      );
    }
    for (let line = steps; line > 8; line -= 2) {
      const ledgerY = top + (line * this.space) / 2;
      parts.push(
        `<rect x="${round(headX - 0.3 * this.space)}" y="${round(ledgerY - 0.6)}" width="${round(
          headWidth + 0.6 * this.space,
        )}" height="1.2" fill="${INK}"/>`,
      );
    }

    if (item.duration !== 'whole') {
      const stemUp = steps > 4;
      const stemLength = 3.5 * this.space;
      const stemX = stemUp ? headX + headWidth - 0.6 : headX + 0.6;
      const stemTop = stemUp ? y - stemLength : y;
      parts.push(
        `<rect x="${round(stemX - 0.6)}" y="${round(stemTop)}" width="1.2" height="${round(
          stemLength,
        )}" fill="${INK}"/>`,
      );
      const flag = stemUp ? FLAG_UP[item.duration] : FLAG_DOWN[item.duration];
      if (flag) {
        parts.push(this.glyph(flag, stemX - 0.6, stemUp ? y - stemLength : y + stemLength));
      }
    }

    if (item.tiedForward) {
      const tieY = steps > 4 ? y + this.space * 0.9 : y - this.space * 0.9;
      const span = Math.max(this.space * 1.8, usable * 0.22);
      const bow = steps > 4 ? this.space * 0.8 : -this.space * 0.8;
      parts.push(
        `<path d="M ${round(headX + headWidth * 0.4)} ${round(tieY)} q ${round(span / 2)} ${round(
          bow,
        )} ${round(span)} 0" fill="none" stroke="${INK}" stroke-width="1.3"/>`,
      );
    }

    if (item.dynamic) {
      const above = item.placement === 'above';
      const dynamicY = above ? top - this.space * 0.6 : top + this.staffHeight + this.space * 2.2;
      let dynamicX = headX;
      for (const letter of dynamicGlyphs(item.dynamic)) {
        parts.push(this.glyph(letter, dynamicX, dynamicY));
        dynamicX += glyphAdvance(letter) * this.space;
      }
    }

    if (item.text.length > 0) {
      const lines = textRuns(item.text);
      lines.forEach((runs, lineIndex) => {
        const spans = runs
          .map(
            (run) =>
              `<tspan font-style="${run.italic ? 'italic' : 'normal'}" font-weight="${
                run.bold ? '600' : '400'
              }">${escapeXml(run.text)}</tspan>`,
          )
          .join('');
        parts.push(
          `<text x="${round(headX)}" y="${round(
            top + this.staffHeight + this.space * (3.6 + lineIndex * 1.5),
          )}" font-family="IBM Plex Sans" font-size="${round(this.space * 1.5)}" fill="${INK}">${spans}</text>`,
        );
      });
    }
    return parts.join('');
  }

  systemSvg(system: SystemPlan): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${CONTENT_WIDTH}" height="${round(
      this.systemHeight,
    )}" viewBox="0 0 ${CONTENT_WIDTH} ${round(this.systemHeight)}" role="img">${this.renderSystem(
      system,
    )}</svg>`;
  }

  /** A whole part page, self-contained so that the PDF renderer and a plain viewer match. */
  pageSvg(page: PagePlan, fontFaces: string): string {
    const headY = PAGE_MARGIN - 18;
    const title = escapeXml(`${this.input.title} \u2014 ${this.input.partName ?? ''}`);
    const body: string[] = [
      `<rect x="0" y="0" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="${PAPER}"/>`,
      `<text x="${PAGE_MARGIN}" y="${headY}" font-family="Fraunces" font-size="18" fill="${INK}">${title}</text>`,
      `<text x="${PAGE_WIDTH - PAGE_MARGIN}" y="${headY}" text-anchor="end" font-family="IBM Plex Mono" font-size="14" fill="${GREY}">${page.page}</text>`,
    ];
    let y = PAGE_MARGIN + 12;
    for (const system of page.systems) {
      body.push(`<g transform="translate(${PAGE_MARGIN}, ${round(y)})">${this.renderSystem(system)}</g>`);
      y += this.systemHeight + 16;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}"><defs><style>${fontFaces}</style></defs>${body.join('')}</svg>`;
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
