// Handy der Studierenden: Beitreten, Avatar gestalten, Antworten, Ergebnis.
// Schnell & barrierearm: kein WebGL, keine Blur-Filter, Farbe + Form + Buchstabe, aria-live, große Touch-Flächen.
import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import type { HubConnection } from "@microsoft/signalr";
import { LETTERS, LightElement, SHAPE_NAMES, Timers, connectHub, fmtInt, isDarkText, shape, store, vibrate } from "../core/util.ts";
import { COLORS, FIGURE_PARTS, norm, randomAvatar } from "../core/avatar.ts";
import { LivePreview, figureImg } from "../three/portrait.ts";
import { confetti } from "../core/confetti.ts";
import type { AvatarSpec, PlayerDirect, PlayerState } from "../core/types.ts";

const av = (a: AvatarSpec) => figureImg(a); // Porträt der 3D-Figur
interface Session { pin: string; playerId: string; }
type Screen = "connecting" | "join" | "game" | "editAvatar" | "kicked" | "lost" | "notfound";

@customElement("player-view")
export class PlayerView extends LightElement {
	@property() pin = "";
	/** Anonymer Modus (Live-Fragerunde): kein Login, kein Avatar – direkt zur Frage */
	@property({ type: Boolean }) anon = false;
	@state() private screen: Screen = "connecting";
	@state() private s: PlayerState | null = null;
	@state() private avatar: AvatarSpec = norm(store.get<AvatarSpec | null>("podium-avatar", null) ?? randomAvatar());
	@state() private nick = store.get("podium-nick", "");
	@state() private error = "";
	@state() private busy = false;
	@state() private selection = new Set<number>();
	@state() private sending = false;
	@state() private delayedReveal = false;
	// DirectMode-Eingaben
	@state() private dSel = new Set<number>();
	@state() private dNum = "";
	@state() private dText = "";
	@state() private dEditing = true;
	@state() private dError = "";
	private dId = 0;

	private conn: HubConnection | null = null;
	private shownKey = "";
	private timers = new Timers();
	private waitingText = "";

	override connectedCallback() {
		super.connectedCallback();
		document.title = "Podium – Mitspielen";
		document.body.className = "player";
		const c = this.conn = connectHub();
		c.on("state", (s: PlayerState) => this.onState(s));
		c.on("kicked", () => { store.del("podium-session"); this.s = null; this.shownKey = ""; this.screen = "kicked"; });
		c.onreconnected(() => void (this.anon ? this.audienceJoin() : this.tryRejoin()));
		c.onclose(() => { this.screen = "lost"; });
		c.start().then(() => this.anon ? this.audienceJoin() : this.tryRejoin()).catch(() => { this.screen = "lost"; });
	}

	private async audienceJoin() {
		const key = `podium-aud-${this.pin}`;
		const r = await this.conn!.invoke<{ ok: boolean; playerId?: string; error?: string; redirect?: boolean }>("AudienceJoin", this.pin, store.get<string | null>(key, null));
		if (r.ok) { store.set(key, r.playerId); return; }
		if (r.redirect) { location.hash = `#/join/${this.pin}`; location.reload(); return; }
		this.error = r.error ?? "Beitritt fehlgeschlagen";
		this.screen = "notfound";
	}
	override disconnectedCallback() { super.disconnectedCallback(); this.timers.clear(); void this.conn?.stop(); }

	private async tryRejoin() {
		const sess = store.get<Session | null>("podium-session", null);
		if (sess && (!this.pin || sess.pin === this.pin)) {
			try { if (await this.conn!.invoke<boolean>("PlayerRejoin", sess.pin, sess.playerId)) return; } catch { /* neu beitreten */ }
			store.del("podium-session");
		}
		if (!this.s) this.screen = "join";
	}

	private async join(e: Event) {
		e.preventDefault();
		const form = e.target as HTMLFormElement;
		const pin = (form.querySelector<HTMLInputElement>("#pin")?.value ?? this.pin).trim();
		const nick = form.querySelector<HTMLInputElement>("#nick")!.value.trim();
		if (!/^\d{6}$/.test(pin)) { this.error = "Die PIN hat 6 Ziffern."; return; }
		if (!nick) return;
		this.nick = nick; store.set("podium-nick", nick);
		this.busy = true; this.error = "";
		try {
			const r = await this.conn!.invoke<{ ok: boolean; playerId?: string; error?: string }>("PlayerJoin", pin, nick, this.avatar);
			if (!r.ok) { this.error = r.error ?? "Beitritt fehlgeschlagen"; return; }
			store.set("podium-session", { pin, playerId: r.playerId! });
			vibrate(30);
		} catch (err) { this.error = "Fehler: " + (err as Error).message; }
		finally { this.busy = false; }
	}

	private onState(s: PlayerState) {
		this.s = s;
		if (this.screen !== "editAvatar") this.screen = "game";
		if (s.direct && s.direct.id !== this.dId) {
			this.dId = s.direct.id; this.dSel = new Set(); this.dNum = s.direct.min != null && s.direct.max != null ? String(Math.round((s.direct.min + s.direct.max) / 2)) : "";
			this.dText = ""; this.dEditing = !s.direct.mine; this.dError = "";
		}
		const key = `${s.phase}:${s.version}:${s.answer ? "a" : "-"}`;
		if (key === this.shownKey) return;
		this.shownKey = key;
		this.timers.clear();
		const cls = s.phase === "reveal" ? (s.answer ? (s.answer.correct ? " correct" : " wrong") : " late") : "";
		document.body.className = `player ph-${s.phase}${cls}`;

		if (s.phase === "answering" && !s.answer) {
			this.selection = new Set(); this.sending = false;
			void this.updateComplete.then(() => {
				const bar = this.querySelector<HTMLElement>("#ptimerBar"); if (!bar) return;
				const total = s.question!.timeLimit * 1000;
				bar.style.transition = "none"; bar.style.transform = `scaleX(${s.remainingMs / total})`;
				this.timers.raf(() => this.timers.raf(() => { bar.style.transition = `transform ${s.remainingMs}ms linear`; bar.style.transform = "scaleX(0)"; }));
			});
		}
		if (s.phase === "answering" && s.answer) {
			const fun = ["Gespannt?", "Mal sehen …", "Daumen drücken!", "Gut gemacht – warten wir ab.", "Schnell warst du!"];
			this.waitingText = fun[Math.floor(Math.random() * fun.length)];
		}
		if (s.phase === "reveal") {
			if (s.answer?.correct) { confetti(120, 0.5, 0.35); vibrate([30, 60, 30]); } else vibrate(200);
		}
		if (s.phase === "podium") {
			this.delayedReveal = false;
			const r = s.me.rank;
			this.timers.later(r === 1 ? 7800 : r === 2 ? 3200 : r === 3 ? 1400 : 8500, () => { this.delayedReveal = true; this.celebrate(); });
		}
		if (s.phase === "final") { this.delayedReveal = true; this.celebrate(); }
	}
	private celebrate() { if (this.s && this.s.me.rank <= 3) { confetti(220, 0.5, 0.5); vibrate([50, 50, 50, 50, 200]); } }

	private tap(i: number) {
		const q = this.s?.question; if (!q || this.sending) return;
		vibrate(15);
		if (!q.multi) { this.selection = new Set([i]); void this.send(); return; }
		const sel = new Set(this.selection);
		if (sel.has(i)) sel.delete(i); else sel.add(i);
		this.selection = sel;
	}
	private async send() {
		const s = this.s; if (!s || this.sending || !this.selection.size) return;
		this.sending = true;
		try { await this.conn!.invoke("PlayerAnswer", s.pin, s.questionIndex, [...this.selection]); vibrate([20, 40, 20]); }
		catch { this.sending = false; }
	}

	private async sendDirect(d: PlayerDirect, choices: number[] | null) {
		this.dError = "";
		const num = d.kind === "number" ? parseFloat(this.dNum.replace(",", ".")) : null;
		if (d.kind === "number" && !Number.isFinite(num)) { this.dError = "Bitte eine Zahl eingeben."; return; }
		if (d.kind === "text" && !this.dText.trim()) return;
		try {
			const err = await this.conn!.invoke<string | null>("PlayerDirectAnswer", this.s!.pin, d.id, choices, num, d.kind === "text" ? this.dText.trim() : null);
			if (err) { this.dError = err; return; }
			this.dEditing = false; vibrate([20, 40, 20]);
		} catch (e) { this.dError = (e as Error).message; }
	}

	private direct(d: PlayerDirect) {
		const mine = d.mine;
		const mineView = mine ? (d.kind === "choice" ? this.chips(mine.choices ?? [])
			: html`<div class="pill" style="font-size:1.3rem">${d.kind === "number" ? `${mine.number?.toLocaleString("de-DE")}${d.unit ? " " + d.unit : ""}` : mine.text}</div>`) : nothing;
		if (!d.open) return html`<div class="pill">⚡ Direktfrage</div><div class="p-q">${d.text}</div>
			<h2>Abstimmung geschlossen</h2>${mine ? html`<p class="muted">Deine Antwort:</p>${mineView}` : html`<p class="muted">Du hast nicht abgestimmt.</p>`}
			<p>Schau auf die Leinwand!</p>`;
		if (mine && !this.dEditing) return html`<div class="pill">⚡ Direktfrage</div><div class="p-q">${d.text}</div>
			<div class="result-icon ok" aria-hidden="true">✓</div><h2>Danke!</h2>
			<p class="muted">Deine Antwort:</p>${mineView}
			<button class="btn ghost" @click=${() => {
				this.dEditing = true; this.dSel = new Set(mine.choices ?? []);
				if (mine.number != null) this.dNum = String(mine.number); if (mine.text) this.dText = mine.text;
			}}>Antwort ändern</button>`;
		const err = this.dError ? html`<div class="error" role="alert">${this.dError}</div>` : nothing;
		switch (d.kind) {
			case "choice": return html`
				<div class="pill">⚡ Direktfrage</div><div class="p-q">${d.text}</div>
				${d.multi ? html`<div class="multi-hint">☑ Mehrfachauswahl möglich</div>` : nothing}${err}
				<div class="p-tiles n${d.options.length}" role="group" aria-label="Antwortmöglichkeiten">
					${d.options.map((o, i) => html`<button class="p-tile c${i} ${isDarkText(i) ? "dark" : ""} ${this.dSel.has(i) ? "sel" : ""}"
						aria-pressed=${d.multi ? String(this.dSel.has(i)) : nothing} aria-label="${LETTERS[i]}, ${SHAPE_NAMES[i]}: ${o}"
						@click=${() => {
							vibrate(15);
							if (!d.multi) { this.dSel = new Set([i]); void this.sendDirect(d, [i]); return; }
							const n = new Set(this.dSel); if (n.has(i)) n.delete(i); else n.add(i); this.dSel = n;
						}}>
						<span class="key">${shape(i)}<b>${LETTERS[i]}</b></span><span class="txt">${o}</span></button>`)}
				</div>
				${d.multi ? html`<div class="submit-row"><button class="btn primary big" ?disabled=${!this.dSel.size} @click=${() => this.sendDirect(d, [...this.dSel])}>
					${this.dSel.size ? `Abschicken (${this.dSel.size} gewählt)` : "Antwort abschicken"}</button></div>` : nothing}`;
			case "number": {
				const slider = d.min != null && d.max != null && d.max - d.min <= 1000;
				return html`<div class="pill">⚡ Direktfrage</div><div class="p-q">${d.text}</div>${err}
					<form class="join-card glass" @submit=${(e: Event) => { e.preventDefault(); void this.sendDirect(d, null); }}>
						<label for="dnum">Deine Zahl${d.min != null || d.max != null ? ` (${d.min ?? "–∞"} bis ${d.max ?? "∞"})` : ""}</label>
						<div class="num-row"><input id="dnum" inputmode="decimal" autocomplete="off" .value=${this.dNum}
							@input=${(e: InputEvent) => { this.dNum = (e.target as HTMLInputElement).value; }}>${d.unit ? html`<span class="unit">${d.unit}</span>` : nothing}</div>
						${slider ? html`<input type="range" class="num-slider" min=${d.min!} max=${d.max!} step=${d.max! - d.min! <= 20 ? 1 : (d.max! - d.min!) / 100}
							.value=${this.dNum || String(d.min)} aria-label="Schieberegler"
							@input=${(e: InputEvent) => { this.dNum = (e.target as HTMLInputElement).value; }}>` : nothing}
						<button class="btn primary big" type="submit">Abschicken</button>
					</form>`;
			}
			case "text": return html`<div class="pill">⚡ Direktfrage</div><div class="p-q">${d.text}</div>${err}
				<form class="join-card glass" @submit=${(e: Event) => { e.preventDefault(); void this.sendDirect(d, null); }}>
					<label for="dtext">Deine Antwort (max. 60 Zeichen)</label>
					<input id="dtext" maxlength="60" autocomplete="off" .value=${this.dText} @input=${(e: InputEvent) => { this.dText = (e.target as HTMLInputElement).value; }}>
					<button class="btn primary big" type="submit" ?disabled=${!this.dText.trim()}>Abschicken</button>
				</form>`;
		}
	}

	private changePart(key: keyof AvatarSpec, d: number) {
		const part = FIGURE_PARTS.find(p => p.key === key)!;
		this.avatar = { ...this.avatar, [key]: (this.avatar[key] + d + part.names.length) % part.names.length };
		this.avatarChanged();
	}
	private randomize() { this.avatar = { ...randomAvatar(), aid: this.avatar.aid }; this.avatarChanged(); }
	private avatarChanged() { store.set("podium-avatar", this.avatar); void this.preview?.setSpec(this.avatar); }

	// Live-3D-Vorschau im Editor
	private preview: LivePreview | null = null;
	protected override updated() {
		const canvas = this.querySelector<HTMLCanvasElement>("canvas.fig-preview");
		if (canvas && !this.preview) { this.preview = new LivePreview(canvas); void this.preview.setSpec(this.avatar); }
		if (!canvas && this.preview) { this.preview.dispose(); this.preview = null; }
	}

	// ------------------------------------------------------------ Rendering
	protected override render() {
		const s = this.s;
		const showTop = !!s && this.screen === "game" && !this.anon;
		const showTimer = showTop && s!.phase === "answering" && !s!.answer;
		return html`<div class="phone">
			${showTop ? html`<div class="topbar">
				<span class="me"><span class="av">${av(s!.me.avatar)}</span><span>${s!.me.nick}</span></span>
				<span class="spacer"></span>
				<span class="score" aria-label="Punktestand">${fmtInt(s!.me.score)}</span>
			</div>` : nothing}
			${showTimer ? html`<div class="ptimer" aria-hidden="true"><i id="ptimerBar"></i></div>` : nothing}
			${keyed(this.screen === "game" ? this.shownKey : this.screen, html`<main class="view enter" aria-live="polite">${this.renderScreen()}</main>`)}
		</div>`;
	}

	private renderScreen() {
		switch (this.screen) {
			case "connecting": return html`<div class="loader" aria-label="Verbinde …"><i></i><i></i><i></i><i></i></div>`;
			case "join": return this.joinForm();
			case "editAvatar": return html`<h2>Figur ändern</h2><div class="join-card glass">${this.avatarEditor()}
				<button class="btn primary" @click=${async () => { await this.conn!.invoke("PlayerAvatar", this.s!.pin, this.avatar); this.screen = "game"; }}>Fertig</button></div>`;
			case "kicked": return html`<h2>Du wurdest aus dem Spiel entfernt.</h2><button class="btn" @click=${() => location.reload()}>Neu beitreten</button>`;
			case "lost": return html`<h2>Verbindung verloren</h2><p class="muted">Bitte Seite neu laden.</p><button class="btn" @click=${() => location.reload()}>Neu laden</button>`;
			case "notfound": return html`<div class="logo">Podi<span>um</span></div><h2>${this.error}</h2><p class="muted">Bitte den QR-Code erneut scannen.</p>`;
			case "game": return this.anon ? this.anonGame(this.s!) : this.game(this.s!);
		}
	}

	private avatarEditor() {
		return html`<div class="av-editor">
			<canvas class="fig-preview" role="img" aria-label="Vorschau deiner 3D-Figur" @click=${() => this.preview?.cheer()}></canvas>
			${FIGURE_PARTS.map(p => html`<div class="av-row">
				<button type="button" aria-label="${p.label}: vorherige" @click=${() => this.changePart(p.key, -1)}>◀</button>
				<span class="lab"><small>${p.label}</small>${p.key === "color"
					? html`<span class="swatch" style="background:${COLORS[this.avatar.color]}" aria-label=${p.names[this.avatar.color]}></span>`
					: html`<span>${p.names[this.avatar[p.key]]}</span>`}</span>
				<button type="button" aria-label="${p.label}: nächste" @click=${() => this.changePart(p.key, 1)}>▶</button>
			</div>`)}
			<button type="button" class="btn ghost av-dice" @click=${() => this.randomize()}>🎲 Zufällige Figur</button>
		</div>`;
	}

	private joinForm() {
		return html`
			<div class="logo">Podi<span>um</span></div>
			<form class="join-card glass" autocomplete="off" @submit=${(e: Event) => this.join(e)}>
				${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
				${this.pin ? nothing : html`<label for="pin">Spiel-PIN</label>
					<input id="pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="Spiel-PIN" required>`}
				<label for="nick">Dein Name</label>
				<input id="nick" maxlength="20" placeholder="Spitzname" .value=${this.nick} required>
				<label>Deine Figur</label>
				${this.avatarEditor()}
				<button class="btn primary big" type="submit" ?disabled=${this.busy}>Los geht's!</button>
			</form>`;
	}

	/** Anonyme Live-Fragerunde: nur die aktuelle Frage oder ein Warteschirm */
	private anonGame(s: PlayerState) {
		if (s.phase === "direct" && s.direct) return this.direct(s.direct);
		return html`<div class="logo">Podi<span>um</span></div>
			<h2>Warte auf die nächste Frage …</h2>
			<div class="loader" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
			<p class="muted">Sobald eine Frage gestellt wird, erscheint sie hier automatisch.</p>`;
	}

	private chips(idx: number[]) {
		return html`<div class="solution">${idx.map(i => html`<span class="chip c${i} ${isDarkText(i) ? "dark" : ""}">${shape(i)}${LETTERS[i]}</span>`)}</div>`;
	}

	private game(s: PlayerState) {
		const rankTxt = html`Du bist auf Platz <b>${s.me.rank}</b> von ${s.playerCount}`;
		const loader = html`<div class="loader" aria-hidden="true"><i></i><i></i><i></i><i></i></div>`;
		switch (s.phase) {
			case "direct": return s.direct ? this.direct(s.direct) : loader;
			case "lobby": return html`
				<div class="big-av">${av(s.me.avatar)}</div>
				<h1>Du bist dabei!</h1>
				<p class="muted">Siehst du deine Figur auf der Leinwand?<br>${s.hasQuiz ? "Gleich geht's los …" : "Warte auf die nächste Frage …"}</p>${loader}
				<button class="edit-link" @click=${() => { this.avatar = norm(s.me.avatar); this.screen = "editAvatar"; }}>Figur ändern</button>`;
			case "intro": return html`
				<div class="pill">Frage ${s.questionIndex + 1} von ${s.questionCount}</div>
				<div class="p-q">${s.question!.text}</div>
				${s.question!.multi ? html`<div class="pill multi-hint">☑ Mehrere Antworten richtig</div>` : nothing}
				${loader}<p class="muted">Mach dich bereit!</p>`;
			case "answering": {
				if (s.answer) return html`
					<div class="big-av">${av(s.me.avatar)}</div><h2>Antwort ist raus!</h2>
					<div aria-label="Deine Auswahl">${this.chips(s.answer.choices)}</div>${loader}<p class="muted">${this.waitingText}</p>`;
				const q = s.question!;
				return html`
					<div class="p-q">${q.text}</div>
					${q.multi ? html`<div class="multi-hint">☑ Wähle alle richtigen Antworten</div>` : nothing}
					<div class="p-tiles n${q.optionCount} ${this.sending ? "locked" : ""}" role="group" aria-label="Antwortmöglichkeiten">
						${q.options.map((o, i) => html`<button class="p-tile c${i} ${isDarkText(i) ? "dark" : ""} ${this.selection.has(i) ? "sel" : ""}"
							style="animation-delay:${i * 50}ms" aria-pressed=${q.multi ? String(this.selection.has(i)) : nothing}
							aria-label="${LETTERS[i]}, ${SHAPE_NAMES[i]}: ${o}" @click=${() => this.tap(i)}>
							<span class="key">${shape(i)}<b>${LETTERS[i]}</b></span><span class="txt">${o}</span></button>`)}
					</div>
					${q.multi ? html`<div class="submit-row"><button class="btn primary big" ?disabled=${!this.selection.size || this.sending} @click=${() => this.send()}>
						${this.selection.size ? `Abschicken (${this.selection.size} gewählt)` : "Antwort abschicken"}</button></div>` : nothing}`;
			}
			case "reveal": {
				const a = s.answer;
				if (!a) return html`<div class="result-icon bad" aria-hidden="true">⏰</div><h1>Zu spät!</h1>
					<p>Richtig wäre gewesen:</p>${this.chips(s.question?.correct ?? [])}<p>${rankTxt}</p>`;
				if (a.correct) return html`<div class="result-icon ok" aria-hidden="true">✓</div><h1>Richtig!</h1>
					<div class="points-chip">+${fmtInt(a.points)}</div>
					${s.me.streak >= 2 ? html`<div class="streak-chip">🔥 ${s.me.streak} richtige in Folge</div>` : nothing}
					<p>${rankTxt}</p>`;
				return html`<div class="result-icon bad" aria-hidden="true">✗</div><h1>Leider falsch</h1>
					<p>Richtig wäre gewesen:</p>${this.chips(s.question?.correct ?? [])}
					<p>${rankTxt}</p><p class="muted">Kopf hoch – nächste Runde!</p>`;
			}
			case "scoreboard": return html`
				<div class="big-av">${av(s.me.avatar)}</div>
				<div class="rank-big">${s.me.rank}.</div>
				<h2>Platz ${s.me.rank} von ${s.playerCount}</h2>
				<p>${s.ahead ? html`Nur <b>${fmtInt(s.ahead.diff)}</b> Punkte hinter <b>${s.ahead.nick}</b>!` : html`<b>Du führst!</b> 🏆`}</p>
				<p class="muted">${fmtInt(s.me.score)} Punkte · ${s.correctTotal} richtig</p>`;
			case "final": if (!s.hasQuiz) return html`<h2>Danke fürs Mitmachen!</h2>`;
			// falls durch
			case "podium": {
				if (!this.delayedReveal) return html`<h2>Siegerehrung!</h2><p>Schau auf die Leinwand …</p>${loader}`;
				const r = s.me.rank, medal = ["", "🥇", "🥈", "🥉"][r] ?? "";
				return html`
					${medal ? html`<div class="medal" aria-hidden="true">${medal}</div>` : html`<div class="big-av">${av(s.me.avatar)}</div>`}
					<div class="rank-big">${r}.</div>
					<h2>${r === 1 ? "Gewonnen! Großartig!" : r <= 3 ? "Auf dem Podest!" : `Platz ${r} von ${s.playerCount}`}</h2>
					<p>${fmtInt(s.me.score)} Punkte · ${s.correctTotal} von ${s.questionCount} richtig</p>
					<p class="muted">Danke fürs Mitspielen!</p>`;
			}
		}
	}
}
