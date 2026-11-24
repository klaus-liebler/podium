// Quiz-Editor: Fragen vom Typ Auswahl (2–6 Antworten, 1..n richtig), Schätzfrage (Zahl ± Toleranz) und Reihenfolge,
// je mit Zeit, Punkten, Erklärung zur Lösung und Notizen (nur Fernbedienung).
// Komfort: automatisches Speichern (Entwurf im Browser + Server, sobald gültig), Warnung beim Verlassen, Strg+S,
// Enter = nächste Antwort, Ziehen zum Umsortieren, Einstellungen für alle Fragen, Fragen aus anderen Quizzen, KI-Vorschläge.
import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LETTERS, LightElement, fmtNum, nav, shape, store, toast } from "../core/util.ts";
import type { QuestionDto, QuestionKind, QuizDto, QuizSummary } from "../core/types.ts";
import "./md-input.ts";
import { ApiError, api, getMe, teacherHeader, type Me } from "../core/session.ts";
import { THEMES } from "../three/stage.ts";
import { mdPlain } from "../core/markdown.ts";

const TIMES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const opt = (text = "", isCorrect = false) => ({ text, isCorrect });
const blankQ = (kind: QuestionKind | "tf" = "choice"): QuestionDto => {
	const base = { text: "", timeLimitSeconds: 20, pointsMultiplier: 1, explanation: "", notes: "" };
	switch (kind) {
		case "tf": return { ...base, kind: "choice", timeLimitSeconds: 15, options: [opt("Wahr"), opt("Falsch")] };
		case "estimate": return { ...base, kind: "estimate", timeLimitSeconds: 30, options: [], correctValue: null, tolerance: 0, unit: "" };
		case "order": return { ...base, kind: "order", timeLimitSeconds: 30, options: [opt("", true), opt("", true), opt("", true)] };
		default: return { ...base, kind: "choice", options: [opt(), opt(), opt(), opt()] };
	}
};
const KINDS: [QuestionKind | "tf", string][] = [["choice", "Auswahl"], ["tf", "Wahr/Falsch"], ["estimate", "Schätzfrage"], ["order", "Reihenfolge"]];
const kindOf = (q: QuestionDto): QuestionKind => q.kind ?? "choice";
const isTf = (q: QuestionDto) => kindOf(q) === "choice" && q.options.length === 2 && q.options[0].text === "Wahr" && q.options[1].text === "Falsch";
const AUTOSAVE_MS = 2500;
const draftKey = (id: number) => `podium-draft-${id || "new"}`;
interface Draft { at: string; quiz: QuizDto; }

@customElement("quiz-editor")
export class QuizEditor extends LightElement {
	@property({ type: Number }) quizId = 0;
	/** nur für neue Quizze: Zielordner */
	@property({ type: Number }) folderId = 0;
	@state() private quiz: QuizDto = { id: 0, title: "", description: "", questions: [] };
	@state() private msg: { text: string; ok: boolean } | null = null;
	@state() private loading = true;
	/** nach dem ersten Speicherversuch: Probleme direkt an den Fragen anzeigen */
	@state() private checked = false;
	@state() private me: Me | null = null;
	/** Stand auf dem Server (JSON) – Vergleich für „ungespeichert“ */
	private savedJson = "";
	@state() private status: "" | "dirty" | "saving" | "saved" | "invalid" = "";
	@state() private savedAt = "";
	@state() private draft: Draft | null = null;
	private timer = 0;
	private dragFrom = -1;
	@state() private dragOver = -1;
	// Fragen aus anderem Quiz
	@state() private pool: { quizzes: QuizSummary[]; id: number; questions: QuestionDto[]; pick: Set<number> } | null = null;
	// KI-Vorschläge
	@state() private ai: { enabled: boolean; text: string; count: number; file: File | null; busy: boolean; error: string; results: QuestionDto[]; pick: Set<number> } | null = null;

	override connectedCallback() {
		super.connectedCallback();
		document.body.className = "teacher";
		document.title = "Podium – Quiz bearbeiten";
		void getMe().then(m => { this.me = m; });
		window.addEventListener("keydown", this.onKey);
		window.addEventListener("beforeunload", this.onUnload);
		nav.guard = () => !this.dirty || confirm("Es gibt ungespeicherte Änderungen. Trotzdem verlassen?\n\n(Ein Entwurf bleibt in diesem Browser erhalten.)");
	}
	override disconnectedCallback() {
		super.disconnectedCallback();
		window.removeEventListener("keydown", this.onKey);
		window.removeEventListener("beforeunload", this.onUnload);
		nav.guard = null;
		clearTimeout(this.timer);
	}
	private onKey = (e: KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") { e.preventDefault(); void this.save(); }
	};
	private onUnload = (e: BeforeUnloadEvent) => { if (this.dirty) { this.storeDraft(); e.preventDefault(); } };

	protected override async willUpdate(changed: Map<string, unknown>) {
		if (!changed.has("quizId")) return;
		if (!this.quizId) {
			this.quiz = { id: 0, title: "", description: "", folderId: this.folderId || null, theme: "", questions: [blankQ()] };
			this.savedJson = JSON.stringify(this.quiz);
			this.loading = false;
		} else {
			try { this.quiz = await api<QuizDto>(`quizzes/${this.quizId}`); this.savedJson = JSON.stringify(this.quiz); this.loading = false; }
			catch (e) { if ((e as ApiError).status !== 401) this.msg = { text: "Quiz nicht gefunden.", ok: false }; return; }
		}
		// Entwurf aus einer früheren Sitzung (z. B. Tab geschlossen, Verbindung weg)?
		const d = store.get<Draft | null>(draftKey(this.quizId), null);
		this.draft = d && JSON.stringify(d.quiz) !== this.savedJson ? d : null;
		if (!this.draft) store.del(draftKey(this.quizId));
	}

	private get dirty() { return !this.loading && JSON.stringify(this.quiz) !== this.savedJson; }

	/** nach jeder Änderung: neu zeichnen (bei Bedarf), Entwurf sichern, automatisches Speichern planen */
	private changed(render = true) {
		if (render) this.quiz = { ...this.quiz };
		this.status = this.dirty ? "dirty" : this.status === "dirty" ? "" : this.status;
		clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.storeDraft();
			if (this.quizId && this.dirty) void this.save(true);
		}, AUTOSAVE_MS);
	}
	private storeDraft() { if (this.dirty) store.set(draftKey(this.quizId), { at: new Date().toISOString(), quiz: this.quiz } satisfies Draft); }
	private restoreDraft() {
		if (!this.draft) return;
		this.quiz = { ...this.draft.quiz, id: this.quiz.id };
		this.draft = null;
		this.changed(false);
		toast("Entwurf wiederhergestellt – noch nicht gespeichert.");
	}
	private dropDraft() { store.del(draftKey(this.quizId)); this.draft = null; }

	private q(i: number) { return this.quiz.questions[i]; }

	private act(qi: number, a: string, oi = 0) {
		const qs = this.quiz.questions, q = qs[qi];
		switch (a) {
			case "up": [qs[qi - 1], qs[qi]] = [qs[qi], qs[qi - 1]]; break;
			case "down": [qs[qi + 1], qs[qi]] = [qs[qi], qs[qi + 1]]; break;
			case "dup": qs.splice(qi + 1, 0, structuredClone(q)); break;
			case "del": if (!confirm(`Frage ${qi + 1} löschen?`)) return; qs.splice(qi, 1); break;
			case "addopt": if (q.options.length < 6) q.options.push(opt("", kindOf(q) === "order")); break;
			case "delopt": if (q.options.length > 2) q.options.splice(oi, 1); break;
		}
		this.changed();
	}

	/** Fragetyp wechseln – vorhandene Texte bleiben, soweit sie passen */
	private setKind(qi: number, k: QuestionKind | "tf") {
		const q = this.q(qi);
		if (k === "tf") { q.kind = "choice"; q.options = [opt("Wahr", q.options[0]?.isCorrect ?? true), opt("Falsch", q.options[1]?.isCorrect ?? false)]; }
		else if (k === "estimate") { q.kind = "estimate"; q.options = []; q.correctValue ??= null; q.tolerance ??= 0; q.unit ??= ""; }
		else {
			const keep = q.options.filter(o => o.text.trim() && !(isTf(q) && (o.text === "Wahr" || o.text === "Falsch")));
			q.kind = k;
			q.options = (keep.length >= 2 ? keep : [...keep, ...Array.from({ length: (k === "order" ? 3 : 4) - keep.length }, () => opt())])
				.map(o => ({ ...o, isCorrect: k === "order" ? true : o.isCorrect }));
		}
		this.changed();
	}

	/** Enter in einer Antwort: zur nächsten springen bzw. eine neue anlegen */
	private async nextOption(qi: number, oi: number) {
		const q = this.q(qi);
		if (oi === q.options.length - 1) {
			if (q.options.length >= 6) return;
			this.act(qi, "addopt");
			await this.updateComplete;
		}
		this.querySelectorAll(".box.q")[qi]?.querySelectorAll<HTMLTextAreaElement>(".opt textarea")[oi + 1]?.focus();
	}

	// ------------------------------------------------------------ Prüfen und Speichern
	/** Probleme einer Frage (leer = in Ordnung) */
	private problems(q: QuestionDto): string[] {
		const p: string[] = [];
		if (!q.text.trim()) p.push("Fragetext fehlt.");
		switch (kindOf(q)) {
			case "estimate":
				if (q.correctValue == null || !Number.isFinite(q.correctValue)) p.push("Richtiger Wert fehlt.");
				if ((q.tolerance ?? 0) < 0) p.push("Toleranz darf nicht negativ sein.");
				break;
			case "order":
				q.options.forEach((o, i) => { if (!o.text.trim()) p.push(`Element ${i + 1} ist leer.`); });
				break;
			default:
				q.options.forEach((o, i) => { if (!o.text.trim()) p.push(`Antwort ${LETTERS[i]} ist leer.`); });
				if (!q.options.some(o => o.isCorrect)) p.push("Keine Antwort als richtig markiert.");
		}
		return p;
	}
	private get valid() { return !!this.quiz.title.trim() && this.quiz.questions.length > 0 && this.quiz.questions.every(q => !this.problems(q).length); }

	private async save(auto = false) {
		clearTimeout(this.timer);
		if (auto && !this.valid) { this.status = "invalid"; this.storeDraft(); return; }
		if (!auto) {
			this.checked = true;
			if (!this.quiz.title.trim()) { this.changed(); toast("Bitte einen Titel angeben.", 4000, "err"); this.querySelector<HTMLInputElement>("input.title")?.focus(); return; }
			const bad = this.quiz.questions.findIndex(q => this.problems(q).length);
			if (bad >= 0) {
				this.changed();
				await this.updateComplete;
				this.querySelectorAll(".box.q")[bad]?.scrollIntoView({ behavior: "smooth", block: "center" });
				toast(`Frage ${bad + 1}: ${this.problems(this.quiz.questions[bad])[0]}`, 4000, "err");
				return;
			}
		}
		const sent = JSON.stringify(this.quiz);
		this.status = "saving";
		let d: { id: number };
		try { d = await api(this.quizId ? `quizzes/${this.quizId}` : "quizzes", { method: this.quizId ? "PUT" : "POST", json: this.quiz }); }
		catch (e) {
			this.status = "dirty"; this.storeDraft();
			if (auto) return;
			this.msg = { text: (e as Error).message, ok: false }; scrollTo({ top: 0, behavior: "smooth" }); return;
		}
		this.savedJson = sent;
		this.status = JSON.stringify(this.quiz) === sent ? "saved" : "dirty";
		this.savedAt = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
		this.msg = null;
		store.del(draftKey(this.quizId));
		if (!auto) toast("Quiz gespeichert.");
		if (!this.quizId) { this.savedJson = ""; nav.guard = null; location.hash = `#/edit/${d.id}`; }
	}

	// ------------------------------------------------------------ Für alle Fragen
	private bulk(field: "timeLimitSeconds" | "pointsMultiplier", v: number) {
		if (!v && field === "timeLimitSeconds") return;
		this.quiz.questions.forEach(q => { q[field] = v; });
		this.changed();
		toast(field === "timeLimitSeconds" ? `Alle Fragen: ${v} Sekunden.` : "Punkte für alle Fragen gesetzt.");
	}

	// ------------------------------------------------------------ Ziehen und Ablegen
	private drop(to: number) {
		const from = this.dragFrom; this.dragFrom = -1; this.dragOver = -1;
		if (from < 0 || from === to) return;
		const qs = this.quiz.questions;
		const [m] = qs.splice(from, 1);
		qs.splice(to, 0, m);
		this.changed();
	}

	// ------------------------------------------------------------ Fragen aus anderem Quiz
	private async openPool() {
		const quizzes = (await api<QuizSummary[]>("quizzes")).filter(q => q.id !== this.quizId);
		if (!quizzes.length) { toast("Es gibt noch keine anderen Quizze."); return; }
		this.pool = { quizzes, id: 0, questions: [], pick: new Set() };
	}
	private async poolQuiz(id: number) {
		const q = await api<QuizDto>(`quizzes/${id}`);
		this.pool = { ...this.pool!, id, questions: q.questions, pick: new Set() };
	}
	private addQuestions(list: QuestionDto[]) {
		if (!list.length) return;
		const qs = this.quiz.questions;
		// leere Startfrage ersetzen
		if (qs.length === 1 && !qs[0].text.trim() && qs[0].options.every(o => !o.text.trim())) qs.length = 0;
		qs.push(...list.map(q => structuredClone(q)));
		this.changed();
		toast(list.length === 1 ? "1 Frage übernommen." : `${list.length} Fragen übernommen.`);
	}

	// ------------------------------------------------------------ KI-Vorschläge
	private async openAi() {
		const info = await api<{ enabled: boolean }>("ai").catch(() => ({ enabled: false }));
		this.ai = { enabled: info.enabled, text: "", count: 5, file: null, busy: false, error: "", results: [], pick: new Set() };
	}
	private async runAi() {
		const a = this.ai!;
		if (!a.text.trim() && !a.file) { this.ai = { ...a, error: "Bitte Text einfügen oder eine PDF-Datei wählen." }; return; }
		this.ai = { ...a, busy: true, error: "" };
		const fd = new FormData();
		fd.append("text", a.text); fd.append("count", String(a.count));
		if (a.file) fd.append("file", a.file);
		try {
			const r = await api<{ questions: QuestionDto[] }>("ai/questions", { method: "POST", body: fd });
			this.ai = { ...this.ai!, busy: false, results: r.questions, pick: new Set(r.questions.map((_, i) => i)) };
		} catch (e) { this.ai = { ...this.ai!, busy: false, error: (e as Error).message }; }
	}

	// ------------------------------------------------------------ Rendering
	protected override render() {
		const qs = this.quiz.questions;
		return html`
			${teacherHeader(this.me, html`<a class="button" href=${this.quiz.folderId ? `#/folder/${this.quiz.folderId}` : "#/"}>← Zur Übersicht</a>`)}
			<main>
				${this.msg ? html`<div class="msg ${this.msg.ok ? "ok" : "err"}">${this.msg.text}</div>` : nothing}
				${this.draft ? html`<div class="msg warn" role="alert">Es gibt einen nicht gespeicherten Entwurf vom ${new Date(this.draft.at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}.
					<button class="primary" @click=${() => this.restoreDraft()}>Wiederherstellen</button> <button @click=${() => this.dropDraft()}>Verwerfen</button></div>` : nothing}
				${this.loading ? html`<div class="box empty">Lade …</div>` : html`
				<div class="box" style="padding:16px;margin-bottom:16px">
					<label class="field"><span>Titel</span>
						<input type="text" class="title" maxlength="120" .value=${this.quiz.title} @input=${(e: InputEvent) => { this.quiz.title = (e.target as HTMLInputElement).value; this.changed(false); }}></label>
					<label class="field"><span>Beschreibung (optional)</span>
						<input type="text" maxlength="300" .value=${this.quiz.description ?? ""} @input=${(e: InputEvent) => { this.quiz.description = (e.target as HTMLInputElement).value; this.changed(false); }}></label>
					<div class="q-meta" style="margin:0">
						<label class="field" style="margin:0"><span>3D-Welt auf der Leinwand</span>
							<select @change=${(e: Event) => { this.quiz.theme = (e.target as HTMLSelectElement).value; this.changed(); }}>
								<option value="" ?selected=${!this.quiz.theme}>wie zuletzt gewählt</option>
								${THEMES.map(t => html`<option value=${t.id} ?selected=${this.quiz.theme === t.id}>${t.icon} ${t.label}</option>`)}
							</select></label>
						<div class="field" style="margin:0"><span>Musik</span>
							${this.quizId ? html`<a class="button" href="#/music/quiz/${this.quizId}" title="Eigene Musik nur für dieses Quiz">🎵 Musik für dieses Quiz</a>`
							: html`<span class="muted small">nach dem ersten Speichern wählbar</span>`}</div>
					</div>
				</div>
				${qs.length > 1 ? html`<div class="box bulk-bar">
					<b>Für alle Fragen:</b>
					<label>Antwortzeit <select @change=${(e: Event) => { const s = e.target as HTMLSelectElement; this.bulk("timeLimitSeconds", Number(s.value)); s.value = ""; }}>
						<option value="">— wählen —</option>${TIMES.map(t => html`<option value=${t}>${t} Sekunden</option>`)}</select></label>
					<label>Punkte <select @change=${(e: Event) => { const s = e.target as HTMLSelectElement; if (s.value) this.bulk("pointsMultiplier", Number(s.value)); s.value = ""; }}>
						<option value="">— wählen —</option><option value="1">Standard</option><option value="2">Doppelt</option><option value="0">Ohne Punkte</option></select></label>
				</div>` : nothing}
				${qs.length === 0 ? html`<div class="box empty">Noch keine Fragen.</div>` : nothing}
				${qs.map((q, qi) => this.question(q, qi, qs.length))}
				<div class="toolbar add-bar">
					${KINDS.map(([k, l]) => html`<button @click=${() => { qs.push(blankQ(k)); this.changed(); }}>+ ${l}</button>`)}
					<button @click=${() => this.openPool()} title="Fragen aus einem anderen eigenen Quiz übernehmen">📋 Aus anderem Quiz</button>
					<button @click=${() => this.openAi()} title="Fragen aus Text oder PDF vorschlagen lassen (Claude)">✨ KI-Vorschläge</button>
				</div>
				<div class="toolbar save-bar">
					<span class="save-status ${this.status}" role="status">${this.statusText()}</span>
					<span class="spacer"></span>
					<span class="muted">${qs.length} Frage(n)</span>
					<button class="primary" title="Speichern (Strg+S)" @click=${() => this.save()}>Speichern</button>
				</div>`}
			</main>
			${this.pool ? this.poolDialog() : nothing}
			${this.ai ? this.aiDialog() : nothing}`;
	}

	private statusText() {
		switch (this.status) {
			case "dirty": return this.quizId ? "Ungespeicherte Änderungen – wird automatisch gespeichert" : "Noch nicht gespeichert";
			case "saving": return "Speichert …";
			case "saved": return `✓ Gespeichert ${this.savedAt}`;
			case "invalid": return "Nicht automatisch gespeichert: Es fehlen noch Angaben (Entwurf im Browser gesichert)";
			default: return this.quizId ? "Änderungen werden automatisch gespeichert" : "";
		}
	}

	private question(q: QuestionDto, qi: number, n: number) {
		const probs = this.checked ? this.problems(q) : [];
		const kind = kindOf(q);
		return html`
		<div class="box q ${probs.length ? "invalid" : ""} ${this.dragOver === qi ? "drop-here" : ""}"
			@dragover=${(e: DragEvent) => { if (this.dragFrom >= 0) { e.preventDefault(); this.dragOver = qi; } }}
			@dragleave=${() => { if (this.dragOver === qi) this.dragOver = -1; }}
			@drop=${(e: DragEvent) => { e.preventDefault(); this.drop(qi); }}>
			<div class="q-head">
				<span class="drag" draggable="true" title="Ziehen zum Verschieben" aria-hidden="true"
					@dragstart=${(e: DragEvent) => { this.dragFrom = qi; e.dataTransfer?.setData("text/plain", String(qi)); }}
					@dragend=${() => { this.dragFrom = -1; this.dragOver = -1; }}>⠿</span>
				<b>Frage ${qi + 1}</b>
				<select class="kind" aria-label="Fragetyp" @change=${(e: Event) => this.setKind(qi, (e.target as HTMLSelectElement).value as QuestionKind | "tf")}>
					${KINDS.map(([k, l]) => html`<option value=${k} ?selected=${k === "tf" ? isTf(q) : k === kind && !(k === "choice" && isTf(q))}>${l}</option>`)}
				</select>
				<span class="spacer"></span>
				<button ?disabled=${qi === 0} title="Nach oben" aria-label="Nach oben" @click=${() => this.act(qi, "up")}>↑</button>
				<button ?disabled=${qi === n - 1} title="Nach unten" aria-label="Nach unten" @click=${() => this.act(qi, "down")}>↓</button>
				<button @click=${() => this.act(qi, "dup")}>Duplizieren</button>
				<button class="danger" @click=${() => this.act(qi, "del")}>Löschen</button>
			</div>
			${probs.length ? html`<div class="q-problems" role="alert">${probs.map(p => html`<span>⚠ ${p}</span>`)}</div>` : nothing}
			<div class="field"><span>Fragetext</span>
				<md-input .value=${q.text} maxlength="1000" rows="2" placeholder="Fragetext"
					.onValue=${(v: string) => { this.q(qi).text = v; this.changed(this.checked); }}></md-input></div>
			<div class="q-meta">
				<label class="field"><span>Antwortzeit</span>
					<select @change=${(e: Event) => { this.q(qi).timeLimitSeconds = Number((e.target as HTMLSelectElement).value); this.changed(false); }}>
						${TIMES.map(t => html`<option value=${t} ?selected=${t === q.timeLimitSeconds}>${t} Sekunden</option>`)}
					</select></label>
				<label class="field"><span>Punkte</span>
					<select @change=${(e: Event) => { this.q(qi).pointsMultiplier = Number((e.target as HTMLSelectElement).value); this.changed(false); }}>
						<option value="1" ?selected=${q.pointsMultiplier === 1}>Standard</option>
						<option value="2" ?selected=${q.pointsMultiplier === 2}>Doppelt</option>
						<option value="0" ?selected=${q.pointsMultiplier === 0}>Ohne Punkte</option>
					</select></label>
			</div>
			${kind === "estimate" ? this.estimateFields(q) : this.optionFields(q, qi, kind)}
			<details class="q-extra" ?open=${!!(q.explanation || q.notes)}>
				<summary>Erklärung zur Lösung und Notizen</summary>
				<div class="field"><span>Erklärung (erscheint mit der Lösung auf Leinwand und Handys)</span>
					<md-input .value=${q.explanation ?? ""} maxlength="2000" rows="2" placeholder="Warum ist das die richtige Antwort?"
						.onValue=${(v: string) => { this.q(qi).explanation = v; this.changed(false); }}></md-input></div>
				<label class="field" style="margin-bottom:0"><span>Notizen für mich (nur auf der Fernbedienung sichtbar)</span>
					<textarea rows="2" maxlength="2000" .value=${q.notes ?? ""} placeholder="z. B. Hinweis zum Weiterleiten auf das nächste Kapitel"
						@input=${(e: InputEvent) => { this.q(qi).notes = (e.target as HTMLTextAreaElement).value; this.changed(false); }}></textarea></label>
			</details>
		</div>`;
	}

	private optionFields(q: QuestionDto, qi: number, kind: QuestionKind) {
		const order = kind === "order";
		return html`
			<div class="muted" style="font-size:13px;font-weight:600">${order
				? "Elemente in der richtigen Reihenfolge (2–6) – auf den Handys erscheinen sie gemischt"
				: "Antwortmöglichkeiten (2–6, mindestens eine richtig) – Enter springt zur nächsten"}</div>
			${q.options.map((o, oi) => html`
				<div class="opt">
					${order ? html`<span class="badge order">${oi + 1}.</span>` : html`<span class="badge c${oi}">${shape(oi)}${LETTERS[oi]}</span>`}
					<md-input .value=${o.text} maxlength="300" rows="1" placeholder=${order ? `Element ${oi + 1}` : `Antwort ${LETTERS[oi]}`}
						.onValue=${(v: string) => { o.text = v; this.changed(this.checked); }} .onEnter=${() => void this.nextOption(qi, oi)}></md-input>
					${order ? nothing : html`<label class="correct"><input type="checkbox" .checked=${o.isCorrect}
						@change=${(e: Event) => { o.isCorrect = (e.target as HTMLInputElement).checked; this.changed(); }}> richtig</label>`}
					<button ?disabled=${q.options.length <= 2} title="Entfernen" aria-label="Entfernen" @click=${() => this.act(qi, "delopt", oi)}>✕</button>
				</div>`)}
			<button ?disabled=${q.options.length >= 6} @click=${() => this.act(qi, "addopt")}>+ ${order ? "Element" : "Antwort"}</button>`;
	}

	private estimateFields(q: QuestionDto) {
		const num = (v: string) => { const n = parseFloat(v.replace(",", ".")); return Number.isFinite(n) ? n : null; };
		return html`<div class="q-meta estimate">
			<label class="field"><span>Richtiger Wert</span>
				<input type="text" inputmode="decimal" .value=${q.correctValue == null ? "" : String(q.correctValue).replace(".", ",")}
					@input=${(e: InputEvent) => { q.correctValue = num((e.target as HTMLInputElement).value); this.changed(false); }}></label>
			<label class="field"><span>Toleranz (±) – zählt noch als richtig</span>
				<input type="text" inputmode="decimal" .value=${String(q.tolerance ?? 0).replace(".", ",")}
					@input=${(e: InputEvent) => { q.tolerance = num((e.target as HTMLInputElement).value) ?? 0; this.changed(false); }}></label>
			<label class="field"><span>Einheit (optional)</span>
				<input type="text" maxlength="12" .value=${q.unit ?? ""} placeholder="z. B. m, %, €"
					@input=${(e: InputEvent) => { q.unit = (e.target as HTMLInputElement).value; this.changed(false); }}></label>
		</div>
		<p class="muted small" style="margin-top:0">Richtig sind Schätzungen von ${fmtNum(q.correctValue == null ? null : q.correctValue - (q.tolerance ?? 0))}
			bis ${fmtNum(q.correctValue == null ? null : q.correctValue + (q.tolerance ?? 0), q.unit ?? "")}. Auf der Leinwand erscheinen danach Mittelwert, Median und die drei besten Schätzungen.</p>`;
	}

	private poolDialog() {
		const p = this.pool!;
		return html`<div class="modal-bg" @click=${(e: Event) => { if (e.target === e.currentTarget) this.pool = null; }}>
			<div class="modal box" role="dialog" aria-label="Fragen aus anderem Quiz">
				<h2>📋 Fragen aus einem anderen Quiz</h2>
				<label class="field"><span>Quiz</span>
					<select @change=${(e: Event) => this.poolQuiz(Number((e.target as HTMLSelectElement).value))}>
						<option value="0">— wählen —</option>
						${p.quizzes.map(q => html`<option value=${q.id} ?selected=${q.id === p.id}>${q.title} (${q.questionCount})</option>`)}
					</select></label>
				${p.questions.length ? html`
					<div class="pick-list">
						<label class="pick-all"><input type="checkbox" .checked=${p.pick.size === p.questions.length}
							@change=${(e: Event) => { this.pool = { ...p, pick: (e.target as HTMLInputElement).checked ? new Set(p.questions.map((_, i) => i)) : new Set() }; }}> alle</label>
						${p.questions.map((q, i) => html`<label><input type="checkbox" .checked=${p.pick.has(i)}
							@change=${(e: Event) => { const s = new Set(p.pick); if ((e.target as HTMLInputElement).checked) s.add(i); else s.delete(i); this.pool = { ...p, pick: s }; }}>
							${i + 1}. ${mdPlain(q.text)} <span class="muted small">${KINDS.find(k => k[0] === kindOf(q))?.[1]}</span></label>`)}
					</div>` : nothing}
				<div class="toolbar">
					<span class="spacer"></span>
					<button @click=${() => { this.pool = null; }}>Abbrechen</button>
					<button class="primary" ?disabled=${!p.pick.size} @click=${() => { this.addQuestions(p.questions.filter((_, i) => p.pick.has(i))); this.pool = null; }}>
						${p.pick.size ? `${p.pick.size} übernehmen` : "Übernehmen"}</button>
				</div>
			</div></div>`;
	}

	private aiDialog() {
		const a = this.ai!;
		return html`<div class="modal-bg" @click=${(e: Event) => { if (e.target === e.currentTarget && !a.busy) this.ai = null; }}>
			<div class="modal box wide" role="dialog" aria-label="KI-Vorschläge">
				<h2>✨ Fragen vorschlagen lassen</h2>
				${!a.enabled ? html`<p>Für KI-Vorschläge brauchst du einen eigenen <b>Claude-API-Schlüssel</b> (von console.anthropic.com).
					Hinterlege ihn unter <a href="#/account">Mein Konto</a> – er wird verschlüsselt gespeichert und nur für deine Anfragen verwendet.</p>
					<div class="toolbar"><span class="spacer"></span><button @click=${() => { this.ai = null; }}>Schließen</button></div>`
				: html`
				<p class="msg warn" style="margin-top:0">Der eingefügte Text bzw. die PDF-Datei wird zur Auswertung an <b>Anthropic (Claude)</b> übertragen und über deinen
					API-Schlüssel abgerechnet. Bitte keine personenbezogenen oder vertraulichen Inhalte verwenden. Prüfe jeden Vorschlag, bevor du ihn übernimmst.</p>
				${a.results.length ? html`
					<div class="pick-list">${a.results.map((q, i) => html`<label class="ai-q"><input type="checkbox" .checked=${a.pick.has(i)}
						@change=${(e: Event) => { const s = new Set(a.pick); if ((e.target as HTMLInputElement).checked) s.add(i); else s.delete(i); this.ai = { ...a, pick: s }; }}>
						<span><b>${mdPlain(q.text)}</b> <span class="muted small">${KINDS.find(k => k[0] === kindOf(q))?.[1]}</span><br>
						<span class="small">${kindOf(q) === "estimate" ? `→ ${fmtNum(q.correctValue, q.unit ?? "")} (± ${fmtNum(q.tolerance)})`
							: q.options.map((o, j) => html`<span class=${o.isCorrect && kindOf(q) === "choice" ? "ok-text" : ""}>${kindOf(q) === "order" ? `${j + 1}. ` : ""}${mdPlain(o.text)}</span>${j < q.options.length - 1 ? " · " : ""}`)}</span>
						${q.explanation ? html`<br><span class="muted small">💡 ${mdPlain(q.explanation)}</span>` : nothing}</span></label>`)}</div>
					<div class="toolbar"><button @click=${() => { this.ai = { ...a, results: [], pick: new Set() }; }}>← Neu anfragen</button><span class="spacer"></span>
						<button @click=${() => { this.ai = null; }}>Abbrechen</button>
						<button class="primary" ?disabled=${!a.pick.size} @click=${() => { this.addQuestions(a.results.filter((_, i) => a.pick.has(i))); this.ai = null; }}>${a.pick.size} übernehmen</button></div>`
				: html`
					<label class="field"><span>Text (z. B. Abschnitt aus dem Skript)</span>
						<textarea rows="8" maxlength="150000" .value=${a.text} ?disabled=${a.busy} @input=${(e: InputEvent) => { this.ai = { ...a, text: (e.target as HTMLTextAreaElement).value }; }}></textarea></label>
					<div class="q-meta">
						<label class="field"><span>… und/oder PDF (Folien, Skript, max. 20 MB)</span>
							<input type="file" accept=".pdf,application/pdf" ?disabled=${a.busy} @change=${(e: Event) => { this.ai = { ...a, file: (e.target as HTMLInputElement).files?.[0] ?? null }; }}></label>
						<label class="field"><span>Anzahl Fragen</span>
							<select ?disabled=${a.busy} @change=${(e: Event) => { this.ai = { ...a, count: Number((e.target as HTMLSelectElement).value) }; }}>
								${[3, 5, 8, 10, 15].map(n => html`<option value=${n} ?selected=${n === a.count}>${n}</option>`)}</select></label>
					</div>
					${a.error ? html`<div class="msg err">${a.error}</div>` : nothing}
					<div class="toolbar"><span class="spacer"></span>
						<button ?disabled=${a.busy} @click=${() => { this.ai = null; }}>Abbrechen</button>
						<button class="primary" ?disabled=${a.busy} @click=${() => this.runAi()}>${a.busy ? "Claude denkt nach … (bis zu einer Minute)" : "Vorschläge erzeugen"}</button></div>`}`}
			</div></div>`;
	}
}
