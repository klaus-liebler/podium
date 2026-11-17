// Audio-Engine für die Leinwand.
//  * Musik: echte CC0-Stücke (public/music/tracks.json) mit Crossfade zwischen zwei "Decks".
//  * Stoppuhr: unabhängig synthetisiertes Tick-Tack, sekundengenau zur Restzeit, gegen Ende dringlicher (+ Herzschlag).
//  * Spannung: Musik zum Ende hin leicht schneller (tonhöhentreu) und heller; bei Zeitablauf "Tape-Stop".
//  * Stings: "Tadaaa"-Fanfare (Trompeten/Posaunen, CC0-Dateien) für Platz 1, danach Sieger-Fanfare.
//  * Effekte: Pop, Whoosh, Gong, Glocken, Trommelwirbel, Ersatz-Fanfare – synthetisch.
//  * Fallback: generativer Lo-Fi, falls keine Musikdateien geladen werden können.
import { store } from "../core/util.ts";

export type Mood = "lobby" | "question" | "celebrate";
/** start/end (Sekunden) schneiden einen Ausschnitt aus, z. B. den Höhepunkt einer längeren Fanfare */
export interface Track { file: string; title: string; author: string; url?: string; start?: number; end?: number; }
type Kind = Mood | "tada" | "winner";
type TrackList = Partial<Record<Kind, Track[]>> & { themes?: Record<string, Partial<Record<Kind, Track[]>>> };

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const MUSIC = "music/";

class Deck {
	readonly audio = new Audio();
	readonly gain: GainNode;
	private pauseTimer = 0;
	constructor(private e: AudioEngine, out: AudioNode, onEnded: (d: Deck) => void) {
		this.audio.preload = "auto";
		const src = e.ctx!.createMediaElementSource(this.audio);
		this.gain = e.ctx!.createGain();
		this.gain.gain.value = 0;
		src.connect(this.gain).connect(out);
		this.audio.addEventListener("ended", () => onEnded(this));
	}
	private endTimer = 0;
	play(track: Track, fade: number, level = 1) {
		const t = this.e.ctx!.currentTime;
		clearTimeout(this.pauseTimer); clearTimeout(this.endTimer);
		this.audio.onerror = () => this.e.trackFailed(track, this);
		this.audio.src = MUSIC + track.file;
		this.audio.playbackRate = 1;
		this.audio.preservesPitch = true;
		const start = track.start ?? 0;
		const seek = () => { if (start) this.audio.currentTime = start; };
		if (this.audio.readyState >= 1) seek(); else this.audio.addEventListener("loadedmetadata", seek, { once: true });
		if (track.end != null) {
			const len = (track.end - start) * 1000;
			this.endTimer = window.setTimeout(() => { this.fadeOut(0.8); this.audio.dispatchEvent(new Event("ended")); }, Math.max(500, len - 800));
		}
		this.audio.play().catch(err => { if ((err as DOMException).name !== "AbortError") this.e.trackFailed(track, this); });
		this.gain.gain.cancelScheduledValues(t);
		this.gain.gain.setValueAtTime(this.gain.gain.value, t);
		this.gain.gain.linearRampToValueAtTime(level, t + fade);
	}
	fadeOut(fade: number) {
		clearTimeout(this.endTimer);
		const t = this.e.ctx!.currentTime;
		this.gain.gain.cancelScheduledValues(t);
		this.gain.gain.setValueAtTime(this.gain.gain.value, t);
		this.gain.gain.linearRampToValueAtTime(0, t + fade);
		clearTimeout(this.pauseTimer);
		this.pauseTimer = window.setTimeout(() => this.audio.pause(), fade * 1000 + 100);
	}
}

interface Clock { deadline: number; total: number; nextRem?: number; }

export class AudioEngine {
	ctx: AudioContext | null = null;
	muted = store.get("podium-muted", false);
	musicVolume = 0.7;
	onTrack: ((t: Track) => void) | null = null;

	private tracks: TrackList | null = null;
	private pendingMood: Mood | null | undefined;
	private currentMood: Mood | null = null;
	private lastFile: Partial<Record<string, string>> = {};
	private bad = new Set<string>();
	private themeId = "";
	private decks: Deck[] = [];
	private active: Deck | null = null;
	private sting: Deck | null = null;
	private synth: LofiSynth | null = null;
	private clock: Clock | null = null;
	private clockTimer = 0;

	// Knoten
	private comp!: DynamicsCompressorNode; private master!: GainNode; musicIn!: GainNode;
	private musicFilter!: BiquadFilterNode; private musicGain!: GainNode; sfxBus!: GainNode;
	private clockBus!: GainNode; revSend!: GainNode; private noise!: AudioBuffer;

	ensure() {
		if (this.ctx) { if (this.ctx.state === "suspended") void this.ctx.resume(); return; }
		const ctx = this.ctx = new AudioContext();
		this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -12; this.comp.ratio.value = 3;
		this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 1;
		this.comp.connect(this.master).connect(ctx.destination);

		this.musicIn = ctx.createGain();
		this.musicFilter = ctx.createBiquadFilter(); this.musicFilter.type = "lowpass"; this.musicFilter.frequency.value = 18000; this.musicFilter.Q.value = 0.6;
		this.musicGain = ctx.createGain(); this.musicGain.gain.value = this.musicVolume;
		this.musicIn.connect(this.musicFilter).connect(this.musicGain).connect(this.comp);

		this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.85; this.sfxBus.connect(this.comp);
		this.clockBus = ctx.createGain(); this.clockBus.gain.value = 0; this.clockBus.connect(this.comp);

		const reverb = ctx.createConvolver();
		const len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
		for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
		reverb.buffer = ir;
		this.revSend = ctx.createGain(); this.revSend.gain.value = 0.3; this.revSend.connect(reverb).connect(this.comp);

		this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
		const nd = this.noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

		const onEnded = (d: Deck) => { if (d === this.active) this.nextTrack(); };
		this.decks = [new Deck(this, this.musicIn, onEnded), new Deck(this, this.musicIn, onEnded)];
		this.sting = new Deck(this, this.sfxBus, () => { });
		void this.loadTracks();
	}

	private async loadTracks() {
		try { this.tracks = await (await fetch(MUSIC + "tracks.json", { cache: "no-cache" })).json(); }
		catch { this.tracks = {}; }
		if (this.pendingMood !== undefined) { const m = this.pendingMood; this.pendingMood = undefined; this.mood(m); }
	}

	setMuted(m: boolean) {
		this.muted = m; store.set("podium-muted", m);
		if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
	}

	/** Musik passend zur 3D-Welt (tracks.json "themes") */
	setTheme(id: string) {
		if (id === this.themeId) return;
		this.themeId = id;
		if (this.currentMood && this.tracks?.themes?.[id]?.[this.currentMood]) this.mood(this.currentMood, { force: true, fade: 2 });
	}
	trackFailed(track: Track, deck: Deck) {
		if (this.bad.has(track.file)) return;
		this.bad.add(track.file);
		console.warn("Musikdatei fehlt/defekt:", track.file);
		if (deck === this.active && this.currentMood) this.mood(this.currentMood, { force: true, fade: 0.3 });
	}
	private listFor(kind: Kind): Track[] {
		const ok = (l?: Track[]) => (l ?? []).filter(t => !this.bad.has(t.file));
		const themed = ok(this.tracks?.themes?.[this.themeId]?.[kind]);
		return themed.length ? themed : ok(this.tracks?.[kind]);
	}
	private pick(list: Track[] | undefined, key: string): Track | null {
		if (!list?.length) return null;
		let choices = list.filter(t => t.file !== this.lastFile[key]);
		if (!choices.length) choices = list;
		const t = choices[Math.floor(Math.random() * choices.length)];
		this.lastFile[key] = t.file;
		return t;
	}

	// ------------------------------------------------------------ Musik
	/** Stimmung wechseln; null = Stille. force = neues Stück auch bei gleicher Stimmung. */
	mood(name: Mood | null, { fade = 1.6, force = false } = {}) {
		this.ensure();
		if (!this.tracks) { this.pendingMood = name; return; }
		if (name === this.currentMood && !force && this.active && !this.active.audio.paused) return;
		this.currentMood = name;
		this.resetTension(0.4);
		if (!name) { this.active?.fadeOut(fade); this.active = null; this.synth?.stop(); return; }
		const track = this.pick(this.listFor(name), name);
		if (!track) return this.fallback(name);
		const next = this.active === this.decks[0] ? this.decks[1] : this.decks[0];
		this.active?.fadeOut(fade);
		next.play(track, fade);
		this.active = next;
		this.synth?.stop();
		this.onTrack?.(track);
	}
	private nextTrack() { if (this.currentMood) this.mood(this.currentMood, { fade: 0.5, force: true }); }

	fallback(name?: Mood | null) {
		this.synth ??= new LofiSynth(this);
		this.synth.start(name || this.currentMood || "lobby");
		this.onTrack?.({ file: "", title: "Generativer Lo-Fi", author: "Podium" });
	}

	/** Spannung 0..1 während der Antwortzeit */
	tension(x: number) {
		if (!this.ctx) return;
		x = Math.max(0, Math.min(1, x));
		const t = this.ctx.currentTime;
		if (this.active) { this.active.audio.preservesPitch = true; this.active.audio.playbackRate = 1 + 0.07 * x * x; }
		this.musicFilter.frequency.setTargetAtTime(2600 + 15000 * x * x, t, 0.3);
		this.musicGain.gain.setTargetAtTime(this.musicVolume * (1 - 0.35 * Math.max(0, (x - 0.75) / 0.25)), t, 0.3);
	}
	resetTension(tc = 0.3) {
		if (!this.ctx) return;
		const t = this.ctx.currentTime;
		if (this.active) this.active.audio.playbackRate = 1;
		this.musicFilter.frequency.setTargetAtTime(18000, t, tc);
		this.musicGain.gain.setTargetAtTime(this.musicVolume, t, tc);
	}

	/** Zeit abgelaufen: Musik "leiert" aus wie ein gestoppter Plattenspieler */
	tapeStop() {
		this.stopClock();
		const deck = this.active;
		this.currentMood = null;
		this.active = null;
		if (!deck) { this.synth?.stop(); return; }
		const a = deck.audio;
		a.preservesPitch = false;
		let r = a.playbackRate;
		const iv = setInterval(() => {
			r *= 0.86; a.playbackRate = Math.max(0.0625, r);
			if (r < 0.15) { clearInterval(iv); a.pause(); a.playbackRate = 1; a.preservesPitch = true; }
		}, 40);
		deck.fadeOut(0.7);
		this.resetTension(0.1);
	}

	/** Gibt es für diesen Tusch ein (ladbares) Stück in tracks.json? */
	hasSting(kind: "tada" | "winner") { return !!this.tracks && this.listFor(kind).length > 0; }
	/** Laufenden Tusch/Sieger-Song ausblenden (z. B. beim Weiterklicken) */
	stopSting(fade = 1.2) { if (this.sting && !this.sting.audio.paused) this.sting.fadeOut(fade); }

	/** Kurzer Musik-Tusch ("tada" oder "winner"). Liefert die Dauer in ms (geschätzt, falls Metadaten fehlen). */
	playSting(kind: "tada" | "winner"): Promise<number> {
		this.ensure();
		const track = this.tracks ? this.pick(this.listFor(kind), kind) : null;
		if (!track || !this.sting) { if (kind === "tada") this.fanfare(); return Promise.resolve(2500); }
		this.sting.play(track, 0.01, 1);
		this.onTrack?.(track);
		return new Promise(res => {
			const a = this.sting!.audio;
			const done = () => res(track.end != null ? (track.end - (track.start ?? 0)) * 1000 : isFinite(a.duration) ? a.duration * 1000 : 3000);
			if (a.readyState >= 1) done(); else a.addEventListener("loadedmetadata", done, { once: true });
			a.addEventListener("error", () => { this.fanfare(); res(2500); }, { once: true });
		});
	}

	// ------------------------------------------------------------ Stoppuhr
	startClock(deadlinePerf: number, totalMs: number) {
		this.ensure(); this.stopClock();
		this.clock = { deadline: deadlinePerf, total: totalMs };
		this.clockBus.gain.setTargetAtTime(1, this.ctx!.currentTime, 0.2);
		this.clockTimer = window.setInterval(() => this.clockTick(), 50);
		this.clockTick();
	}
	stopClock() {
		clearInterval(this.clockTimer); this.clock = null;
		if (this.ctx) this.clockBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
	}
	private clockTick() {
		const c = this.clock; if (!c) return;
		const remaining = c.deadline - performance.now(), nowCtx = this.ctx!.currentTime;
		if (remaining <= 0) { this.stopClock(); return; }
		// Ticks auf ganzen (und in den letzten 5 s auch halben) Sekunden der Restzeit, 300 ms vorausgeplant
		c.nextRem ??= Math.floor((remaining - 1) / 500) * 500;
		while (c.nextRem > 0 && remaining - c.nextRem < 300) {
			const rem = c.nextRem, half = rem % 1000 !== 0;
			if (!half || rem <= 5000) this.clickSound(nowCtx + Math.max(0, remaining - rem) / 1000, rem / 1000, half);
			c.nextRem -= 500;
		}
	}
	private clickSound(t: number, secs: number, half: boolean) {
		const urgent = secs <= 5, mid = secs <= 10, tock = Math.round(secs) % 2 === 0;
		const vol = (half ? 0.5 : 1) * (urgent ? 0.42 : mid ? 0.26 : 0.15);
		const freq = urgent ? (tock ? 1900 : 2300) : (tock ? 1250 : 1600);
		const o = this.tone("sine", freq, t, vol, 0.07, this.clockBus);
		o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.7, t + 0.05);
		this.noiseHit(t, "bandpass", freq * 2, 3, vol * 0.5, 0.025, this.clockBus);
		if (urgent && !half) { // tiefer Herzschlag
			const k = this.tone("sine", 90, t, 0.45, 0.25, this.clockBus);
			k.frequency.setValueAtTime(90, t); k.frequency.exponentialRampToValueAtTime(45, t + 0.12);
		}
	}

	// ------------------------------------------------------------ Effekte
	private now() { this.ensure(); return this.ctx!.currentTime + 0.01; }
	noiseHit(t: number, type: BiquadFilterType, freq: number, q: number, vel: number, decay: number, bus?: AudioNode) {
		const c = this.ctx!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
		s.buffer = this.noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
		s.connect(f).connect(g).connect(bus ?? this.sfxBus);
		g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
		s.start(t, Math.random() * 1.5); s.stop(t + decay + 0.05);
	}
	tone(type: OscillatorType, f: number, t: number, vel: number, decay: number, bus?: AudioNode, rev = false) {
		const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
		o.type = type; o.frequency.value = f; o.connect(g); g.connect(bus ?? this.sfxBus); if (rev) g.connect(this.revSend);
		g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
		o.start(t); o.stop(t + decay + 0.05);
		return o;
	}
	pop() {
		const t = this.now(), base = 500 + Math.random() * 500;
		const o = this.tone("sine", base, t, 0.22, 0.16);
		o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * 2.3, t + 0.08);
	}
	whoosh() {
		const t = this.now(), c = this.ctx!, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
		s.buffer = this.noise; f.type = "bandpass"; f.Q.value = 1.4;
		f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(5000, t + 0.4);
		s.connect(f).connect(g).connect(this.sfxBus);
		g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3, t + 0.18); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
		s.start(t); s.stop(t + 0.55);
	}
	gong() {
		const t = this.now();
		[98, 196, 262, 311, 392, 523].forEach((f, i) => this.tone("sine", f * (1 + (Math.random() - 0.5) * 0.004), t, 0.16 / (i + 1) + 0.03, 2.8, undefined, true));
		this.noiseHit(t, "lowpass", 900, 0.5, 0.3, 0.4);
	}
	private bell(m: number, t: number, vel: number) { this.tone("sine", mtof(m), t, vel, 1.3, undefined, true); this.tone("sine", mtof(m) * 3.01, t, vel * 0.18, 0.6, undefined, true); }
	chime() { const t = this.now(); [72, 76, 79, 84].forEach((n, i) => this.bell(n, t + i * 0.09, 0.17)); }
	drumroll(seconds: number) {
		const t0 = this.now(), hits = Math.floor(seconds * 22);
		for (let i = 0; i < hits; i++) this.noiseHit(t0 + i / 22 + (Math.random() - 0.5) * 0.006, "bandpass", 1900, 0.7, 0.16 * (0.2 + 0.8 * i / hits), 0.07);
		const k = this.tone("sine", 110, t0 + seconds, 0.9, 0.5);
		k.frequency.setValueAtTime(110, t0 + seconds); k.frequency.exponentialRampToValueAtTime(40, t0 + seconds + 0.2);
		this.noiseHit(t0 + seconds, "highpass", 4000, 0.4, 0.35, 1.4);
	}
	/** synthetische Ersatz-Fanfare */
	fanfare() {
		const t = this.now();
		([[65, 0], [69, 0.14], [72, 0.28]] as const).forEach(([n, dt]) => this.brass(n, t + dt, 0.2, 1));
		[53, 65, 69, 72, 77].forEach(n => this.brass(n, t + 0.42, 1.8, 0.6));
	}
	private brass(m: number, t: number, dur: number, vel: number) {
		const c = this.ctx!, f = c.createBiquadFilter(), g = c.createGain();
		f.type = "lowpass"; f.frequency.setValueAtTime(600, t); f.frequency.linearRampToValueAtTime(2800, t + 0.08); f.frequency.exponentialRampToValueAtTime(1200, t + dur);
		[0, 9].forEach(det => { const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = mtof(m); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.3); });
		f.connect(g); g.connect(this.sfxBus); g.connect(this.revSend);
		g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07 * vel, t + 0.03); g.gain.setValueAtTime(0.06 * vel, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
	}
}

// ---------------------------------------------------------------- Fallback: generativer Lo-Fi
class LofiSynth {
	private timer = 0; private step = 0; private bar = 0; private next = 0;
	private bus: GainNode | null = null;
	private prog: [number, number[]][] = [];
	private bpm = 76;
	constructor(private e: AudioEngine) { }
	start(mood: Mood) {
		const e = this.e, ctx = e.ctx!;
		if (mood === "question") { this.bpm = 86; this.prog = [[38, [53, 57, 60, 64]], [46, [57, 60, 62, 65]], [43, [53, 57, 58, 62]], [45, [55, 57, 62, 64]]]; }
		else if (mood === "celebrate") { this.bpm = 96; this.prog = [[41, [57, 60, 64, 69]], [43, [59, 62, 64, 67]], [45, [60, 64, 67, 69]], [48, [60, 64, 67, 72]]]; }
		else { this.bpm = 76; this.prog = [[41, [57, 60, 64, 67]], [40, [55, 59, 62, 64]], [38, [53, 57, 60, 64]], [46, [57, 60, 62, 65]]]; }
		if (this.timer) return;
		this.bus = ctx.createGain(); this.bus.gain.value = 0.9; this.bus.connect(e.musicIn);
		this.next = ctx.currentTime + 0.05;
		this.timer = window.setInterval(() => {
			while (this.next < ctx.currentTime + 0.15) {
				const d = 60 / this.bpm / 4, s = this.step, t = this.next + (s % 2 ? d * 0.14 : 0);
				const [bass, chord] = this.prog[this.bar % 4];
				const bus = this.bus!;
				if (s === 0 || s === 7 || s === 10) { const k = e.tone("sine", 100, t, 0.5, 0.35, bus); k.frequency.exponentialRampToValueAtTime(42, t + 0.14); }
				if (s === 4 || s === 12) e.noiseHit(t, "bandpass", 1700, 0.8, 0.14, 0.18, bus);
				if (s % 2 === 0) e.noiseHit(t, "highpass", 7500, 0.6, 0.03, 0.04, bus);
				if (s === 0 || s === 10) chord.forEach((n, i) => e.tone("sine", mtof(n), t + i * 0.018, s ? 0.04 : 0.065, d * (s ? 5 : 9), bus, true));
				if (s === 0) e.tone("triangle", mtof(bass), t, 0.2, d * 8, bus);
				this.next += d; this.step = (s + 1) % 16; if (this.step === 0) this.bar++;
			}
		}, 25);
	}
	stop() {
		clearInterval(this.timer); this.timer = 0;
		if (this.bus) { this.bus.gain.setTargetAtTime(0, this.e.ctx!.currentTime, 0.3); this.bus = null; }
	}
}

export const sound = new AudioEngine();
