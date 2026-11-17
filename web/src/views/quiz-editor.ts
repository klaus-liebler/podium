// Quiz-Editor: beliebig viele Fragen, je 2–6 Antworten, 1..n richtig, Zeit und Punkte pro Frage.
import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LETTERS, LightElement, shape } from "../core/util.ts";
import type { QuestionDto, QuizDto } from "../core/types.ts";
import { ApiError, api, getMe, teacherHeader, type Me } from "../core/session.ts";

const TIMES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const blankQ = (): QuestionDto => ({
	text: "", timeLimitSeconds: 20, pointsMultiplier: 1,
	options: [{ text: "", isCorrect: true }, { text: "", isCorrect: false }, { text: "", isCorrect: false }, { text: "", isCorrect: false }],
});

@customElement("quiz-editor")
export class QuizEditor extends LightElement {
	@property({ type: Number }) quizId = 0;
	@state() private quiz: QuizDto = { id: 0, title: "", description: "", questions: [] };
	@state() private msg: { text: string; ok: boolean } | null = null;
	@state() private loading = true;

	override connectedCallback() {
		super.connectedCallback();
		document.body.className = "teacher";
		document.title = "Podium – Quiz bearbeiten";
		void getMe().then(m => { this.me = m; });
	}
	@state() private me: Me | null = null;

	protected override async willUpdate(changed: Map<string, unknown>) {
		if (!changed.has("quizId")) return;
		if (!this.quizId) { this.quiz = { id: 0, title: "", description: "", questions: [blankQ()] }; this.loading = false; return; }
		try { this.quiz = await api<QuizDto>(`quizzes/${this.quizId}`); this.loading = false; }
		catch (e) { if ((e as ApiError).status !== 401) this.msg = { text: "Quiz nicht gefunden.", ok: false }; }
	}

	private touch() { this.quiz = { ...this.quiz }; }
	private q(i: number) { return this.quiz.questions[i]; }

	private act(qi: number, a: string, oi = 0) {
		const qs = this.quiz.questions, q = qs[qi];
		switch (a) {
			case "up": [qs[qi - 1], qs[qi]] = [qs[qi], qs[qi - 1]]; break;
			case "down": [qs[qi + 1], qs[qi]] = [qs[qi], qs[qi + 1]]; break;
			case "dup": qs.splice(qi + 1, 0, structuredClone(q)); break;
			case "del": if (!confirm(`Frage ${qi + 1} löschen?`)) return; qs.splice(qi, 1); break;
			case "addopt": if (q.options.length < 6) q.options.push({ text: "", isCorrect: false }); break;
			case "delopt": if (q.options.length > 2) q.options.splice(oi, 1); break;
		}
		this.touch();
	}

	private async save() {
		let d: { id: number };
		try { d = await api(this.quizId ? `quizzes/${this.quizId}` : "quizzes", { method: this.quizId ? "PUT" : "POST", json: this.quiz }); }
		catch (e) { this.msg = { text: (e as Error).message, ok: false }; scrollTo({ top: 0, behavior: "smooth" }); return; }
		this.msg = { text: "Gespeichert.", ok: true };
		if (!this.quizId) location.hash = `#/edit/${d.id}`;
	}

	protected override render() {
		const qs = this.quiz.questions;
		return html`
			${teacherHeader(this.me, html`<a class="button" href="#/">← Zur Übersicht</a>`)}
			<main>
				${this.msg ? html`<div class="msg ${this.msg.ok ? "ok" : "err"}">${this.msg.text}</div>` : nothing}
				${this.loading ? html`<div class="box empty">Lade …</div>` : html`
				<div class="box" style="padding:16px;margin-bottom:16px">
					<label class="field"><span>Titel</span>
						<input type="text" maxlength="120" .value=${this.quiz.title} @input=${(e: InputEvent) => { this.quiz.title = (e.target as HTMLInputElement).value; }}></label>
					<label class="field" style="margin-bottom:0"><span>Beschreibung (optional)</span>
						<input type="text" maxlength="300" .value=${this.quiz.description ?? ""} @input=${(e: InputEvent) => { this.quiz.description = (e.target as HTMLInputElement).value; }}></label>
				</div>
				${qs.length === 0 ? html`<div class="box empty">Noch keine Fragen.</div>` : nothing}
				${qs.map((q, qi) => html`
					<div class="box q">
						<div class="q-head">
							<b>Frage ${qi + 1}</b>
							<button ?disabled=${qi === 0} title="Nach oben" @click=${() => this.act(qi, "up")}>↑</button>
							<button ?disabled=${qi === qs.length - 1} title="Nach unten" @click=${() => this.act(qi, "down")}>↓</button>
							<button @click=${() => this.act(qi, "dup")}>Duplizieren</button>
							<button class="danger" @click=${() => this.act(qi, "del")}>Löschen</button>
						</div>
						<label class="field"><span>Fragetext</span>
							<textarea maxlength="400" .value=${q.text} @input=${(e: InputEvent) => { this.q(qi).text = (e.target as HTMLTextAreaElement).value; }}></textarea></label>
						<div class="q-meta">
							<label class="field"><span>Antwortzeit</span>
								<select @change=${(e: Event) => { this.q(qi).timeLimitSeconds = Number((e.target as HTMLSelectElement).value); }}>
									${TIMES.map(t => html`<option value=${t} ?selected=${t === q.timeLimitSeconds}>${t} Sekunden</option>`)}
								</select></label>
							<label class="field"><span>Punkte</span>
								<select @change=${(e: Event) => { this.q(qi).pointsMultiplier = Number((e.target as HTMLSelectElement).value); }}>
									<option value="1" ?selected=${q.pointsMultiplier === 1}>Standard</option>
									<option value="2" ?selected=${q.pointsMultiplier === 2}>Doppelt</option>
									<option value="0" ?selected=${q.pointsMultiplier === 0}>Ohne Punkte</option>
								</select></label>
						</div>
						<div class="muted" style="font-size:13px;font-weight:600">Antwortmöglichkeiten (2–6, mindestens eine richtig)</div>
						${q.options.map((o, oi) => html`
							<div class="opt">
								<span class="badge c${oi}">${shape(oi)}${LETTERS[oi]}</span>
								<input type="text" maxlength="150" placeholder="Antwort ${LETTERS[oi]}" .value=${o.text}
									@input=${(e: InputEvent) => { o.text = (e.target as HTMLInputElement).value; }}>
								<label class="correct"><input type="checkbox" .checked=${o.isCorrect}
									@change=${(e: Event) => { o.isCorrect = (e.target as HTMLInputElement).checked; }}> richtig</label>
								<button ?disabled=${q.options.length <= 2} title="Antwort entfernen" @click=${() => this.act(qi, "delopt", oi)}>✕</button>
							</div>`)}
						<button ?disabled=${q.options.length >= 6} @click=${() => this.act(qi, "addopt")}>+ Antwort</button>
					</div>`)}
				<div class="toolbar">
					<button @click=${() => { qs.push(blankQ()); this.touch(); }}>+ Frage hinzufügen</button>
					<span class="spacer"></span>
					<span class="muted">${qs.length} Frage(n)</span>
					<button class="primary" @click=${() => this.save()}>Speichern</button>
				</div>`}
			</main>`;
	}
}
