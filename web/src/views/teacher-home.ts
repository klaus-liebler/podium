// Dozentenbereich: Quiz-Übersicht, Starten, Bearbeiten, letzte Runden. Bewusst schlicht.
import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { LightElement } from "../core/util.ts";
import type { QuizSummary, SessionSummary } from "../core/types.ts";
import { ApiError, api, getMe, teacherHeader, type Me } from "../core/session.ts";
import { THEMES } from "../three/stage.ts";

const fmt = (d: string) => new Date(d).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });

@customElement("teacher-home")
export class TeacherHome extends LightElement {
	@state() private me: Me | null = null;
	@state() private quizzes: QuizSummary[] | null = null;
	@state() private sessions: SessionSummary[] = [];
	@state() private error = "";
	@state() private info = "";
	@state() private importOpen = false;
	@state() private importBusy = false;
	@state() private polls: { id: number; roomTitle: string; text: string; kind: string; answerCount: number; createdUtc: string }[] = [];

	override connectedCallback() {
		super.connectedCallback();
		document.body.className = "teacher";
		document.title = "Podium – Dozentenbereich";
		void this.load();
	}

	private async load() {
		this.me = await getMe();
		if (!this.me) return; // api() leitet zur Anmeldung um
		try {
			this.quizzes = await api<QuizSummary[]>("quizzes");
			this.sessions = await api<SessionSummary[]>("sessions");
			this.polls = await api("directpolls");
		} catch (e) { if ((e as ApiError).status !== 401) this.error = "Server nicht erreichbar."; }
	}

	private async start(id: number) {
		try {
			const d = await api<{ pin: string; hostKey: string }>("games", { method: "POST", json: { quizId: id } });
			location.hash = `#/host/${d.pin}/${d.hostKey}`;
		} catch (e) { this.error = (e as Error).message; }
	}
	private async importRun(run: () => Promise<{ title: string; count: number; warnings?: string[] }>) {
		this.importBusy = true;
		try {
			const d = await run();
			this.error = "";
			this.info = `„${d.title}“ importiert: ${d.count} Frage(n).` + (d.warnings?.length ? " Hinweise: " + d.warnings.join(" · ") : "");
			this.importOpen = false;
			void this.load();
		} catch (e) {
			this.error = (e as Error).message;
			this.info = (((e as ApiError).data?.warnings as string[]) ?? []).join(" · ");
		} finally { this.importBusy = false; }
	}
	private async importUrl(e: Event) {
		e.preventDefault();
		const url = (this.querySelector("#impUrl") as HTMLInputElement).value.trim(); if (!url) return;
		await this.importRun(() => api("import/kahoot", { method: "POST", json: { url } }));
	}
	private async importFile(e: Event) {
		const input = e.target as HTMLInputElement, f = input.files?.[0]; if (!f) return;
		const fd = new FormData(); fd.append("file", f);
		await this.importRun(() => api("import/file", { method: "POST", body: fd }));
		input.value = "";
	}

	private async copy(id: number) { await api(`quizzes/${id}/copy`, { method: "POST" }); void this.load(); }
	private async del(q: QuizSummary) {
		if (!confirm(`Quiz „${q.title}“ wirklich löschen?`)) return;
		await api(`quizzes/${q.id}`, { method: "DELETE" }); void this.load();
	}

	protected override render() {
		return html`
			${teacherHeader(this.me, html`
				<button @click=${() => this.start(0)} title="Raum ohne Quiz für spontane Fragen">⚡ Live-Fragerunde</button>
				<button @click=${() => { this.importOpen = !this.importOpen; }}>⬆ Importieren</button>
				<a class="button primary" href="#/edit/new">+ Neues Quiz</a>`)}
			<main>
				${this.error ? html`<div class="msg err">${this.error}</div>` : nothing}
				${this.info ? html`<div class="msg ok">${this.info}</div>` : nothing}
				${this.importOpen ? html`<div class="box" style="padding:16px;margin-bottom:8px">
					<h2 style="margin-top:0">Fragen importieren</h2>
					<form class="imp-row" @submit=${(e: Event) => this.importUrl(e)}>
						<label class="field" style="flex:1;margin:0"><span>Kahoot-Link (öffentliches Kahoot, z. B. https://create.kahoot.it/details/…)</span>
							<input type="text" id="impUrl" placeholder="https://create.kahoot.it/details/…"></label>
						<button class="primary" type="submit" ?disabled=${this.importBusy}>Von Kahoot laden</button>
					</form>
					<p class="muted" style="margin:12px 0 6px">… oder Datei hochladen: <b>Kahoot-Tabellenvorlage (.xlsx)</b>, CSV mit den Spalten <i>Question; Answer 1–6; Time limit; Correct answer(s)</i>
						(z. B. „1,3“) oder eine Podium-/Kahoot-<b>JSON</b>-Datei.</p>
					<input type="file" accept=".xlsx,.csv,.tsv,.txt,.json" ?disabled=${this.importBusy} @change=${(e: Event) => this.importFile(e)}>
					<p class="muted" style="margin-bottom:0">Private Kahoots: In Kahoot unter „Teilen“ auf öffentlich stellen oder die Fragen in die offizielle Kahoot-Excel-Vorlage kopieren. Kahoot-Umfragen, Word Clouds und Schieberegler werden übersprungen – die gehen hier als ⚡ Direktfrage.</p>
				</div>` : nothing}
				${this.me?.isAdmin ? html`<h2>Szenen-Vorschau</h2>
				<div class="box">
					<div class="scene-grid">${THEMES.map(t => html`<a class="button" href="#/preview/${t.id}" title="Leinwand mit 20 Beispielteilnehmenden und deiner Musikauswahl">${t.icon} ${t.label}</a>`)}</div>
					<p class="muted small" style="margin:0;padding:0 16px 12px">Spielt eine Beispielrunde lokal durch (ohne echte Teilnehmende). Oben in der Leiste springst du direkt zu Warteraum, Frage, Lösung, Zwischenstand, Siegerehrung oder Statistik.</p>
				</div>` : nothing}
				<h2>Meine Quizze</h2>
				<div class="box"><table>
					<thead><tr><th>Titel</th><th>Fragen</th><th>Geändert</th><th></th></tr></thead>
					<tbody>
						${this.quizzes === null ? html`<tr><td colspan="4" class="empty">Lade …</td></tr>`
						: this.quizzes.length === 0 ? html`<tr><td colspan="4" class="empty">Noch keine Quizze – lege eines an.</td></tr>`
						: this.quizzes.map(q => html`
							<tr>
								<td><b>${q.title}</b>${q.description ? html`<div class="muted">${q.description}</div>` : nothing}</td>
								<td>${q.questionCount}</td>
								<td class="muted">${fmt(q.updatedUtc)}</td>
								<td class="actions">
									<button class="primary" @click=${() => this.start(q.id)}>▶ Starten</button>
									<a class="button" href="#/edit/${q.id}">Bearbeiten</a>
									<button @click=${() => this.copy(q.id)}>Kopieren</button>
									<a class="button" href="api/quizzes/${q.id}/export" title="Als JSON exportieren">Export</a>
									<button class="danger" @click=${() => this.del(q)}>Löschen</button>
								</td>
							</tr>`)}
					</tbody>
				</table></div>

				<h2>Letzte Spielrunden</h2>
				<div class="box"><table>
					<thead><tr><th>Quiz</th><th>Datum</th><th>Teilnehmende</th><th>Gewinner·in</th></tr></thead>
					<tbody>
						${this.sessions.length ? this.sessions.map(s => html`
							<tr><td>${s.quizTitle}</td><td class="muted">${fmt(s.startedUtc)}</td><td>${s.playerCount}</td><td>${s.winner ?? "–"}</td></tr>`)
						: html`<tr><td colspan="4" class="empty">Noch keine gespielten Runden.</td></tr>`}
					</tbody>
				</table></div>
				${this.polls.length ? html`<h2>Letzte Direktfragen</h2>
				<div class="box"><table>
					<thead><tr><th>Frage</th><th>Typ</th><th>Antworten</th><th>Datum</th></tr></thead>
					<tbody>${this.polls.map(p => html`<tr><td>${p.text}</td><td>${({ choice: "Auswahl", number: "Zahl", text: "Text" } as Record<string, string>)[p.kind] ?? p.kind}</td>
						<td>${p.answerCount}</td><td class="muted">${fmt(p.createdUtc)}</td></tr>`)}</tbody>
				</table></div>` : nothing}
				<p class="muted" style="margin-top:24px">Tipp: Nach „Starten“ öffnet sich die Leinwand. Studierende treten per QR-Code bei – Laptop und Handys müssen im selben Netz sein.</p>
			</main>`;
	}
}
