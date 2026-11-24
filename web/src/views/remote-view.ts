// Fernbedienung (#/remote/<pin>): steuert die Leinwand vom Handy der Lehrperson aus.
// Zeigt Stand, richtige Antwort, eigene Notizen und die nächste Frage. Der Host-Schlüssel kommt nur über die Anmeldung
// als Besitzer·in (api/games/<pin>/remote) – ein QR-Code auf der Leinwand reicht also nicht zum Steuern.
import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HubConnection } from "@microsoft/signalr";
import { LightElement, connectHub, fmtNum, vibrate } from "../core/util.ts";
import { ApiError, api, getMe } from "../core/session.ts";
import type { DirectSpec, HostState } from "../core/types.ts";
import { mdPlain } from "../core/markdown.ts";
import "./direct-composer.ts";

interface Solution { kind: string; correct: string[]; value: number | null; tolerance: number; unit: string; }
const PHASE: Record<string, string> = { lobby: "Warteraum", intro: "Frage wird gezeigt", answering: "Antwortzeit läuft", reveal: "Lösung", scoreboard: "Zwischenstand", podium: "Siegerehrung", final: "Statistik", direct: "Direktfrage" };

@customElement("remote-view")
export class RemoteView extends LightElement {
	@property() pin = "";
	@state() private s: HostState | null = null;
	@state() private error = "";
	@state() private composer = false;
	@state() private composerError = "";
	@state() private muted = false;
	private key = "";
	private solutions: Solution[] = [];
	private conn: HubConnection | null = null;

	override connectedCallback() {
		super.connectedCallback();
		document.body.className = "teacher remote";
		document.title = `Podium – Fernbedienung ${this.pin}`;
		void this.start();
	}
	override disconnectedCallback() { super.disconnectedCallback(); void this.conn?.stop(); }

	private async start() {
		if (!await getMe()) return; // api() leitet zur Anmeldung um und kommt danach hierher zurück
		try {
			const r = await api<{ hostKey: string; solutions: Solution[] }>(`games/${encodeURIComponent(this.pin)}/remote`);
			this.key = r.hostKey; this.solutions = r.solutions;
		} catch (e) {
			if ((e as ApiError).status !== 401) this.error = "Diesen Raum gibt es nicht (mehr) oder er gehört nicht zu deinem Konto.";
			return;
		}
		const c = this.conn = connectHub();
		c.on("state", (s: HostState) => { if (this.s && s.phase !== this.s.phase) vibrate(20); this.s = s; });
		c.onreconnected(() => c.invoke("HostConnect", this.pin, this.key));
		c.onclose(() => { this.error = "Verbindung getrennt – Seite neu laden."; });
		try { await c.start(); await c.invoke("HostConnect", this.pin, this.key); }
		catch (e) { this.error = "Verbindung fehlgeschlagen: " + (e as Error).message; }
	}
	private call(method: string, ...args: unknown[]) { vibrate(15); return this.conn?.invoke(method, this.pin, this.key, ...args); }
	private cmd(c: string) { return this.call("HostCommand", c); }
	private async direct(spec: DirectSpec) {
		const err = await this.call("HostDirectStart", spec) as string | null;
		if (err) { this.composerError = err; return; }
		this.composer = false;
	}

	protected override render() {
		const s = this.s;
		if (this.error) return html`<main class="remote-main"><h1>📱 Fernbedienung</h1><div class="msg err">${this.error}</div><a class="button" href="#/">Zur Übersicht</a></main>`;
		if (!s) return html`<main class="remote-main"><h1>📱 Fernbedienung</h1><p>Verbinde …</p></main>`;
		const sol = s.questionIndex >= 0 ? this.solutions[s.questionIndex] : undefined;
		const q = s.question;
		const inQuestion = ["intro", "answering", "reveal", "scoreboard"].includes(s.phase);
		return html`<main class="remote-main">
			<header class="remote-head">
				<div><b>${s.quizTitle}</b><div class="muted small">PIN ${s.pin} · ${s.players.filter(p => !p.anon).length || s.players.length} verbunden</div></div>
				<span class="pill-s">${PHASE[s.phase] ?? s.phase}</span>
			</header>
			${inQuestion && q ? html`<section class="remote-card">
				<div class="muted small">Frage ${s.questionIndex + 1} von ${s.questionCount}${s.phase === "answering" || s.phase === "reveal" ? ` · ${s.answeredCount} von ${s.connectedCount} geantwortet` : ""}</div>
				<div class="remote-q">${mdPlain(q.text)}</div>
				${sol ? html`<div class="remote-sol">✓ ${sol.kind === "estimate" ? `${fmtNum(sol.value, sol.unit)}${sol.tolerance ? ` (± ${fmtNum(sol.tolerance)})` : ""}`
					: sol.kind === "order" ? sol.correct.map((t, i) => `${i + 1}. ${mdPlain(t)}`).join("  ") : sol.correct.map(t => mdPlain(t)).join(" · ")}</div>` : nothing}
				${q.notes ? html`<div class="remote-notes">📝 ${q.notes}</div>` : nothing}
			</section>` : nothing}
			${s.phase === "direct" && s.direct ? html`<section class="remote-card"><div class="muted small">⚡ Direktfrage · ${s.direct.count} Antworten</div>
				<div class="remote-q">${s.direct.text}</div></section>` : nothing}
			<div class="remote-main-btn">${this.mainButton(s)}</div>
			<div class="remote-grid">
				${["intro", "answering", "scoreboard"].includes(s.phase) ? html`<button @click=${() => { if (confirm(s.phase === "scoreboard" ? "Nächste Frage überspringen?" : "Diese Frage überspringen? Antworten verfallen.")) void this.call("HostSkip"); }}>
					⏭ ${s.phase === "scoreboard" ? "Nächste überspringen" : "Frage überspringen"}</button>` : nothing}
				${["lobby", "reveal", "scoreboard", "final"].includes(s.phase) || (s.phase === "direct" && !s.direct?.open) ? html`<button @click=${() => { this.composerError = ""; this.composer = true; }}>⚡ Direktfrage</button>` : nothing}
				${s.phase === "direct" && s.direct?.open ? html`<button @click=${() => this.call("HostDirectLive", !s.direct!.live)}>${s.direct.live ? "👁 Live aus" : "👁 Live an"}</button>` : nothing}
				${s.phase === "podium" ? html`<button @click=${() => this.cmd("song-end")}>🔇 Lied ausblenden</button><button @click=${() => this.cmd("song-intro")}>✂ Nach dem Intro</button>` : nothing}
				<button @click=${() => { this.muted = !this.muted; void this.cmd(this.muted ? "mute" : "unmute"); }}>${this.muted ? "🔊 Ton an" : "🔇 Ton aus"}</button>
				${s.hasQuiz && !["lobby", "podium", "final", "direct"].includes(s.phase) ? html`<button class="danger" @click=${() => { if (confirm("Quiz jetzt beenden und zur Siegerehrung?")) void this.call("HostFinish"); }}>🏁 Beenden</button>` : nothing}
			</div>
			${s.next && s.phase !== "final" && s.phase !== "podium" ? html`<section class="remote-next"><span class="muted small">Als Nächstes:</span> ${mdPlain(s.next.text)}</section>` : nothing}
			${this.composer ? html`<direct-composer .error=${this.composerError} @direct-submit=${(e: CustomEvent<DirectSpec>) => this.direct(e.detail)}
				@direct-cancel=${() => { this.composer = false; }}></direct-composer>` : nothing}
		</main>`;
	}

	private mainButton(s: HostState) {
		const b = (label: string, fn: () => unknown, dis = false) => html`<button class="primary big" ?disabled=${dis} @click=${fn}>${label}</button>`;
		const next = () => this.call("HostNext");
		switch (s.phase) {
			case "lobby": return s.hasQuiz ? b(`Los geht's ▶ (${s.players.length})`, next, !s.players.length) : b("⚡ Frage stellen", () => { this.composer = true; });
			case "intro": return b("Antwortzeit starten ⏩", next);
			case "answering": return b("Zeit beenden ⏹", next);
			case "reveal": return b(s.isLast ? "Zur Siegerehrung 🏆" : "Zwischenstand ▶", next);
			case "scoreboard": return b("Nächste Frage ▶", next);
			case "podium": return b("Statistik anzeigen 📊", next);
			case "direct": return s.direct?.open ? b("Abstimmung schließen ⏹", () => this.call("HostDirectClose")) : b("Zurück ▶", () => this.call("HostDirectEnd"));
			default: return nothing;
		}
	}
}
