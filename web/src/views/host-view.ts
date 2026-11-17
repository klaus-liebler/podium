// Leinwand des Dozenten: rendert alle Spielphasen, steuert 3D-Welt und Ton.
import { html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { HubConnection } from "@microsoft/signalr";
import { LETTERS, LightElement, Timers, connectHub, countUp, fmtInt, fmtSecs, optionLabel, shape } from "../core/util.ts";
import { figureImg } from "../three/portrait.ts";
import { confetti } from "../core/confetti.ts";
import { sound, type Track } from "../audio/engine.ts";
import { THEMES, createStage, type Stage, type ThemeId } from "../three/stage.ts";
import type { DirectSpec, HostDirect, HostPlayer, HostQuestion, HostState, Phase } from "../core/types.ts";
import "./direct-results.ts";
import "./direct-composer.ts";

const av = (a: HostPlayer["avatar"]) => figureImg(a); // Porträt der 3D-Figur
const ROW = 100;

@customElement("host-view")
export class HostView extends LightElement {
	@property() pin = "";
	@property() hostKey = "";
	@state() private s: HostState | null = null;
	@state() private unlocked = false;
	@state() private track: Track | null = null;
	@state() private muted = sound.muted;
	@state() private error = "";
	@state() private composer = false;
	@state() private composerError = "";
	/** Sieger-Song: wait = kommt gleich, play = läuft, intro = blendet nach dem Intro aus, done = vorbei/übersprungen */
	@state() private song: "" | "wait" | "play" | "intro" | "done" = "";
	private songGen = 0;

	private conn: HubConnection | null = null;
	private stage: Stage | null = null;
	private shownKey = "";
	private timers = new Timers();
	private prevIds = new Set<string>();

	override connectedCallback() {
		super.connectedCallback();
		document.title = "Podium – Leinwand";
		sound.onTrack = t => { this.track = t; };
		window.addEventListener("keydown", this.onKey);
		this.connect();
	}
	override disconnectedCallback() {
		super.disconnectedCallback();
		window.removeEventListener("keydown", this.onKey);
		this.timers.clear();
		void this.conn?.stop();
		sound.mood(null); sound.stopClock(); sound.stopSting(0.5);
	}

	protected override firstUpdated() {
		const canvas = this.querySelector<HTMLCanvasElement>("#stage")!;
		this.stage = new URLSearchParams(location.search).get("3d") === "0" ? null : createStage(canvas);
		if (this.stage) { this.stage.onPlayerClick = id => this.kick(id); sound.setTheme(this.stage.theme.id); }
		else canvas.remove();
		this.requestUpdate();
	}

	private connect() {
		if (!this.pin || !this.hostKey) { this.error = "Kein Spiel angegeben."; return; }
		const c = this.conn = connectHub();
		c.on("state", (s: HostState) => void this.onState(s));
		c.onreconnected(() => c.invoke("HostConnect", this.pin, this.hostKey));
		c.start().then(() => c.invoke("HostConnect", this.pin, this.hostKey)).catch(e => { this.error = "Verbindung fehlgeschlagen: " + (e as Error).message; });
	}

	private next = () => void this.conn?.invoke("HostNext", this.pin, this.hostKey);
	private finish = () => { if (confirm("Quiz jetzt beenden und zur Siegerehrung springen?")) void this.conn?.invoke("HostFinish", this.pin, this.hostKey); };
	private kick(id: string) {
		const p = this.s?.players.find(x => x.id === id);
		if (p && confirm(`„${p.nick}“ aus dem Spiel entfernen?`)) void this.conn?.invoke("HostKick", this.pin, this.hostKey, id);
	}
	private onKey = (e: KeyboardEvent) => {
		if ((e.target as HTMLElement).matches?.("input,textarea")) return;
		if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); this.querySelector<HTMLButtonElement>("[data-main]")?.click(); }
		if (e.key === "m" || e.key === "M") this.toggleMute();
		if (e.key === "f" || e.key === "F") this.toggleFull();
		if ((e.key === "d" || e.key === "D") && this.canDirect()) this.openComposer();
	};

	// ------------------------------------------------------------ DirectMode
	private canDirect() { return !!this.s && ["lobby", "reveal", "scoreboard", "final", "direct"].includes(this.s.phase); }
	private openComposer() { this.composerError = ""; this.composer = true; }
	private async submitDirect(spec: DirectSpec) {
		const err = await this.conn?.invoke<string | null>("HostDirectStart", this.pin, this.hostKey, spec);
		if (err) { this.composerError = err; return; }
		this.composer = false;
	}
	private directLive = (live: boolean) => void this.conn?.invoke("HostDirectLive", this.pin, this.hostKey, live);
	private directClose = () => void this.conn?.invoke("HostDirectClose", this.pin, this.hostKey);
	private directEnd = () => void this.conn?.invoke("HostDirectEnd", this.pin, this.hostKey);
	private async changeTheme(id: ThemeId) {
		sound.setTheme(id);
		await this.stage?.setTheme(id);
		this.requestUpdate();
	}
	private toggleMute() { sound.setMuted(!sound.muted); this.muted = sound.muted; }
	private toggleFull() { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); }
	private unlock() { this.unlocked = true; sound.ensure(); this.applyMusic(this.s?.phase, true); }

	private applyMusic(phase: Phase | undefined, initial = false) {
		if (!this.unlocked) return;
		if (phase !== "podium") sound.stopSting();
		switch (phase) {
			case "lobby": case "final": case "direct": sound.mood("lobby"); break;
			case "intro": sound.mood("question", { force: !initial, fade: 0.8 }); break;
			case "answering": sound.mood("question"); break;
			case "scoreboard": sound.mood("celebrate"); break;
		}
	}

	// ------------------------------------------------------------ Zustand
	private async onState(s: HostState) {
		const prev = this.s;
		this.s = s;
		this.stage?.setPlayers(s.players.filter(p => !p.anon).map(p => ({ id: p.id, nick: p.nick, avatar: p.avatar, answered: p.answered, connected: p.connected, lastCorrect: p.lastCorrect })));

		const key = s.phase + ":" + s.version;
		if (key === this.shownKey) {
			// gleiche Phase: nur Zähler/Listen – Lit rendert reaktiv; hier nur Effekte
			if (s.phase === "lobby" && s.players.some(p => !this.prevIds.has(p.id)) && this.unlocked) { sound.pop(); this.stage?.pulse(0.6); }
			if (s.phase === "direct" && prev?.direct && s.direct && s.direct.count > prev.direct.count && this.unlocked) sound.pop();
			if (s.phase === "answering" && prev && s.answeredCount > prev.answeredCount) {
				if (this.unlocked) sound.pop();
				const n = this.querySelector("#ansCount"); n?.classList.remove("bump"); void (n as HTMLElement | null)?.offsetWidth; n?.classList.add("bump");
			}
			this.prevIds = new Set(s.players.map(p => p.id));
			return;
		}
		this.shownKey = key;
		this.prevIds = new Set(s.players.map(p => p.id));
		this.timers.clear();
		this.song = ""; this.songGen++;
		document.body.className = `host ph-${s.phase}${this.stage ? " has3d" : ""}`;
		this.stage?.setMode(s.phase);
		this.applyMusic(s.phase);
		await this.updateComplete; // DOM der neuen Phase steht
		switch (s.phase) {
			case "intro": this.enterIntro(s); break;
			case "answering": this.enterAnswering(s); break;
			case "reveal": this.enterReveal(s); break;
			case "scoreboard": this.enterScoreboard(s); break;
			case "podium": this.enterPodium(s); break;
			case "direct":
				if (s.direct && !s.direct.open) { if (this.unlocked) sound.chime(); this.stage?.burst(200, undefined, 0.8); }
				else { if (this.unlocked) sound.whoosh(); this.stage?.warp(0.5); }
				break;
		}
	}

	// ------------------------------------------------------------ Effekte beim Betreten einer Phase
	private enterIntro(s: HostState) {
		const bar = this.querySelector<HTMLElement>("#introBar")!;
		bar.style.transition = "none"; bar.style.width = "0";
		this.timers.raf(() => this.timers.raf(() => { bar.style.transition = `width ${s.remainingMs}ms linear`; bar.style.width = "100%"; }));
		if (this.unlocked) sound.whoosh();
		this.stage?.warp(0.6);
	}

	private enterAnswering(s: HostState) {
		const total = s.question!.timeLimit * 1000;
		const deadline = performance.now() + s.remainingMs;
		if (this.unlocked) sound.startClock(deadline, total);
		const tBar = this.querySelector("#tBar")!, tNum = this.querySelector<HTMLElement>("#tNum")!, timer = this.querySelector("#timer")!;
		const C = Number(tBar.getAttribute("stroke-dasharray"));
		let lastSec = -1;
		const loop = () => {
			const rem = Math.max(0, deadline - performance.now()), frac = rem / total;
			tBar.setAttribute("stroke-dashoffset", String(C * (1 - frac)));
			const sec = Math.ceil(rem / 1000);
			if (sec !== lastSec) {
				lastSec = sec; tNum.textContent = String(sec);
				tNum.classList.remove("tick"); void tNum.offsetWidth; tNum.classList.add("tick");
				timer.classList.toggle("warn", sec <= 10 && sec > 5);
				timer.classList.toggle("hot", sec <= 5);
				this.stage?.pulse(sec <= 5 ? 1.2 : 0.5);
			}
			this.stage?.setTension(1 - frac);
			if (this.unlocked) sound.tension(1 - frac);
			if (rem > 0) this.timers.raf(loop);
		};
		loop();
	}

	private enterReveal(s: HostState) {
		if (this.unlocked) {
			sound.tapeStop();
			sound.gong();
			this.timers.later(900, () => sound.chime());
			this.timers.later(2200, () => sound.mood("lobby", { fade: 2.5 }));
		}
		this.timers.raf(() => this.timers.raf(() => this.querySelectorAll<HTMLElement>(".chart .bar").forEach(b => { b.style.height = `calc((100% - 110px) * ${Number(b.dataset.h) / 100})`; })));
		const pct = s.answeredCount ? s.correctCount / s.answeredCount : 0;
		this.timers.later(700, () => this.stage?.burst(pct >= 0.5 ? 260 : 120, undefined, pct >= 0.5 ? 1 : 0.7));
	}

	private enterScoreboard(s: HostState) {
		const top = s.players.slice(0, 5);
		const rows = this.querySelectorAll<HTMLElement>(".board .row");
		top.forEach((p, i) => {
			const row = rows[i]; if (!row) return;
			this.timers.later(900 + i * 120, () => {
				row.querySelector(".delta")?.classList.toggle("show", p.lastPoints > 0);
				countUp(row.querySelector(".sc")!, p.score - p.lastPoints, p.score, 1100);
			});
			this.timers.later(2200, () => { row.style.top = `${i * ROW}px`; });
		});
		if (this.unlocked) sound.whoosh();
		this.timers.later(2300, () => this.stage?.burst(140, undefined, 0.6));
	}

	private enterPodium(s: HostState) {
		const top3 = s.players.slice(0, 3);
		this.stage?.setPodium(Object.fromEntries(top3.map((p, i) => [i + 1, p.id])));
		if (this.unlocked) sound.mood(null, { fade: 1.2 });
		const overlays = new Map<number, { el: HTMLElement; id: string }>();
		this.querySelectorAll<HTMLElement>(".winner").forEach(el => overlays.set(Number(el.dataset.place), { el, id: el.dataset.id! }));
		const show = (place: number) => {
			const o = overlays.get(place); if (!o) return;
			this.stage?.raise(place);
			this.timers.later(this.stage ? 1700 : 400, () => o.el.classList.add("show"));
			this.querySelector<HTMLElement>(`.podium-fallback [data-col="${place}"]`)?.classList.remove("hidden");
		};
		if (top3[2]) this.timers.later(1200, () => { show(3); if (this.unlocked) sound.pop(); });
		if (top3[1]) this.timers.later(3000, () => { show(2); if (this.unlocked) sound.pop(); });
		if (top3[0] && this.unlocked && sound.hasSting("winner")) this.song = "wait";
		if (top3[0]) {
			this.timers.later(5000, async () => {
				show(1);
				this.stage?.burst(380, undefined, 1.3);
				this.timers.later(1800, () => this.stage?.rain(400));
				if (!this.stage) confetti(300, 0.5, 0.7);
				if (!this.unlocked) return;
				// optionaler Tusch, dann der Sieger-Song (ganz, nach dem Intro oder gar nicht), danach Feier-Musik
				if (this.song === "done" || this.song === "") { sound.mood("celebrate", { fade: 2 }); return; }
				const ms = sound.hasSting("tada") ? await sound.playSting("tada") + 200 : 0;
				this.timers.later(ms, async () => {
					if (this.song === "done") { sound.mood("celebrate", { fade: 2 }); return; }
					const g = this.songGen, key = this.shownKey;
					const ms2 = await sound.playSting("winner");
					if (key !== this.shownKey) { sound.stopSting(0.5); return; }                               // Phase inzwischen gewechselt
					if ((this.song as string) === "done") { sound.stopSting(1); sound.mood("celebrate", { fade: 2 }); return; } // während des Ladens weggeklickt
					if (this.song === "intro") this.scheduleIntroFade(); else this.song = "play";
					this.timers.later(ms2 + 300, () => { if (g === this.songGen) { this.song = "done"; sound.mood("celebrate", { fade: 2 }); } });
				});
			});
		}
		const place = () => {
			for (const [pl, o] of overlays) {
				let pos = this.stage?.screenPos(o.id) ?? null;
				if (!this.stage) {
					const col = this.querySelector(`.podium-fallback [data-col="${pl}"]`);
					if (col) { const r = col.getBoundingClientRect(); pos = { x: r.left + r.width / 2, y: r.top - 8 }; }
				}
				if (pos) { o.el.style.left = `${pos.x}px`; o.el.style.top = `${pos.y - 6}px`; }
			}
			this.timers.raf(place);
		};
		place();
	}

	/** Sieger-Song sofort ausblenden (vor dem Start: überspringen), danach Feier-Musik */
	private endSong = () => {
		const playing = this.song === "play" || this.song === "intro";
		this.songGen++;
		this.song = "done";
		if (!playing) return;                       // noch nicht gestartet: enterPodium spielt dann gleich celebrate
		sound.stopSting(2);
		this.timers.later(2300, () => sound.mood("celebrate", { fade: 2 }));
	};
	/** Sieger-Song nach dem Intro ausblenden (Ausblenden ab introEnd, 2 s) */
	private fadeAfterIntro = () => {
		const wasWaiting = this.song === "wait";
		this.song = "intro";
		if (!wasWaiting) this.scheduleIntroFade();  // läuft schon – sonst plant enterPodium beim Start
	};
	private scheduleIntroFade() {
		const g = ++this.songGen;
		const at = sound.stingTrack?.introEnd ?? 18;
		this.timers.later(Math.max(0, (at - sound.stingTime()) * 1000), () => { if (g === this.songGen) this.endSong(); });
	}

	// ------------------------------------------------------------ Rendering
	protected override render() {
		const s = this.s;
		const inGame = s && s.phase !== "lobby";
		const showCounter = s && ["intro", "answering", "reveal", "scoreboard"].includes(s.phase);
		return html`
			<canvas id="stage"></canvas>
			<header class="hud">
				<span class="title">${s?.quizTitle ?? ""}</span>
				${showCounter ? html`<span class="pill">Frage ${s!.questionIndex + 1} / ${s!.questionCount}</span>` : nothing}
				<span class="spacer"></span>
				${this.track ? html`<span class="now-playing"><span class="eq"><i></i><i></i><i></i></span>${this.track.title} – ${this.track.author}</span>` : nothing}
				${inGame && s!.phase !== "final" ? html`<span class="pill pin-chip">PIN <b>${s!.pin}</b></span>` : nothing}
				${this.stage ? html`<label class="theme-pick" title="3D-Welt wählen">
					<span aria-hidden="true">${this.stage.theme.icon}</span>
					<select aria-label="3D-Welt" @change=${(e: Event) => this.changeTheme((e.target as HTMLSelectElement).value as ThemeId)}>
						${THEMES.map(t => html`<option value=${t.id} ?selected=${t.id === this.stage!.theme.id}>${t.label}</option>`)}
					</select></label>` : nothing}
				<button class="icon-btn" title="Ton an/aus (M)" aria-label="Ton an/aus" @click=${() => this.toggleMute()}>${this.muted ? "🔇" : "🔊"}</button>
				<button class="icon-btn" title="Vollbild (F)" aria-label="Vollbild" @click=${() => this.toggleFull()}>⛶</button>
			</header>
			<main class="app">
				${this.error ? html`<section class="screen"><div class="card" style="padding:30px">${this.error}<br><a href="#/">Zur Übersicht</a></div></section>`
				: s ? keyed(this.shownKey || s.phase, this.renderPhase(s)) : nothing}
			</main>
			<div class="host-controls">${s ? this.renderControls(s) : nothing}</div>
			${this.composer ? html`<direct-composer .error=${this.composerError}
				@direct-submit=${(e: CustomEvent<DirectSpec>) => this.submitDirect(e.detail)} @direct-cancel=${() => { this.composer = false; }}></direct-composer>` : nothing}
			${this.unlocked || this.error ? nothing : html`<div class="unlock"><button class="btn primary big" @click=${() => this.unlock()}>▶ Leinwand starten</button></div>`}`;
	}

	private renderControls(s: HostState): TemplateResult | typeof nothing {
		const end = s.hasQuiz ? html`<button class="btn ghost" @click=${this.finish}>Beenden</button>` : nothing;
		const dq = html`<button class="btn ghost" title="Direktfrage (D)" @click=${() => this.openComposer()}>⚡ Direktfrage</button>`;
		switch (s.phase) {
			case "lobby": return s.hasQuiz
				? html`${dq}<button class="btn primary big" data-main ?disabled=${s.players.length === 0} @click=${this.next}>Los geht's ▶</button>`
				: html`<button class="btn primary big" data-main @click=${() => this.openComposer()}>⚡ Frage stellen</button>`;
			case "direct": {
				const d = s.direct!;
				return d.open
					? html`<button class="btn ghost" @click=${() => this.directLive(!d.live)}>${d.live ? "👁 Live-Anzeige aus" : "👁 Live-Anzeige an"}</button>
						<button class="btn primary" data-main @click=${this.directClose}>Abstimmung schließen ⏹</button>`
					: html`${dq}<button class="btn primary" data-main @click=${this.directEnd}>Zurück ▶</button>`;
			}
			case "intro": return html`${end}<button class="btn" data-main @click=${this.next}>Überspringen ⏭</button>`;
			case "answering": return html`${end}<button class="btn" data-main @click=${this.next}>Zeit beenden ⏹</button>`;
			case "reveal": return html`${end}${dq}<button class="btn primary" data-main @click=${this.next}>${s.isLast ? "Zur Siegerehrung 🏆" : "Zwischenstand ▶"}</button>`;
			case "scoreboard": return html`${end}${dq}<button class="btn primary" data-main @click=${this.next}>Nächste Frage ▶</button>`;
			case "podium": {
				const sg = this.song;
				const songBtns = sg === "wait" || sg === "play" || sg === "intro" ? html`
					<button class="btn ghost" @click=${this.endSong}>🔇 Lied ausblenden</button>
					<button class="btn ghost" ?disabled=${sg === "intro"} @click=${this.fadeAfterIntro}>${sg === "intro" ? "✂ blendet nach dem Intro aus" : "✂ Nach dem Intro ausblenden"}</button>` : nothing;
				return html`${songBtns}<button class="btn primary" data-main @click=${this.next}>Statistik anzeigen 📊</button>`;
			}
			case "final": return dq;
			default: return nothing;
		}
	}

	private renderPhase(s: HostState): TemplateResult {
		switch (s.phase) {
			case "lobby": return this.lobby(s);
			case "intro": return this.intro(s, s.question!);
			case "answering": return this.answering(s, s.question!);
			case "reveal": return this.reveal(s, s.question!);
			case "scoreboard": return this.scoreboard(s);
			case "podium": return this.podium(s);
			case "final": return this.final(s);
			case "direct": return this.direct(s.direct!);
		}
	}

	private lobby(s: HostState) {
		const qr = `api/qr?data=${encodeURIComponent(s.joinUrl)}`;
		return html`<section class="screen enter lobby-screen"><div class="lobby">
			<div class="join-panel glass">
				<div class="how">Mit dem Handy scannen</div>
				<a class="qr" href=${s.joinUrl} target="_blank" rel="noopener" title="Studierenden-Ansicht in neuem Tab öffnen"><img src=${qr} alt="QR-Code zum Beitreten"></a>
				<div class="how">oder <a class="join-link" href=${s.joinUrl} target="_blank" rel="noopener" title="Studierenden-Ansicht in neuem Tab öffnen">${s.joinUrl.replace(/^https?:\/\//, "")}</a> öffnen</div>
				<div class="pin-label">Spiel-PIN</div>
				<div class="pin">${s.pin.slice(0, 3)} ${s.pin.slice(3)}</div>
				${s.hasQuiz ? nothing : html`<div class="how">Live-Fragerunde: stelle spontane Fragen mit ⚡</div>`}
			</div>
			<div class="players-panel">
				<div class="players-head">
					<div class="count">${s.players.length}<small>Teilnehmende</small></div>
					<div class="wait">${s.players.length ? (this.stage && s.hasQuiz ? "Klicke auf eine Figur, um sie zu entfernen" : "")
						: html`Warte auf Mitspielende<span class="dots"><span>.</span><span>.</span><span>.</span></span>`}</div>
				</div>
				<div class="player-cloud">${this.stage ? nothing : s.players.map(p => html`
					<div class="p-bubble ${p.connected ? "" : "off"}" title="Klicken zum Entfernen" @click=${() => this.kick(p.id)}>
						<span class="av">${av(p.avatar)}</span>${p.nick}</div>`)}</div>
			</div>
		</div></section>`;
	}

	private intro(s: HostState, q: HostQuestion) {
		return html`<section class="screen enter intro">
			<div class="pill q-counter">Frage ${s.questionIndex + 1} von ${s.questionCount}</div>
			<div class="card question-card">${q.text}</div>
			<div class="meta">
				<span class="pill">⏱ ${q.timeLimit} Sekunden</span>
				${q.multi ? html`<span class="pill">☑ Mehrere Antworten richtig</span>` : nothing}
				${q.points === 2 ? html`<span class="pill">✦ Doppelte Punkte</span>` : q.points === 0 ? html`<span class="pill">Ohne Punkte</span>` : nothing}
			</div>
			<div class="intro-bar"><i id="introBar"></i></div>
		</section>`;
	}

	private tiles(q: HostQuestion, reveal = false) {
		return html`<div class="tiles n${q.options.length}">${q.options.map((o, i) => html`
			<div class="tile c${i} ${reveal ? (o.correct ? "right" : "dim") : ""}" style="animation-delay:${i * 70}ms" aria-label="${optionLabel(i)}: ${o.text}">
				<span class="key">${shape(i)}<b>${LETTERS[i]}</b></span><span class="txt">${o.text}</span>
				${reveal ? html`<span class="mark">${o.correct ? "✓" : "✗"}</span>` : nothing}
			</div>`)}</div>`;
	}

	private answering(s: HostState, q: HostQuestion) {
		const R = 54, C = 2 * Math.PI * R;
		return html`<section class="screen enter answering">
			<div class="card question-card">${q.text}</div>
			<div class="mid-row">
				<div class="answer-count"><div class="n" id="ansCount">${s.answeredCount}</div><div class="l">von ${s.connectedCount} Antworten</div></div>
				<div class="timer" id="timer">
					<svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r=${R} fill="none" stroke-width="10"/>
					<circle class="bar" id="tBar" cx="60" cy="60" r=${R} fill="none" stroke-width="10" stroke-dasharray=${C} stroke-dashoffset="0"/></svg>
					<div class="num" id="tNum"></div>
				</div>
				<div class="side-info">${q.multi ? html`<span class="pill">☑ ${q.correctCount} Antworten richtig</span>` : html`<span class="pill">Eine Antwort richtig</span>`}</div>
			</div>
			${this.tiles(q)}
		</section>`;
	}

	private reveal(s: HostState, q: HostQuestion) {
		const dist = s.distribution ?? [];
		const max = Math.max(1, ...dist);
		const pct = s.answeredCount ? Math.round(100 * s.correctCount / s.answeredCount) : 0;
		return html`<section class="screen enter reveal">
			<div class="card question-card">${q.text}</div>
			<div class="chart">${q.options.map((o, i) => html`
				<div class="col ${o.correct ? "right" : "wrong"}" aria-label="${optionLabel(i)}: ${dist[i]} Stimmen${o.correct ? ", richtig" : ""}">
					<div class="val">${dist[i]}</div>
					<div class="bar c${i}" data-h=${(dist[i] / max) * 100}></div>
					<div class="lbl c${i}">${shape(i)}</div>
				</div>`)}</div>
			<div class="stat-row">
				<span class="pill">✓ ${s.correctCount} von ${s.players.length} richtig (${pct} %)</span>
				<span class="pill">⏱ Ø ${fmtSecs(s.avgMs)} s</span>
			</div>
			${this.tiles(q, true)}
		</section>`;
	}

	private scoreboard(s: HostState) {
		const top = s.players.slice(0, 5);
		const byPrev = [...top].sort((a, b) => a.prevRank - b.prevRank);
		return html`<section class="screen enter scoreboard">
			<h1>Zwischenstand</h1>
			<div class="board" style="height:${top.length * ROW}px">
				${top.length ? top.map((p, i) => {
					const climbed = p.prevRank - p.rank;
					return html`<div class="row r${p.rank}" style="top:${byPrev.indexOf(p) * ROW}px;animation-delay:${i * 90}ms">
						<span class="rk">${p.rank}</span><span class="av">${av(p.avatar)}</span>
						<span class="nm">${p.nick}</span>
						${p.streak >= 2 ? html`<span class="streak" title="Serie">🔥 ${p.streak}</span>` : nothing}
						${climbed > 0 ? html`<span class="up">▲ ${climbed}</span>` : nothing}
						<span class="delta">+${p.lastPoints}</span>
						<span class="sc">${fmtInt(p.score - p.lastPoints)}</span>
					</div>`;
				}) : html`<div class="pill">Noch keine Teilnehmenden</div>`}
			</div>
		</section>`;
	}

	private podium(s: HostState) {
		const top3 = s.players.slice(0, 3);
		const colors = ["", "#e8b923", "#a9b4c8", "#c0703c"], heights = [0, 34, 24, 16], order = [0, 2, 1, 3];
		return html`<section class="screen enter podium-screen">
			<h1>Siegerehrung</h1>
			${this.stage ? nothing : html`<div class="podium-fallback">${top3.map((_, i) => html`
				<div class="hidden" data-col=${i + 1} style="height:${heights[i + 1]}vh;background:${colors[i + 1]};order:${order[i + 1]}">${i + 1}</div>`)}</div>`}
			${top3.map((p, i) => html`<div class="winner p${i + 1}" data-place=${i + 1} data-id=${p.id}>
				${i === 0 ? html`<div class="crown">👑</div>` : nothing}
				${this.stage ? nothing : html`<div class="av">${av(p.avatar)}</div><div class="nm">${p.nick}</div>`}
				<div class="sc">${fmtInt(p.score)} Punkte</div>
			</div>`)}
		</section>`;
	}

	private final(s: HostState) {
		const st = s.stats ?? { questions: [] };
		return html`<section class="screen enter final">
			<div class="final-grid">
				<div class="glass panel">
					<h2>Rangliste</h2>
					<table class="rank-table">${s.players.map(p => html`
						<tr><td class="num">${p.rank}.</td><td><span class="av" style="display:inline-block">${av(p.avatar)}</span></td>
						<td>${p.nick}</td><td class="num">${p.correctTotal}/${s.questionCount} ✓</td><td class="num"><b>${fmtInt(p.score)}</b></td></tr>`)}
					</table>
				</div>
				<div class="glass panel">
					<h2>Fragen im Überblick</h2>
					<div class="q-stats">${st.questions.map((q, i) => {
						const pct = q.players ? Math.round(100 * q.correct / q.players) : 0;
						const max = Math.max(1, ...q.distribution);
						return html`<div class="q-stat">
							<div class="qt">${i + 1}. ${q.text}</div>
							<div class="meter"><i style="width:${pct}%"></i></div>
							<div class="info"><span>${pct} % richtig (${q.correct}/${q.players})</span><span>Ø ${fmtSecs(q.avgMs)} s</span></div>
							<div class="mini">${q.distribution.map((d, j) => html`<span class="c${j} ${q.options[j].correct ? "ok" : ""}" style="height:${(d / max) * 100}%"
								title="${optionLabel(j)}: ${q.options[j].text} – ${d}"></span>`)}</div>
						</div>`;
					})}</div>
				</div>
			</div>
			<div class="final-actions">
				<button class="btn" @click=${() => this.csv(s)}>⬇ Ergebnisse als CSV</button>
				<a class="btn ghost" href="#/" style="text-decoration:none">Zur Übersicht</a>
			</div>
		</section>`;
	}

	private direct(d: HostDirect) {
		const kind = { choice: d.multi ? "Mehrfachauswahl" : "Auswahl", number: "Zahl", text: "Word Cloud" }[d.kind];
		const qr = !this.s!.hasQuiz && d.open;
		return html`<section class="screen enter direct ${qr ? "has-qr" : ""}">
			<div class="dr-top">
				<span class="pill">⚡ Direktfrage · ${kind}</span>
				<span class="pill ${d.open ? "live-dot" : ""}">${d.open ? "Abstimmung läuft" : "Abstimmung geschlossen"}</span>
				<span class="pill"><b>${d.count}</b>&nbsp;${d.count === 1 ? "Antwort" : "Antworten"}</span>
			</div>
			<div class="card question-card">${d.text}</div>
			<div class="dr-area glass"><direct-results .d=${d}></direct-results></div>
			${!qr ? nothing : html`<div class="dr-qr" title="Jetzt noch mitmachen">
				<img src="api/qr?data=${encodeURIComponent(this.s!.joinUrl)}" alt="QR-Code zur Antwortseite">
				<span>PIN <b>${this.s!.pin}</b></span></div>`}
		</section>`;
	}

	private csv(s: HostState) {
		const rows = [["Rang", "Name", "Punkte", "Richtig"], ...s.players.map(p => [p.rank, p.nick, p.score, p.correctTotal])];
		const csv = "﻿" + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
		const a = document.createElement("a");
		a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
		a.download = `podium-${s.quizTitle.replace(/[^\w-]+/g, "_")}-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
	}
}
