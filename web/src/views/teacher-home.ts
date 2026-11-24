// Dozentenbereich: Quiz-Übersicht mit Ordnern, Suche und Sortierung, Starten (alle oder ausgewählte Fragen, sofort oder als
// vorbereiteter Raum), offene Räume (Leinwand, Fernbedienung, QR-Code für die Folien), Teilen, Papierkorb, letzte Runden.
import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LightElement, fmtDate, store, toast } from "../core/util.ts";
import type { OpenRoom, QuizDto, QuizFolder, QuizSummary, SessionSummary } from "../core/types.ts";
import { ApiError, api, getMe, teacherHeader, type Me } from "../core/session.ts";
import { THEMES } from "../three/stage.ts";
import { mdPlain } from "../core/markdown.ts";

type Sort = "updated" | "title" | "played" | "count";
const SORTS: [Sort, string][] = [["updated", "zuletzt geändert"], ["played", "zuletzt gespielt"], ["title", "Titel A–Z"], ["count", "Anzahl Fragen"]];
const PHASE: Record<string, string> = { lobby: "Warteraum", intro: "Frage", answering: "Antwortzeit", reveal: "Lösung", scoreboard: "Zwischenstand", podium: "Siegerehrung", final: "Statistik", direct: "Direktfrage" };

interface StartDlg { quiz: QuizSummary | null; folderId: number; questions: QuizDto["questions"] | null; pick: Set<number>; all: boolean; busy: boolean; }

@customElement("teacher-home")
export class TeacherHome extends LightElement {
	/** geöffneter Ordner (0 = Übersicht: Ordner + Quizze ohne Ordner) */
	@property({ type: Number }) folderId = 0;
	/** Papierkorb anzeigen (#/trash) */
	@property({ type: Boolean }) trash = false;
	@state() private me: Me | null = null;
	@state() private quizzes: QuizSummary[] | null = null;
	@state() private folders: QuizFolder[] = [];
	@state() private sessions: SessionSummary[] = [];
	@state() private rooms: OpenRoom[] = [];
	@state() private trashed: { id: number; title: string; deletedUtc: string; questionCount: number }[] = [];
	@state() private error = "";
	@state() private info = "";
	@state() private importOpen = false;
	@state() private importBusy = false;
	@state() private polls: { id: number; roomTitle: string; text: string; kind: string; answerCount: number; createdUtc: string }[] = [];
	@state() private search = "";
	@state() private sort: Sort = store.get<Sort>("podium-sort", "updated");
	@state() private dropTarget: number | null = null;
	@state() private startDlg: StartDlg | null = null;
	@state() private shareDlg: { quiz: QuizSummary; link: string } | null = null;
	@state() private remoteDlg: OpenRoom | null = null;
	private dragQuiz = 0;
	private poll = 0;

	override connectedCallback() {
		super.connectedCallback();
		document.body.className = "teacher";
		document.title = this.trash ? "Podium – Papierkorb" : "Podium – Dozentenbereich";
		void this.load();
		this.poll = window.setInterval(() => void this.loadRooms(), 10000); // offene Räume aktuell halten
	}
	override disconnectedCallback() { super.disconnectedCallback(); clearInterval(this.poll); }

	private async load() {
		this.me = await getMe();
		if (!this.me) return; // api() leitet zur Anmeldung um
		try {
			[this.quizzes, this.folders] = await Promise.all([api<QuizSummary[]>("quizzes"), api<QuizFolder[]>("folders")]);
			if (this.folderId && !this.folder) { location.hash = "#/"; return; } // Ordner gibt es nicht (mehr)
			[this.sessions, this.polls, this.trashed] = await Promise.all([api<SessionSummary[]>("sessions"), api<TeacherHome["polls"]>("directpolls"), api<TeacherHome["trashed"]>("trash")]);
			await this.loadRooms();
		} catch (e) { if ((e as ApiError).status !== 401) this.error = "Server nicht erreichbar."; }
	}
	private async loadRooms() { if (this.me) this.rooms = await api<OpenRoom[]>("games").catch(() => this.rooms); }

	// ---------------------------------------------------------------- Starten
	private openStart(q: QuizSummary | null) {
		this.startDlg = { quiz: q, folderId: this.folderId, questions: null, pick: new Set(), all: true, busy: false };
	}
	private async loadQuestions() {
		const d = this.startDlg!;
		if (!d.quiz || d.questions) return;
		const q = await api<QuizDto>(`quizzes/${d.quiz.id}`);
		this.startDlg = { ...this.startDlg!, questions: q.questions, pick: new Set(q.questions.map((_, i) => i)) };
	}
	/** Runde anlegen: open = Leinwand gleich öffnen, sonst nur vorbereiten (PIN/QR für die Folien) */
	private async start(open: boolean, replace = false): Promise<void> {
		const d = this.startDlg!;
		const only = d.quiz && !d.all ? [...d.pick].sort((a, b) => a - b) : null;
		if (only && !only.length) { toast("Bitte mindestens eine Frage auswählen.", 3500, "err"); return; }
		this.startDlg = { ...d, busy: true };
		try {
			const r = await api<{ pin: string; hostKey: string }>("games", { method: "POST", json: { quizId: d.quiz?.id ?? 0, only, folderId: d.folderId || null, replace } });
			this.startDlg = null;
			if (open) { location.hash = `#/host/${r.pin}/${r.hostKey}`; return; }
			toast(`Raum vorbereitet – PIN ${r.pin}`);
			await this.loadRooms();
		} catch (e) {
			const err = e as ApiError;
			this.startDlg = { ...this.startDlg!, busy: false };
			if (err.status === 409 && err.data.busy) {
				if (confirm(`${err.message}\n\nDiese Runde schließen und eine neue unter derselben Kurs-PIN starten?`)) return this.start(open, true);
				return;
			}
			this.error = err.message; this.startDlg = null;
		}
	}
	private async closeRoom(r: OpenRoom) {
		if (r.players > 0 && !confirm(`Raum ${r.pin} schließen? ${r.players} Person(en) werden getrennt.`)) return;
		await api(`games/${r.pin}`, { method: "DELETE" }).catch(() => { });
		await this.loadRooms();
	}

	// ---------------------------------------------------------------- Import
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
		await this.importRun(() => api("import/kahoot" + this.folderQuery, { method: "POST", json: { url } }));
	}
	private async importFile(e: Event) {
		const input = e.target as HTMLInputElement, f = input.files?.[0]; if (!f) return;
		const fd = new FormData(); fd.append("file", f);
		await this.importRun(() => api("import/file" + this.folderQuery, { method: "POST", body: fd }));
		input.value = "";
	}

	// ---------------------------------------------------------------- Quiz-Aktionen
	private async copy(id: number) { await api(`quizzes/${id}/copy`, { method: "POST" }); void this.load(); }
	private async del(q: QuizSummary) {
		await api(`quizzes/${q.id}`, { method: "DELETE" });
		toast(`„${q.title}“ liegt im Papierkorb (30 Tage wiederherstellbar).`, 4000);
		void this.load();
	}
	private async share(q: QuizSummary) {
		const r = await api<{ link: string }>(`quizzes/${q.id}/share`, { method: "POST" });
		this.shareDlg = { quiz: q, link: r.link };
		void this.load();
	}
	private async unshare(q: QuizSummary) {
		await api(`quizzes/${q.id}/share`, { method: "DELETE" });
		this.shareDlg = null; toast("Link zurückgezogen."); void this.load();
	}
	private async restore(id: number) { await api(`trash/${id}/restore`, { method: "POST" }); toast("Wiederhergestellt."); void this.load(); }
	private async purge(id: number, title: string) {
		if (!confirm(`„${title}“ endgültig löschen? Das lässt sich nicht rückgängig machen.`)) return;
		await api(`trash/${id}`, { method: "DELETE" }); void this.load();
	}
	private async purgeAll() {
		if (!confirm(`Papierkorb leeren? ${this.trashed.length} Quiz(ze) werden endgültig gelöscht.`)) return;
		await api("trash", { method: "DELETE" }); void this.load();
	}

	// ---------------------------------------------------------------- Ordner
	/** Quizze der aktuellen Ebene: bei Suche alle Treffer, im Ordner dessen Inhalt, in der Übersicht die ohne Ordner */
	private get shown() {
		const s = this.search.trim().toLowerCase();
		const list = (this.quizzes ?? []).filter(q => s ? (q.title + " " + q.description).toLowerCase().includes(s) : (q.folderId ?? 0) === this.folderId);
		const by: Record<Sort, (a: QuizSummary, b: QuizSummary) => number> = {
			updated: (a, b) => b.updatedUtc.localeCompare(a.updatedUtc),
			played: (a, b) => (b.lastPlayedUtc ?? "").localeCompare(a.lastPlayedUtc ?? "") || b.updatedUtc.localeCompare(a.updatedUtc),
			title: (a, b) => a.title.localeCompare(b.title, "de"),
			count: (a, b) => b.questionCount - a.questionCount,
		};
		return list.sort(by[this.sort]);
	}
	private get folder() { return this.folders.find(f => f.id === this.folderId); }
	private get folderQuery() { return this.folderId ? `?folder=${this.folderId}` : ""; }
	private count(f: QuizFolder) { return this.quizzes?.filter(q => q.folderId === f.id).length ?? 0; }
	private async run(fn: () => Promise<unknown>) {
		try { await fn(); this.error = ""; } catch (e) { this.error = (e as Error).message; }
		void this.load();
	}
	private newFolder() {
		const name = prompt("Name des neuen Ordners (z. B. Kurs oder Semester):")?.trim(); if (!name) return;
		void this.run(() => api("folders", { method: "POST", json: { name } }));
	}
	private renameFolder(f: QuizFolder) {
		const name = prompt("Neuer Name des Ordners:", f.name)?.trim(); if (!name || name === f.name) return;
		void this.run(() => api(`folders/${f.id}`, { method: "PUT", json: { name } }));
	}
	private async delFolder(f: QuizFolder) {
		const n = this.count(f);
		if (!confirm(`Ordner „${f.name}“ löschen?` + (n ? `\n\nDie ${n} Quiz(ze) darin bleiben erhalten und stehen danach in der Übersicht ohne Ordner.` : ""))) return;
		await this.run(() => api(`folders/${f.id}`, { method: "DELETE" }));
		if (this.folderId === f.id) location.hash = "#/";
	}
	private coursePin(f: QuizFolder, on: boolean) {
		if (!on && !confirm(`Kurs-PIN ${f.pin} aufgeben? Runden aus diesem Ordner bekommen dann wieder zufällige PINs.`)) return;
		void this.run(() => api(`folders/${f.id}/pin`, { method: on ? "PUT" : "DELETE" }));
	}
	private moveTo(quizId: number, folderId: number | null) {
		void this.run(() => api(`quizzes/${quizId}/folder`, { method: "PUT", json: { folderId } }));
	}
	private moveSelect(q: QuizSummary) {
		if (!this.folders.length) return nothing;
		return html`<select class="move" title="In Ordner verschieben (oder Zeile auf einen Ordner ziehen)" @change=${(e: Event) => this.moveTo(q.id, Number((e.target as HTMLSelectElement).value) || null)}>
			<option value="0" ?selected=${!q.folderId}>— ohne Ordner —</option>
			${this.folders.map(f => html`<option value=${f.id} ?selected=${q.folderId === f.id}>📁 ${f.name}</option>`)}
		</select>`;
	}
	/** Ablageziel beim Ziehen einer Quiz-Zeile (0 = ohne Ordner) */
	private dropZone(target: number) {
		return {
			over: (e: DragEvent) => { if (this.dragQuiz) { e.preventDefault(); this.dropTarget = target; } },
			leave: () => { if (this.dropTarget === target) this.dropTarget = null; },
			drop: (e: DragEvent) => { e.preventDefault(); const id = this.dragQuiz; this.dragQuiz = 0; this.dropTarget = null; if (id) this.moveTo(id, target || null); },
		};
	}

	// ---------------------------------------------------------------- Rendering
	protected override render() {
		if (this.trash) return this.renderTrash();
		const up = this.dropZone(0);
		return html`
			${teacherHeader(this.me, html`
				<button @click=${() => this.openStart(null)} title="Raum ohne Quiz für spontane Fragen">⚡ Live-Fragerunde</button>
				<button @click=${() => { this.importOpen = !this.importOpen; }}>⬆ Importieren</button>
				<a class="button primary" href="#/edit/new${this.folderQuery}">+ Neues Quiz</a>`)}
			<main>
				${this.error ? html`<div class="msg err">${this.error}</div>` : nothing}
				${this.info ? html`<div class="msg ok">${this.info}</div>` : nothing}
				${this.importOpen ? this.renderImport() : nothing}
				${this.rooms.length ? this.renderRooms() : nothing}
				${this.me?.isAdmin ? html`<details class="box scene-box"><summary><h2>Szenen-Vorschau</h2></summary>
					<div class="scene-grid">${THEMES.map(t => html`<a class="button" href="#/preview/${t.id}" title="Leinwand mit 20 Beispielteilnehmenden und deiner Musikauswahl">${t.icon} ${t.label}</a>`)}</div>
					<p class="muted small" style="margin:0;padding:0 16px 12px">Spielt eine Beispielrunde lokal durch (ohne echte Teilnehmende). Oben in der Leiste springst du direkt zu Warteraum, Frage, Lösung, Zwischenstand, Siegerehrung oder Statistik.</p>
				</details>` : nothing}
				<div class="quiz-head">
					<h2>${this.folder ? html`<a href="#/" class="${this.dropTarget === 0 ? "drop-here" : ""}" @dragover=${up.over} @dragleave=${up.leave} @drop=${up.drop}>Meine Quizze</a> › 📁 ${this.folder.name}` : "Meine Quizze"}</h2>
					<span class="spacer"></span>
					<input type="search" class="search" placeholder="🔍 Suchen (alle Ordner)" aria-label="Quizze durchsuchen" .value=${this.search}
						@input=${(e: InputEvent) => { this.search = (e.target as HTMLInputElement).value; }}>
					<select aria-label="Sortierung" @change=${(e: Event) => { this.sort = (e.target as HTMLSelectElement).value as Sort; store.set("podium-sort", this.sort); }}>
						${SORTS.map(([k, l]) => html`<option value=${k} ?selected=${k === this.sort}>${l}</option>`)}</select>
					${this.folder ? html`
						<button @click=${() => this.renameFolder(this.folder!)}>Umbenennen</button>
						<button class="danger" @click=${() => this.delFolder(this.folder!)}>Ordner löschen</button>`
					: html`<button @click=${() => this.newFolder()} title="Ordner, z. B. je Kurs oder Semester">📁 Neuer Ordner</button>`}
				</div>
				${this.folder ? html`<p class="course-pin muted">${this.folder.pin
					? html`🔒 Kurs-PIN <b>${this.folder.pin}</b> – alle Runden aus diesem Ordner nutzen diese PIN (gut für Folien und Moodle). <button class="link" @click=${() => this.coursePin(this.folder!, false)}>aufgeben</button>`
					: html`<button class="link" @click=${() => this.coursePin(this.folder!, true)}>Feste Kurs-PIN festlegen</button> – dann bleibt die PIN für alle Runden aus diesem Ordner gleich.`}
					· <button class="link" @click=${() => this.openStart(null)}>⚡ Live-Fragerunde für diesen Kurs</button></p>` : nothing}
				<div class="box"><table>
					<thead><tr><th>Titel</th><th>Fragen</th><th>${this.sort === "played" ? "Gespielt" : "Geändert"}</th><th></th></tr></thead>
					<tbody>
						${!this.folderId && !this.search && this.quizzes ? this.folders.map(f => {
							const z = this.dropZone(f.id);
							return html`
							<tr class="folder ${this.dropTarget === f.id ? "drop-here" : ""}" @dragover=${z.over} @dragleave=${z.leave} @drop=${z.drop}>
								<td colspan="2"><a href="#/folder/${f.id}">📁 <b>${f.name}</b></a>${f.pin ? html` <span class="pill-s" title="Kurs-PIN">🔒 ${f.pin}</span>` : nothing}</td>
								<td class="muted">${this.count(f) === 1 ? "1 Quiz" : `${this.count(f)} Quizze`}</td>
								<td class="actions">
									<a class="button" href="#/folder/${f.id}">Öffnen</a>
									<button @click=${() => this.renameFolder(f)}>Umbenennen</button>
									<button class="danger" @click=${() => this.delFolder(f)}>Löschen</button>
								</td>
							</tr>`;
						}) : nothing}
						${this.quizzes === null ? html`<tr><td colspan="4" class="empty">Lade …</td></tr>`
						: this.shown.length === 0 ? (this.search ? html`<tr><td colspan="4" class="empty">Kein Quiz gefunden.</td></tr>`
							: this.folderId || !this.folders.length
							? html`<tr><td colspan="4" class="empty">${this.folderId ? "Dieser Ordner ist leer – lege ein Quiz an, importiere eines oder ziehe eines hierher." : "Noch keine Quizze – lege eines an."}</td></tr>`
							: nothing)
						: this.shown.map(q => html`
							<tr draggable="true" @dragstart=${(e: DragEvent) => { this.dragQuiz = q.id; e.dataTransfer?.setData("text/plain", q.title); }}
								@dragend=${() => { this.dragQuiz = 0; this.dropTarget = null; }}>
								<td><b>${q.title}</b>${q.shared ? html` <span class="pill-s" title="Per Link geteilt">🔗 geteilt</span>` : nothing}
									${this.search && q.folderId ? html` <span class="muted small">📁 ${this.folders.find(f => f.id === q.folderId)?.name}</span>` : nothing}
									${q.description ? html`<div class="muted">${q.description}</div>` : nothing}</td>
								<td>${q.questionCount}</td>
								<td class="muted">${this.sort === "played" ? (q.lastPlayedUtc ? fmtDate(q.lastPlayedUtc) : "noch nie") : fmtDate(q.updatedUtc)}</td>
								<td class="actions">
									<button class="primary" @click=${() => this.openStart(q)}>▶ Starten</button>
									<a class="button" href="#/edit/${q.id}">Bearbeiten</a>
									<button @click=${() => this.copy(q.id)}>Kopieren</button>
									<button @click=${() => this.share(q)} title="Kolleg·innen bekommen per Link eine eigene Kopie">Teilen</button>
									${this.moveSelect(q)}
									<a class="button" href="api/quizzes/${q.id}/export" title="Als JSON exportieren">Export</a>
									<button class="danger" @click=${() => this.del(q)} title="In den Papierkorb">Löschen</button>
								</td>
							</tr>`)}
					</tbody>
				</table></div>
				${this.trashed.length ? html`<p class="muted small" style="margin:8px 4px"><a href="#/trash">🗑 Papierkorb (${this.trashed.length})</a></p>` : nothing}

				<h2>Letzte Spielrunden</h2>
				<div class="box"><table>
					<thead><tr><th>Quiz</th><th>Datum</th><th>Teilnehmende</th><th>Gewinner·in</th><th></th></tr></thead>
					<tbody>
						${this.sessions.length ? this.sessions.map(s => html`
							<tr class="clickable" @click=${() => { location.hash = `#/session/${s.id}`; }}>
								<td><a href="#/session/${s.id}">${s.quizTitle}</a></td><td class="muted">${fmtDate(s.startedUtc)}</td><td>${s.playerCount}</td><td>${s.winner ?? "–"}</td>
								<td class="actions"><a class="button" href="#/session/${s.id}">Auswertung</a></td></tr>`)
						: html`<tr><td colspan="5" class="empty">Noch keine gespielten Runden.</td></tr>`}
					</tbody>
				</table></div>
				${this.polls.length ? html`<h2>Letzte Direktfragen</h2>
				<div class="box"><table>
					<thead><tr><th>Frage</th><th>Typ</th><th>Antworten</th><th>Datum</th></tr></thead>
					<tbody>${this.polls.map(p => html`<tr><td>${p.text}</td><td>${({ choice: "Auswahl", number: "Zahl", text: "Text" } as Record<string, string>)[p.kind] ?? p.kind}</td>
						<td>${p.answerCount}</td><td class="muted">${fmtDate(p.createdUtc)}</td></tr>`)}</tbody>
				</table></div>` : nothing}
				<p class="muted" style="margin-top:24px">Tipp: „Raum vorbereiten“ legt die Runde schon vor der Vorlesung an – PIN und QR-Code können dann in die Folien.
					Mit der 📱 Fernbedienung steuerst du die Leinwand vom Handy aus.</p>
			</main>
			${this.startDlg ? this.renderStart() : nothing}
			${this.shareDlg ? this.renderShare() : nothing}
			${this.remoteDlg ? this.renderRemote() : nothing}`;
	}

	private renderImport() {
		return html`<div class="box" style="padding:16px;margin-bottom:8px">
			<h2 style="margin-top:0">Fragen importieren${this.folder ? html` <span class="muted small">→ 📁 ${this.folder.name}</span>` : nothing}</h2>
			<form class="imp-row" @submit=${(e: Event) => this.importUrl(e)}>
				<label class="field" style="flex:1;margin:0"><span>Kahoot-Link (öffentliches Kahoot, z. B. https://create.kahoot.it/details/…)</span>
					<input type="text" id="impUrl" placeholder="https://create.kahoot.it/details/…"></label>
				<button class="primary" type="submit" ?disabled=${this.importBusy}>Von Kahoot laden</button>
			</form>
			<p class="muted" style="margin:12px 0 6px">… oder Datei hochladen: <b>Kahoot-Tabellenvorlage (.xlsx)</b>, CSV mit den Spalten <i>Question; Answer 1–6; Time limit; Correct answer(s)</i>
				(z. B. „1,3“) oder eine Podium-/Kahoot-<b>JSON</b>-Datei.</p>
			<input type="file" accept=".xlsx,.csv,.tsv,.txt,.json" ?disabled=${this.importBusy} @change=${(e: Event) => this.importFile(e)}>
			<p class="muted" style="margin-bottom:0">Private Kahoots: In Kahoot unter „Teilen“ auf öffentlich stellen oder die Fragen in die offizielle Kahoot-Excel-Vorlage kopieren. Kahoot-Umfragen, Word Clouds und Schieberegler werden übersprungen – die gehen hier als ⚡ Direktfrage.</p>
		</div>`;
	}

	private renderRooms() {
		return html`<h2>Offene Räume</h2>
			<div class="box"><table>
				<thead><tr><th>Runde</th><th>PIN</th><th>Stand</th><th>Teilnehmende</th><th></th></tr></thead>
				<tbody>${this.rooms.map(r => html`<tr>
					<td><b>${r.title}</b><div class="muted small">angelegt ${fmtDate(r.createdUtc)}</div></td>
					<td><b class="pin-s">${r.pin}</b></td>
					<td>${PHASE[r.phase] ?? r.phase}</td>
					<td>${r.players}</td>
					<td class="actions">
						<a class="button primary" href="#/host/${r.pin}/${r.hostKey}">🖥 Leinwand</a>
						<button @click=${() => { this.remoteDlg = r; }} title="Mit dem Handy steuern">📱 Fernbedienung</button>
						<a class="button" href="api/qr?data=${encodeURIComponent(r.joinUrl)}" download="podium-qr-${r.pin}.svg" title="QR-Code zum Beitreten als SVG (für Folien)">QR für Folien</a>
						<button class="danger" @click=${() => this.closeRoom(r)}>Schließen</button>
					</td></tr>`)}</tbody>
			</table></div>`;
	}

	private renderStart() {
		const d = this.startDlg!;
		const q = d.quiz;
		const folder = this.folders.find(f => f.id === (q ? q.folderId ?? 0 : d.folderId));
		return html`<div class="modal-bg" @click=${(e: Event) => { if (e.target === e.currentTarget && !d.busy) this.startDlg = null; }}>
			<div class="modal box" role="dialog" aria-label="Runde starten">
				<h2>${q ? html`▶ „${q.title}“ starten` : "⚡ Live-Fragerunde"}</h2>
				${folder?.pin ? html`<p class="muted">🔒 Kurs-PIN <b>${folder.pin}</b> (Ordner „${folder.name}“)</p>` : nothing}
				${q ? html`
					<label class="radio"><input type="radio" name="sel" .checked=${d.all} @change=${() => { this.startDlg = { ...d, all: true }; }}> Alle ${q.questionCount} Fragen</label>
					<label class="radio"><input type="radio" name="sel" .checked=${!d.all} @change=${() => { this.startDlg = { ...d, all: false }; void this.loadQuestions(); }}> Nur ausgewählte Fragen (z. B. heute nur Kapitel 3)</label>
					${!d.all ? (d.questions ? html`<div class="pick-list">
						<label class="pick-all"><input type="checkbox" .checked=${d.pick.size === d.questions.length}
							@change=${(e: Event) => { this.startDlg = { ...d, pick: (e.target as HTMLInputElement).checked ? new Set(d.questions!.map((_, i) => i)) : new Set() }; }}> alle</label>
						${d.questions.map((x, i) => html`<label><input type="checkbox" .checked=${d.pick.has(i)}
							@change=${(e: Event) => { const s = new Set(d.pick); if ((e.target as HTMLInputElement).checked) s.add(i); else s.delete(i); this.startDlg = { ...d, pick: s }; }}>
							${i + 1}. ${mdPlain(x.text)}</label>`)}
					</div>` : html`<p class="muted">Lade Fragen …</p>`) : nothing}`
				: html`<p class="muted">Ein Raum ohne Quiz für spontane Fragen (⚡ Direktfrage). Teilnehmende antworten anonym per QR-Code.</p>`}
				<div class="toolbar">
					<button ?disabled=${d.busy} @click=${() => { this.startDlg = null; }}>Abbrechen</button>
					<span class="spacer"></span>
					<button ?disabled=${d.busy} @click=${() => this.start(false)} title="Raum anlegen, Leinwand später öffnen – PIN und QR-Code stehen sofort fest">Raum vorbereiten</button>
					<button class="primary" ?disabled=${d.busy} @click=${() => this.start(true)}>Jetzt starten ▶</button>
				</div>
			</div></div>`;
	}

	private renderShare() {
		const s = this.shareDlg!;
		return html`<div class="modal-bg" @click=${(e: Event) => { if (e.target === e.currentTarget) this.shareDlg = null; }}>
			<div class="modal box" role="dialog" aria-label="Quiz teilen">
				<h2>🔗 „${s.quiz.title}“ teilen</h2>
				<p>Wer diesen Link öffnet und ein Podium-Konto hat, kann sich eine <b>eigene Kopie</b> des Quiz anlegen. Dein Original bleibt unverändert.</p>
				<div class="imp-row"><input type="text" readonly .value=${s.link} @focus=${(e: Event) => (e.target as HTMLInputElement).select()} style="flex:1">
					<button class="primary" @click=${() => void navigator.clipboard.writeText(s.link).then(() => toast("Link kopiert."))}>Kopieren</button></div>
				<div class="toolbar"><button class="danger" @click=${() => this.unshare(s.quiz)}>Link zurückziehen</button><span class="spacer"></span>
					<button @click=${() => { this.shareDlg = null; }}>Schließen</button></div>
			</div></div>`;
	}

	private renderRemote() {
		const r = this.remoteDlg!;
		// gleiche Basisadresse wie der Beitrittslink (lokal mit LAN-IP statt localhost, damit das Handy sie erreicht)
		const url = r.joinUrl.replace(/#\/.*$/, `#/remote/${r.pin}`);
		return html`<div class="modal-bg" @click=${(e: Event) => { if (e.target === e.currentTarget) this.remoteDlg = null; }}>
			<div class="modal box" role="dialog" aria-label="Fernbedienung">
				<h2>📱 Fernbedienung für Raum ${r.pin}</h2>
				<p>Scanne den Code mit deinem Handy. Dort meldest du dich mit deinem Konto an und steuerst die Leinwand: weiter, überspringen,
					Direktfragen, Sieger-Song. Du siehst außerdem die richtige Antwort, deine Notizen und die nächste Frage.</p>
				<div class="remote-qr"><img src="api/qr?data=${encodeURIComponent(url)}" alt="QR-Code zur Fernbedienung"></div>
				<p class="muted small" style="word-break:break-all">${url}</p>
				<p class="muted small">Der Code enthält keinen Schlüssel – ohne Anmeldung als Besitzer·in lässt sich nichts steuern.</p>
				<div class="toolbar"><span class="spacer"></span><button @click=${() => { this.remoteDlg = null; }}>Schließen</button></div>
			</div></div>`;
	}

	private renderTrash() {
		return html`
			${teacherHeader(this.me, html`<a class="button" href="#/">← Zur Übersicht</a>`)}
			<main>
				<div class="quiz-head"><h2>🗑 Papierkorb</h2><span class="spacer"></span>
					${this.trashed.length ? html`<button class="danger" @click=${() => this.purgeAll()}>Papierkorb leeren</button>` : nothing}</div>
				<p class="muted">Gelöschte Quizze bleiben 30 Tage hier und werden dann endgültig entfernt.</p>
				<div class="box"><table>
					<thead><tr><th>Titel</th><th>Fragen</th><th>Gelöscht</th><th></th></tr></thead>
					<tbody>${this.trashed.length ? this.trashed.map(t => html`<tr>
						<td><b>${t.title}</b></td><td>${t.questionCount}</td><td class="muted">${fmtDate(t.deletedUtc)}</td>
						<td class="actions"><button class="primary" @click=${() => this.restore(t.id)}>Wiederherstellen</button>
							<button class="danger" @click=${() => this.purge(t.id, t.title)}>Endgültig löschen</button></td></tr>`)
					: html`<tr><td colspan="4" class="empty">Der Papierkorb ist leer.</td></tr>`}</tbody>
				</table></div>
			</main>`;
	}
}
