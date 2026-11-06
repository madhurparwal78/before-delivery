import { arcMetres, interpolate, type LatLon } from '../../shared/geo.js';
import { el } from '../shared/dom.js';
import { motion, Tween, ease } from '../shared/motion.js';

export interface PresenceEntry {
  display_name: string;
  satchel_colour: string;
  position: { lat: number; lon: number; heading_deg: number };
  emote: string | null;
}

type Fade = 'in' | 'shown' | 'out';

const GLIDE_MS = 1000;
const FADE_MS = 300;
const SNAP_ARC_M = 20;
const TAKEOVER_ARC_M = 20;

export class DrawnCourier {
  readonly item: HTMLLIElement;
  name: string;
  satchelColour: string;
  emote: string | null = null;
  headingDeg = 0;
  shown: LatLon;
  private from: LatLon;
  private to: LatLon;
  private readonly glide = new Tween();
  fade: Fade = 'in';
  private readonly fadeTween = new Tween();
  matched = false;

  constructor(entry: PresenceEntry, radiusM: number, animate: boolean) {
    this.name = entry.display_name;
    this.satchelColour = entry.satchel_colour;
    this.headingDeg = entry.position.heading_deg;
    this.shown = { lat: entry.position.lat, lon: entry.position.lon };
    this.from = { ...this.shown };
    this.to = { ...this.shown };
    this.item = el('li', {});
    this.radiusM = radiusM;
    if (animate) {
      this.fade = 'in';
      this.fadeTween.start(FADE_MS);
    } else {
      this.fade = 'shown';
    }
    this.refresh();
  }

  private radiusM: number;

  get alpha(): number {
    if (this.fade === 'shown') return 1;
    const progress = this.fadeTween.progress();
    return this.fade === 'in' ? progress : 1 - progress;
  }

  /** A read with a new position glides the figure there, unless the move is a long one. */
  moveTo(entry: PresenceEntry): void {
    this.headingDeg = entry.position.heading_deg;
    const next = { lat: entry.position.lat, lon: entry.position.lon };
    const far = arcMetres(this.shown, next, this.radiusM) > SNAP_ARC_M;
    if (far || motion.reduced) {
      this.shown = next;
      this.from = { ...next };
      this.to = { ...next };
      this.glide.stop();
      return;
    }
    this.from = { ...this.shown };
    this.to = next;
    this.glide.start(GLIDE_MS);
  }

  /** A figure taken over by another courier keeps its place and simply changes its tag. */
  takeOver(entry: PresenceEntry): void {
    this.name = entry.display_name;
    this.satchelColour = entry.satchel_colour;
    this.fade = 'shown';
    this.moveTo(entry);
  }

  leave(): void {
    if (this.fade === 'out') return;
    this.fade = 'out';
    if (motion.reduced) {
      this.fadeTween.start(0);
    } else {
      this.fadeTween.start(FADE_MS);
    }
  }

  get gone(): boolean {
    return this.fade === 'out' && !this.fadeTween.active;
  }

  advance(): void {
    if (this.glide.active) {
      this.shown = interpolate(this.from, this.to, ease(this.glide.progress()));
    }
    if (this.fade === 'in' && !this.fadeTween.active) this.fade = 'shown';
    if (motion.reduced && this.fade === 'in') this.fade = 'shown';
    this.refresh();
  }

  private refresh(): void {
    this.item.textContent = this.name;
    this.item.setAttribute('data-shown-lat', this.shown.lat.toFixed(2));
    this.item.setAttribute('data-shown-lon', this.shown.lon.toFixed(2));
    this.item.setAttribute('data-fade', this.fade);
    this.item.setAttribute('data-emote', this.emote ?? '');
  }
}

/** Matches presence entries to drawn figures, so a rename changes a tag in place. */
export class CourierFigures {
  private figures: DrawnCourier[] = [];

  constructor(
    private readonly list: HTMLElement,
    private readonly radiusM: number,
  ) {}

  get drawn(): DrawnCourier[] {
    return this.figures;
  }

  read(entries: PresenceEntry[], first: boolean): void {
    for (const figure of this.figures) figure.matched = false;
    const pending = [...entries];
    const taken = new Set<DrawnCourier>();

    const byName = (entry: PresenceEntry): DrawnCourier | null => {
      const sharing = this.figures.filter(
        (figure) => !taken.has(figure) && figure.fade !== 'out' && figure.name === entry.display_name,
      );
      if (sharing.length === 0) return null;
      let nearest = sharing[0]!;
      let best = arcMetres(nearest.shown, entry.position, this.radiusM);
      for (const candidate of sharing.slice(1)) {
        const distance = arcMetres(candidate.shown, entry.position, this.radiusM);
        if (distance < best) {
          best = distance;
          nearest = candidate;
        }
      }
      return nearest;
    };

    const left: PresenceEntry[] = [];
    for (const entry of pending) {
      const figure = byName(entry);
      if (figure === null) {
        left.push(entry);
        continue;
      }
      taken.add(figure);
      figure.matched = true;
      figure.emote = entry.emote;
      figure.moveTo(entry);
    }

    const orphans = this.figures.filter((figure) => !taken.has(figure) && figure.fade !== 'out');
    const stillNew: PresenceEntry[] = [];
    for (const entry of left) {
      let nearest: DrawnCourier | null = null;
      let best = TAKEOVER_ARC_M;
      for (const figure of orphans) {
        if (taken.has(figure)) continue;
        const distance = arcMetres(figure.shown, entry.position, this.radiusM);
        if (distance <= best) {
          best = distance;
          nearest = figure;
        }
      }
      if (nearest === null) {
        stillNew.push(entry);
        continue;
      }
      taken.add(nearest);
      nearest.matched = true;
      nearest.emote = entry.emote;
      nearest.takeOver(entry);
    }

    for (const entry of stillNew) {
      const figure = new DrawnCourier(entry, this.radiusM, !first && !motion.reduced);
      figure.emote = entry.emote;
      figure.matched = true;
      this.figures.push(figure);
      this.list.append(figure.item);
    }

    for (const figure of this.figures) {
      if (!figure.matched) figure.leave();
    }
  }

  advance(): void {
    for (const figure of this.figures) figure.advance();
    const gone = this.figures.filter((figure) => figure.gone);
    for (const figure of gone) figure.item.remove();
    this.figures = this.figures.filter((figure) => !figure.gone);
  }
}
