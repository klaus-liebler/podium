// Eingabedialog für eine spontane Frage (DirectMode). Bewusst schlicht/klassisch.
import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LETTERS, LightElement, shape } from "../core/util.ts";
import type { DirectKind, DirectSpec } from "../core/types.ts";

const PRESETS: { label: string; spec: Partial<DirectSpec> }[] = [
	{ label: "Ja / Nein", spec: { kind: "choice", options: ["Ja", "Nein"], multi: false } },
	{ label: "Ja / Nein / Weiß nicht", spec: { kind: "choice", options: ["Ja", "Nein", "Weiß nicht"], multi: false } },
	{ label: "Verstanden?", spec: { text: "Wie gut habt ihr das verstanden?", kind: "choice", options: ["Alles klar", "Größtenteils", "Teilweise", "Gar nicht"], multi: false } },
	{ label: "Skala 1–5", spec: { kind: "number", min: 1, max: 5, unit: "" } },
	{ label: "Schätzfrage", spec: { kind: "number", min: null, max: null } },
	{ label: "Ein Wort (Word Cloud)", spec: { kind: "text" } },
];

interface Template { id: number; spec: DirectSpec; }

@customElement("direct-composer")
export class DirectComposer extends LightElement {
	@property() error = "";
	@state() private spec: DirectSpec = this.load();
	/** eigene Vorlagen (nur wenn in diesem Browser angemeldet – sonst null, ohne Umleitung zur Anmeldung) */
	@state() private templates: Template[] | null = null;

	override connectedCallback() {
		super.connectedCallback();
		void fetch("api/directtemplates", { credentials: "same-origin" }).then(r => r.ok ? r.json() as Promise<Template[]> : null)
			.then(t => { this.templates = t; }).catch(() => { });
	}
	private async saveTemplate() {
		const s = this.spec;
		if (!s.text.trim()) { this.error = "Bitte zuerst eine Frage eingeben."; return; }
		const r = await fetch("api/directtemplates", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...s, options: s.kind === "choice" ? s.options.map(o => o.trim()) : [] }) });
		const d = await r.json().catch(() => ({})) as { id?: number; error?: string };
		if (!r.ok) { this.error = d.error ?? "Vorlage konnte nicht gespeichert werden."; return; }
		this.templates = [...(this.templates ?? []), { id: d.id!, spec: { ...s } }];
	}
	private async delTemplate(t: Template) {
		if (!confirm(`Vorlage „${t.spec.text}“ löschen?`)) return;
		await fetch(`api/directtemplates/${t.id}`, { method: "DELETE", credentials: "same-origin" });
		this.templates = (this.templates ?? []).filter(x => x.id !== t.id);
	}

	private load(): DirectSpec {
		return { text: "", kind: "choice", options: ["", ""], multi: false, live: true, min: null, max: null, unit: "" };
	}
	private set<K extends keyof DirectSpec>(k: K, v: DirectSpec[K]) { this.spec = { ...this.spec, [k]: v }; }
	private preset(p: Partial<DirectSpec>) {
		this.spec = { ...this.spec, ...p, text: p.text ?? this.spec.text, options: p.options ? [...p.options] : this.spec.kind === "choice" && p.kind !== "choice" ? this.spec.options : this.spec.options };
		if (this.spec.kind === "choice" && this.spec.options.length < 2) this.spec = { ...this.spec, options: ["", ""] };
		void this.updateComplete.then(() => this.querySelector<HTMLTextAreaElement>("textarea")?.focus());
	}
	private submit(e: Event) {
		e.preventDefault();
		const s = this.spec;
		const spec: DirectSpec = { ...s, options: s.kind === "choice" ? s.options.map(o => o.trim()) : [] };
		this.dispatchEvent(new CustomEvent<DirectSpec>("direct-submit", { detail: spec }));
	}
	private cancel() { this.dispatchEvent(new CustomEvent("direct-cancel")); }
	private num(v: string) { const n = parseFloat(v.replace(",", ".")); return Number.isFinite(n) ? n : null; }

	override firstUpdated() { this.querySelector<HTMLTextAreaElement>("textarea")?.focus(); }

	protected override render() {
		const s = this.spec;
		const kinds: [DirectKind, string][] = [["choice", "Auswahl"], ["number", "Zahl"], ["text", "Text / Word Cloud"]];
		return html`<div class="dc-backdrop" @keydown=${(e: KeyboardEvent) => { e.stopPropagation(); if (e.key === "Escape") this.cancel(); }}>
			<form class="dc-panel" @submit=${(e: Event) => this.submit(e)}>
				<h2>⚡ Direktfrage ans Publikum</h2>
				<div class="dc-presets">${PRESETS.map(p => html`<button type="button" @click=${() => this.preset(p.spec)}>${p.label}</button>`)}</div>
				${this.templates?.length ? html`<div class="dc-presets mine" aria-label="Meine Vorlagen"><span class="dc-lbl">Meine Vorlagen:</span>
					${this.templates.map(t => html`<span class="dc-tpl"><button type="button" title=${t.spec.text} @click=${() => this.preset({ ...t.spec, options: [...(t.spec.options ?? [])] })}>${t.spec.text.length > 32 ? t.spec.text.slice(0, 30) + "…" : t.spec.text}</button><button type="button" class="x" title="Vorlage löschen" aria-label="Vorlage löschen" @click=${() => this.delTemplate(t)}>✕</button></span>`)}
				</div>` : nothing}
				${this.error ? html`<div class="dc-error" role="alert">${this.error}</div>` : nothing}
				<label class="dc-field"><span>Frage</span>
					<textarea maxlength="300" required rows="2" .value=${s.text} @input=${(e: InputEvent) => this.set("text", (e.target as HTMLTextAreaElement).value)}></textarea></label>
				<div class="dc-seg" role="radiogroup" aria-label="Antworttyp">${kinds.map(([k, l]) => html`
					<button type="button" role="radio" aria-checked=${s.kind === k} class=${s.kind === k ? "on" : ""} @click=${() => this.set("kind", k)}>${l}</button>`)}</div>

				${s.kind === "choice" ? html`
					${s.options.map((o, i) => html`<div class="dc-opt">
						<span class="dc-badge c${i}">${shape(i)}${LETTERS[i]}</span>
						<input maxlength="150" required placeholder="Antwort ${LETTERS[i]}" .value=${o}
							@input=${(e: InputEvent) => { const a = [...s.options]; a[i] = (e.target as HTMLInputElement).value; this.set("options", a); }}>
						<button type="button" ?disabled=${s.options.length <= 2} title="Entfernen" @click=${() => this.set("options", s.options.filter((_, j) => j !== i))}>✕</button>
					</div>`)}
					<div class="dc-row">
						<button type="button" ?disabled=${s.options.length >= 6} @click=${() => this.set("options", [...s.options, ""])}>+ Antwort</button>
						<label class="dc-check"><input type="checkbox" .checked=${s.multi} @change=${(e: Event) => this.set("multi", (e.target as HTMLInputElement).checked)}> Mehrfachauswahl erlauben</label>
					</div>` : nothing}

				${s.kind === "number" ? html`<div class="dc-row">
					<label class="dc-field"><span>Minimum (optional)</span><input inputmode="decimal" .value=${s.min ?? ""} @input=${(e: InputEvent) => this.set("min", this.num((e.target as HTMLInputElement).value))}></label>
					<label class="dc-field"><span>Maximum (optional)</span><input inputmode="decimal" .value=${s.max ?? ""} @input=${(e: InputEvent) => this.set("max", this.num((e.target as HTMLInputElement).value))}></label>
					<label class="dc-field"><span>Einheit (optional)</span><input maxlength="12" .value=${s.unit} @input=${(e: InputEvent) => this.set("unit", (e.target as HTMLInputElement).value)}></label>
				</div>` : nothing}

				${s.kind === "text" ? html`<p class="dc-hint">Kurze Antworten (max. 60 Zeichen). Gleiche Antworten werden zusammengefasst und in der Word Cloud größer dargestellt.</p>` : nothing}

				<label class="dc-check"><input type="checkbox" .checked=${s.live} @change=${(e: Event) => this.set("live", (e.target as HTMLInputElement).checked)}>
					Ergebnisse live aufbauen (sonst erst nach dem Schließen sichtbar)</label>
				<div class="dc-actions">
					${this.templates ? html`<button type="button" class="dc-save" @click=${() => this.saveTemplate()} title="Diese Frage für später speichern">☆ Als Vorlage speichern</button>` : nothing}
					<button type="button" @click=${() => this.cancel()}>Abbrechen</button>
					<button type="submit" class="primary">Frage stellen ▶</button>
				</div>
			</form>
		</div>`;
	}
}
