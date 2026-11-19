/**
 * Real adaptive audio (DP-42). One Web Audio context, four looping stems per
 * station in sync, equal-power volume curves under half a second, and the
 * link-end fade to silence.
 */
export class AudioEngine {
    context = null;
    master = null;
    stations = new Map();
    active = null;
    muted = true;
    started = false;
    static CROSSFADE_SECONDS = 0.45;
    get running() {
        return this.context !== null && this.context.state === "running";
    }
    get isMuted() {
        return this.muted;
    }
    /** Starts the audio engine inside a user gesture (DP-01). */
    async start() {
        if (this.context) {
            if (this.context.state === "suspended") {
                await this.context.resume();
            }
            return;
        }
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.context.destination);
        this.started = true;
    }
    setMuted(muted) {
        this.muted = muted;
        if (this.master && this.context) {
            const now = this.context.currentTime;
            this.master.gain.cancelScheduledValues(now);
            this.master.gain.setValueAtTime(this.master.gain.value, now);
            this.master.gain.linearRampToValueAtTime(muted ? 0 : 1, now + 0.12);
        }
    }
    async loadStation(slug, stems) {
        if (!this.context)
            return;
        if (this.stations.has(slug))
            return;
        const buffers = new Map();
        await Promise.all(stems.map(async (stem) => {
            const response = await fetch(stem.url);
            if (!response.ok)
                return;
            const bytes = await response.arrayBuffer();
            const buffer = await this.context.decodeAudioData(bytes);
            buffers.set(stem.layer, buffer);
        }));
        if (buffers.size === 0)
            return;
        this.stations.set(slug, { slug, buffers, sources: new Map(), gains: new Map() });
    }
    /** All four of the current station's layers loop together from the start. */
    playStation(slug) {
        const station = this.stations.get(slug);
        if (!station || !this.context || !this.master)
            return;
        this.stopStation();
        this.active = station;
        const now = this.context.currentTime;
        for (const [layer, buffer] of station.buffers) {
            const source = this.context.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
            const gain = this.context.createGain();
            gain.gain.value = 0;
            source.connect(gain);
            gain.connect(this.master);
            source.start(now);
            station.sources.set(layer, source);
            station.gains.set(layer, gain);
        }
    }
    stopStation() {
        const station = this.active;
        if (!station || !this.context)
            return;
        const now = this.context.currentTime;
        for (const [layer, source] of station.sources) {
            const gain = station.gains.get(layer);
            if (gain) {
                gain.gain.cancelScheduledValues(now);
                gain.gain.setValueAtTime(gain.gain.value, now);
                gain.gain.linearRampToValueAtTime(0, now + AudioEngine.CROSSFADE_SECONDS);
            }
            try {
                source.stop(now + AudioEngine.CROSSFADE_SECONDS);
            }
            catch {
                // The source may have already stopped on its own.
            }
        }
        station.sources.clear();
        station.gains.clear();
        this.active = null;
    }
    /** Equal-power crossfade in or out over under half a second (DP-38). */
    setLayerActive(layer, active) {
        const station = this.active;
        if (!station || !this.context)
            return;
        const gain = station.gains.get(layer);
        if (!gain)
            return;
        const now = this.context.currentTime;
        const from = gain.gain.value;
        const to = active ? 1 : 0;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(from, now);
        // Equal-power curve: cos/sin quarter-circles across the change.
        const steps = 16;
        for (let step = 1; step <= steps; step += 1) {
            const t = step / steps;
            const eased = Math.sqrt(0.5 * (1 - Math.cos(Math.PI * t)));
            gain.gain.linearRampToValueAtTime(from + (to - from) * eased, now + (AudioEngine.CROSSFADE_SECONDS * t));
        }
    }
    /** The link-end fade (DP-48, DP-52): every layer fades to silence. */
    fadeToSilence(durationSeconds = 0.4) {
        const station = this.active;
        if (!station || !this.context) {
            return Promise.resolve();
        }
        const now = this.context.currentTime;
        for (const [layer, gain] of station.gains) {
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(gain.gain.value, now);
            gain.gain.linearRampToValueAtTime(0, now + durationSeconds);
        }
        return new Promise((resolve) => {
            window.setTimeout(() => {
                this.stopStation();
                resolve();
            }, durationSeconds * 1000);
        });
    }
    get hasStarted() {
        return this.started;
    }
}
