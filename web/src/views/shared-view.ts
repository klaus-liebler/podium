// Geteiltes Quiz (#/shared/<token>): Vorschau und „Als Kopie übernehmen“ – Empfänger:innen brauchen ein eigenes Konto.
import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LightElement } from "../core/util.ts";
import { ApiError, api, getMe, teacherHeader, type Me } from "../core/session.ts";
import { mdPlain } from "../core/markdown.ts";

interface Shared { title: string; description: string; owner: string | null; questions: { text: string; kind: string }[]; }
const KIND: Record<string, string> = { choice: "Auswahl", estimate: "Schätzfrage", order: "Reihenfolge" };

@customElement("shared-view")
export class SharedView extends LightElement {
	@property() token = "";
	@state() private me: Me | null = null;
	@state() private q: Shared | null = null;
	@state() private error = "";
	@state() private busy = false;

	override connectedCallback() {
		super.connectedCallback();
		document.body.className = "teacher";
		document.title = "Podium – Geteiltes Quiz";
		void this.load();
	}
	private async load() {
		this.me = await getMe();
		if (!this.me) { location.hash = `#/login?next=${encodeURIComponent(location.hash)}`; return; }
		try { this.q = await api<Shared>(`shared/${encodeURIComponent(this.token)}`); }
		catch (e) { if ((e as ApiError).status !== 401) this.error = (e as Error).message; }
	}
	private async copy() {
		this.busy = true;
		try {
			const r = await api<{ id: number }>(`shared/${encodeURIComponent(this.token)}/copy`, { method: "POST" });
			location.hash = `#/edit/${r.id}`;
		} catch (e) { this.error = (e as Error).message; this.busy = false; }
	}

	protected override render() {
		const q = this.q;
		return html`
			${teacherHeader(this.me, html`<a class="button" href="#/">← Zur Übersicht</a>`)}
			<main>
				${this.error ? html`<div class="msg err">${this.error}</div>` : nothing}
				${!q ? (this.error ? nothing : html`<div class="box empty">Lade …</div>`) : html`
				<div class="box" style="padding:20px;max-width:760px">
					<h2 style="margin-top:0">🔗 ${q.title}</h2>
					${q.description ? html`<p>${q.description}</p>` : nothing}
					<p class="muted">Geteilt${q.owner ? html` von <b>${q.owner}</b>` : nothing} · ${q.questions.length} Fragen</p>
					<ol class="shared-list">${q.questions.map(x => html`<li>${mdPlain(x.text)} <span class="muted small">${KIND[x.kind] ?? ""}</span></li>`)}</ol>
					<div class="toolbar"><span class="spacer"></span>
						<button class="primary" ?disabled=${this.busy} @click=${() => this.copy()}>Als eigene Kopie übernehmen</button></div>
					<p class="muted small" style="margin-bottom:0">Die Kopie gehört dann dir – Änderungen daran wirken sich nicht auf das Original aus.</p>
				</div>`}
			</main>`;
	}
}
