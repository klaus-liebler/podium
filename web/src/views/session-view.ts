// Auswertung einer gespielten Runde (#/session/<id>): Überblick, schwierigste Fragen, Statistik je Frage, Rangliste.
// Export als CSV (Server) und als PDF über die Druckansicht des Browsers.
import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LETTERS, LightElement, fmtDate, fmtNum, fmtSecs, shape } from "../core/util.ts";
import { ApiError, api, getMe, teacherHeader, type Me } from "../core/session.ts";
import type { QuestionStat } from "../core/types.ts";
import { md, mdPlain } from "../core/markdown.ts";

interface SessionDetail {
	id: number; quizId: number; quizTitle: string; startedUtc: string; finishedUtc: string | null;
	players: { nickname: string; score: number; rank: number; correctCount: number }[];
	stats: { questions: QuestionStat[] } | null;
}
const pct = (q: QuestionStat) => q.answered ? Math.round(100 * q.correct / q.answered) : 0;
const KIND: Record<string, string> = { choice: "Auswahl", estimate: "Schätzfrage", order: "Reihenfolge" };

@customElement("session-view")
export class SessionView extends LightElement {
	@property({ type: Number }) sessionId = 0;
	@state() private me: Me | null = null;
	@state() private s: SessionDetail | null = null;
	@state() private error = "";

	override connectedCallback() {
		super.connectedCallback();
		document.body.className = "teacher";
		document.title = "Podium – Auswertung";
		void this.load();
	}
	private async load() {
		this.me = await getMe();
		if (!this.me) return;
		try { this.s = await api<SessionDetail>(`sessions/${this.sessionId}`); document.title = `Podium – Auswertung ${this.s.quizTitle}`; }
		catch (e) { if ((e as ApiError).status !== 401) this.error = "Runde nicht gefunden."; }
	}
	private async del() {
		if (!confirm("Diese Auswertung löschen?")) return;
		await api(`sessions/${this.sessionId}`, { method: "DELETE" });
		location.hash = "#/";
	}

	protected override render() {
		const s = this.s;
		return html`
			${teacherHeader(this.me, html`<a class="button" href="#/">← Zur Übersicht</a>`)}
			<main class="session">
				${this.error ? html`<div class="msg err">${this.error}</div>` : !s ? html`<div class="box empty">Lade …</div>` : this.body(s)}
			</main>`;
	}

	private body(s: SessionDetail) {
		const qs = s.stats?.questions ?? [];
		const played = qs.filter(q => !q.skipped);
		const answered = played.reduce((a, q) => a + q.answered, 0), correct = played.reduce((a, q) => a + q.correct, 0);
		const hardest = played.filter(q => q.answered > 0).map((q, i) => ({ q, i: qs.indexOf(q) })).sort((a, b) => pct(a.q) - pct(b.q)).slice(0, 3);
		const mins = s.finishedUtc ? Math.round((new Date(s.finishedUtc).getTime() - new Date(s.startedUtc).getTime()) / 60000) : null;
		return html`
			<div class="quiz-head">
				<h2>📊 ${s.quizTitle}</h2><span class="spacer"></span>
				<a class="button" href="api/sessions/${s.id}/csv" download>⬇ CSV</a>
				<button @click=${() => print()} title="Druckansicht – dort „Als PDF speichern“ wählen">🖨 Drucken / PDF</button>
				${s.quizId ? html`<a class="button" href="#/edit/${s.quizId}">Quiz bearbeiten</a>` : nothing}
				<button class="danger no-print" @click=${() => this.del()}>Löschen</button>
			</div>
			<div class="kpis">
				<div class="box kpi"><b>${fmtDate(s.startedUtc)}</b><span>gespielt${mins != null ? ` · ${mins} min` : ""}</span></div>
				<div class="box kpi"><b>${s.players.length}</b><span>Teilnehmende</span></div>
				<div class="box kpi"><b>${played.length}${qs.length > played.length ? html` <small>von ${qs.length}</small>` : nothing}</b><span>Fragen gespielt</span></div>
				<div class="box kpi"><b>${answered ? Math.round(100 * correct / answered) : 0} %</b><span>der Antworten richtig</span></div>
			</div>
			${!s.stats ? html`<p class="msg warn">Für diese (ältere) Runde gibt es nur die Rangliste – die Statistik je Frage wird seit dem letzten Update gespeichert.</p>` : nothing}
			${hardest.length ? html`<h2>Am schwierigsten</h2>
				<div class="box hard-list">${hardest.map(({ q, i }) => html`<div class="hard">
					<span class="pct ${pct(q) < 50 ? "low" : ""}">${pct(q)} %</span>
					<span><b>Frage ${i + 1}:</b> ${mdPlain(q.text)}</span></div>`)}
					<p class="muted small" style="margin:6px 0 0">Kandidaten zum Wiederholen in der nächsten Vorlesung.</p></div>` : nothing}
			${qs.length ? html`<h2>Fragen im Einzelnen</h2>${qs.map((q, i) => this.question(q, i))}` : nothing}
			<h2>Rangliste</h2>
			<div class="box"><table>
				<thead><tr><th>Platz</th><th>Name</th><th>Richtig</th><th>Punkte</th></tr></thead>
				<tbody>${s.players.map(p => html`<tr><td>${p.rank}.</td><td>${p.nickname}</td><td>${p.correctCount}${played.length ? ` / ${played.length}` : ""}</td><td><b>${p.score.toLocaleString("de-DE")}</b></td></tr>`)}</tbody>
			</table></div>
			<p class="muted small">Die Namen sind selbst gewählte Spitznamen; Podium speichert keine Konten der Teilnehmenden.</p>`;
	}

	private question(q: QuestionStat, i: number) {
		const kind = q.kind ?? "choice";
		const max = Math.max(1, ...q.distribution);
		return html`<div class="box sq ${q.skipped ? "skipped" : ""}">
			<div class="sq-head"><b>Frage ${i + 1}</b> <span class="muted small">${KIND[kind]}</span><span class="spacer"></span>
				${q.skipped ? html`<span class="pill-s">übersprungen</span>`
				: html`<span class="pct ${pct(q) < 50 ? "low" : ""}">${pct(q)} % richtig</span>
					<span class="muted small">${q.correct}/${q.answered} · ${q.answered < q.players ? `${q.players - q.answered} ohne Antwort · ` : ""}Ø ${fmtSecs(q.avgMs)} s</span>`}</div>
			<div class="sq-text">${md(q.text)}</div>
			${q.skipped ? nothing : kind === "estimate" ? html`<p>Richtig: <b>${fmtNum(q.correctValue, q.unit)}</b>${q.tolerance ? ` (± ${fmtNum(q.tolerance)})` : ""}
				· Median der Schätzungen: <b>${fmtNum(q.median, q.unit)}</b></p>`
			: kind === "order" ? html`<ol class="sq-order">${q.options.map(o => html`<li>${mdPlain(o.text)}</li>`)}</ol>`
			: html`<div class="sq-bars">${q.options.map((o, j) => html`<div class="sq-bar ${o.correct ? "ok" : ""}">
				<span class="badge c${j}">${shape(j)}${LETTERS[j]}</span>
				<span class="txt">${mdPlain(o.text)}${o.correct ? " ✓" : ""}</span>
				<span class="track"><i class="c${j}" style="width:${(q.distribution[j] ?? 0) / max * 100}%"></i></span>
				<span class="n">${q.distribution[j] ?? 0}</span></div>`)}</div>`}
		</div>`;
	}
}
