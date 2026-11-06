import { type Disposables, query } from "../Disposables";

type Chime = "add" | "breath" | "saved";

const BED = "/audio/evening-bed.mp3";
const CHIMES: Record<Chime, string> = {
  add: "/audio/chime-add.mp3",
  breath: "/audio/chime-breath.mp3",
  saved: "/audio/chime-saved.mp3",
};
const STORAGE_KEY = "stillhour:sound";
const BED_LEVEL = 0.6;
const BED_UNDER_FILM = BED_LEVEL / 3;
const CHIME_LEVEL = 0.45;
const FADE = 0.35;

function readPreference(): boolean | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "on" ? true : value === "off" ? false : null;
  } catch {
    return null;
  }
}

function writePreference(on: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* storage can be unavailable (private mode); the switch still works for this visit */
  }
}

/** The Web Audio graph: everything plays through `master`; the ambient bed has its own level under it. */
interface Graph {
  context: AudioContext;
  master: GainNode;
  bed: GainNode;
}

/**
 * All of the story's sound: a looping ambient bed, three chimes and the film's own track, every one
 * decoded or routed through one master volume. Nothing plays before the gate choice; the Sound switch
 * fades everything in or out and the choice is remembered in this browser.
 */
export class Sound {
  private audio: Graph | null = null;
  private bedSource: AudioBufferSourceNode | null = null;
  private encoded = new Map<string, Promise<ArrayBuffer | null>>();
  private decoded = new Map<string, AudioBuffer>();
  private routed = new WeakSet<HTMLMediaElement>();
  private on = false;
  private filmPlaying = false;
  private readonly toggle: HTMLButtonElement;

  constructor(disposables: Disposables) {
    this.toggle = query<HTMLButtonElement>(".sh-sound");
    disposables.listen(this.toggle, "click", () => this.setEnabled(!this.on));
    disposables.listen(document, "visibilitychange", () => this.applyLevel());
    disposables.add(() => {
      this.stopBed();
      void this.audio?.context.close();
    });
    this.render();
  }

  /** The stored choice from an earlier visit, or null when this browser has not chosen yet. */
  get remembered() {
    return readPreference();
  }

  /** Fetches one sound file once; resolves when it has arrived or failed. */
  load(url: string): Promise<ArrayBuffer | null> {
    let bytes = this.encoded.get(url);
    if (!bytes) {
      bytes = fetch(url)
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .catch(() => null);
      this.encoded.set(url, bytes);
    }
    return bytes;
  }

  get files() {
    return [BED, ...Object.values(CHIMES)];
  }

  /** Must run inside a user gesture the first time (browsers only start audio from one). */
  setEnabled(on: boolean) {
    this.on = on;
    writePreference(on);
    this.render();
    if (on) {
      const { context } = this.graph();
      if (context.state === "suspended") void context.resume();
      void this.startBed();
    }
    this.applyLevel();
  }

  /** Sends a media element's sound through the master volume (the film), so the Sound switch covers it. */
  route(media: HTMLMediaElement) {
    const { context, master } = this.graph();
    if (context.state === "suspended") void context.resume();
    if (this.routed.has(media)) return;
    context.createMediaElementSource(media).connect(master);
    this.routed.add(media);
  }

  /** While the film plays, the ambient bed sits at about a third of its level. */
  filmPlays(playing: boolean) {
    this.filmPlaying = playing;
    this.applyLevel();
  }

  chime(name: Chime) {
    const audio = this.audio;
    if (!this.on || !audio) return;
    void this.buffer(audio.context, CHIMES[name]).then((buffer) => {
      if (!buffer || !this.on) return;
      const source = audio.context.createBufferSource();
      const gain = audio.context.createGain();
      gain.gain.value = CHIME_LEVEL;
      source.buffer = buffer;
      source.connect(gain).connect(audio.master);
      source.start();
    });
  }

  private graph(): Graph {
    if (!this.audio) {
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);
      const bed = context.createGain();
      bed.gain.value = BED_LEVEL;
      bed.connect(master);
      this.audio = { context, master, bed };
    }
    return this.audio;
  }

  /** Decodes a sound file once; a file that failed to load or decode leaves that sound silent. */
  private async buffer(context: AudioContext, url: string) {
    const known = this.decoded.get(url);
    if (known) return known;
    const bytes = await this.load(url);
    if (!bytes) return null;
    try {
      const buffer = await context.decodeAudioData(bytes.slice(0));
      this.decoded.set(url, buffer);
      return buffer;
    } catch {
      return null;
    }
  }

  private async startBed() {
    const audio = this.graph();
    if (this.bedSource) return;
    const buffer = await this.buffer(audio.context, BED);
    if (!buffer || this.bedSource || !this.on) return;
    const source = audio.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(audio.bed);
    source.start();
    this.bedSource = source;
  }

  private stopBed() {
    this.bedSource?.stop();
    this.bedSource = null;
  }

  private applyLevel() {
    if (!this.audio) return;
    const { context, master, bed } = this.audio;
    const ramp = (param: AudioParam, value: number) => {
      param.cancelScheduledValues(context.currentTime);
      param.setValueAtTime(param.value, context.currentTime);
      param.linearRampToValueAtTime(value, context.currentTime + FADE);
    };
    ramp(master.gain, this.on && document.visibilityState === "visible" ? 1 : 0);
    ramp(bed.gain, this.filmPlaying ? BED_UNDER_FILM : BED_LEVEL);
  }

  private render() {
    this.toggle.setAttribute("aria-checked", String(this.on));
  }
}
