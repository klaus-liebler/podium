// Textfeld mit Formatierungsleiste (Markdown) und Live-Vorschau – für Frage- und Antworttexte im Quiz-Editor.
import { html, nothing, svg } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { LightElement } from "../core/util.ts";
import { hasMarkup, md } from "../core/markdown.ts";

const ico = (p: ReturnType<typeof svg>) => html`<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

type Tool = { id: string; title: string; label: ReturnType<typeof html> };
const TOOLS: (Tool | null)[] = [
	{ id: "bold", title: "Fett (Strg+B)", label: html`<b style="font-family:Georgia,serif;font-size:17px">B</b>` },
	{ id: "italic", title: "Kursiv (Strg+I)", label: html`<i style="font-family:Georgia,serif;font-size:17px">I</i>` },
	{ id: "heading", title: "Überschrift", label: html`<b style="font-family:Georgia,serif;font-size:17px">H</b>` },
	null,
	{ id: "quote", title: "Zitat", label: ico(svg`<path d="M4 17h4l2-4V7H4v6h3zM14 17h4l2-4V7h-6v6h3z" fill="currentColor" stroke="none"/>`) },
	{ id: "code", title: "Code", label: ico(svg`<path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"/>`) },
	{ id: "link", title: "Link", label: ico(svg`<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>`) },
	null,
	{ id: "ul", title: "Aufzählung", label: ico(svg`<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/>`) },
	{ id: "ol", title: "Nummerierte Liste", label: ico(svg`<path d="M10 6h10M10 12h10M10 18h10"/><text x="2.5" y="8.5" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="2.5" y="14.5" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="2.5" y="20.5" font-size="7" fill="currentColor" stroke="none" font-family="sans-serif">3</text>`) },
	null,
	{ id: "table", title: "Tabelle", label: ico(svg`<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9.5h18M3 15h18M9 4v16M15 4v16"/>`) },
	{ id: "math", title: "Formel (LaTeX)", label: ico(svg`<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 9h4M9 7v4M13.5 8.5h4M7.5 14.5l3 3M10.5 14.5l-3 3M13.5 15h4M13.5 17.5h4"/>`) },
];

const HELP: [string, string][] = [
	["**fett**", "Strg+B"], ["*kursiv*", "Strg+I"], ["~~durchgestrichen~~", ""], ["`Code`", ""],
	["# Überschrift", "auch ## und ###"], ["> Zitat", ""], ["- Punkt", "Aufzählung"], ["1. Punkt", "nummerierte Liste"],
	["[Text](https://example.org)", "Link (Strg+K)"], ["| A | B |\n|---|---|\n| 1 | 2 |", "Tabelle"],
	["$a^2+b^2=c^2$", "Formel im Text"], ["$$\\frac{U}{R}$$", "abgesetzte Formel"],
	["$\\alpha, \\sqrt{x}, x_1, \\le, \\cdot$", "griechisch, Wurzel, Index, Operatoren"],
	["```\nCode-Block\n```", "Codeblock"],
];

@customElement("md-input")
export class MdInput extends LightElement {
	@property() value = "";
	@property({ type: Number }) maxlength = 1000;
	@property() placeholder = "";
	@property({ type: Number }) rows = 2;
	/** wird bei jeder Änderung mit dem neuen Text aufgerufen */
	@property({ attribute: false }) onValue: (v: string) => void = () => { };
	@state() private help = false;
	@query("textarea") private ta!: HTMLTextAreaElement;

	protected override updated() { this.grow(); }

	private grow() {
		const t = this.ta;
		if (!t) return;
		t.style.height = "auto";
		t.style.height = `${t.scrollHeight + 2}px`;
	}

	private changed() {
		this.value = this.ta.value;
		this.onValue(this.value);
		this.grow();
	}

	/** Text an der Auswahl ersetzen – über execCommand, damit Strg+Z funktioniert */
	private insert(text: string, selFrom?: number, selTo?: number) {
		const t = this.ta, start = t.selectionStart;
		t.focus();
		if (!document.execCommand("insertText", false, text)) t.setRangeText(text, t.selectionStart, t.selectionEnd, "end");
		if (selFrom !== undefined) t.setSelectionRange(start + selFrom, start + (selTo ?? selFrom));
		this.changed();
	}

	/** markierte Zeilen (bzw. aktuelle Zeile) vollständig auswählen */
	private selectLines() {
		const t = this.ta, v = t.value;
		const a = v.lastIndexOf("\n", t.selectionStart - 1) + 1;
		let b = v.indexOf("\n", t.selectionEnd > t.selectionStart && v[t.selectionEnd - 1] === "\n" ? t.selectionEnd - 1 : t.selectionEnd);
		if (b < 0) b = v.length;
		t.setSelectionRange(a, b);
		return v.slice(a, b);
	}

	private wrap(left: string, right: string, dummy: string) {
		const t = this.ta, sel = t.value.slice(t.selectionStart, t.selectionEnd);
		if (sel) this.insert(left + sel + right, left.length, left.length + sel.length);
		else this.insert(left + dummy + right, left.length, left.length + dummy.length);
	}

	private prefixLines(fn: (line: string, i: number) => string, strip: RegExp) {
		const lines = this.selectLines().split("\n");
		const all = lines.every(l => strip.test(l));
		const out = lines.map((l, i) => all ? l.replace(strip, "") : fn(l.replace(strip, ""), i)).join("\n");
		this.insert(out, 0, out.length);
	}

	/** Block auf eigener Zeile einfügen */
	private block(text: string, selFrom: number, selTo: number) {
		const t = this.ta, v = t.value, s = t.selectionStart;
		const pre = s === 0 ? "" : v[s - 1] !== "\n" ? "\n\n" : v[s - 2] !== "\n" && s > 1 ? "\n" : "";
		const post = t.selectionEnd < v.length && v[t.selectionEnd] !== "\n" ? "\n" : "";
		this.insert(pre + text + post, pre.length + selFrom, pre.length + selTo);
	}

	private tool(id: string) {
		const t = this.ta, sel = t.value.slice(t.selectionStart, t.selectionEnd);
		switch (id) {
			case "bold": return this.wrap("**", "**", "fett");
			case "italic": return this.wrap("*", "*", "kursiv");
			case "heading": return this.prefixLines(l => `# ${l}`, /^#{1,3}\s+/);
			case "quote": return this.prefixLines(l => `> ${l}`, /^>\s?/);
			case "code": return sel.includes("\n") ? this.block("```\n" + sel + "\n```", 4, 4 + sel.length) : this.wrap("`", "`", "Code");
			case "link": {
				const txt = sel || "Linktext", url = "https://";
				return this.insert(`[${txt}](${url})`, txt.length + 3, txt.length + 3 + url.length);
			}
			case "ul": return this.prefixLines(l => `- ${l}`, /^\s*[-*+]\s+/);
			case "ol": return this.prefixLines((l, i) => `${i + 1}. ${l}`, /^\s*\d+[.)]\s+/);
			case "table": {
				const tpl = "| Spalte 1 | Spalte 2 |\n| --- | --- |\n| A | B |";
				return this.block(tpl, 2, 10);
			}
			case "math": return sel.includes("\n") ? this.block("$$\n" + sel + "\n$$", 3, 3 + sel.length) : this.wrap("$", "$", "x^2");
		}
	}

	private key(e: KeyboardEvent) {
		if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
		const id = ({ b: "bold", i: "italic", k: "link" } as Record<string, string>)[e.key.toLowerCase()];
		if (id) { e.preventDefault(); this.tool(id); }
	}

	protected override render() {
		const preview = this.value && hasMarkup(this.value);
		return html`
			<div class="md-wrap">
				<textarea rows=${this.rows} maxlength=${this.maxlength} placeholder=${this.placeholder} .value=${this.value}
					@input=${() => this.changed()} @keydown=${(e: KeyboardEvent) => this.key(e)}></textarea>
				<div class="md-bar" role="toolbar" aria-label="Formatierung" @mousedown=${(e: Event) => e.preventDefault()}>
					${TOOLS.map(t => t ? html`<button type="button" title=${t.title} aria-label=${t.title} @click=${() => this.tool(t.id)}>${t.label}</button>` : html`<span class="sep"></span>`)}
					<span class="spacer"></span>
					<button type="button" class="help-btn ${this.help ? "on" : ""}" aria-expanded=${String(this.help)} @click=${() => { this.help = !this.help; }}>‹›&nbsp;Formatierungshilfe</button>
				</div>
			</div>
			${this.help ? html`<div class="md-help">
				${HELP.map(([src, what]) => html`<div class="hrow"><code>${src}</code>${md(src)}<small>${what}</small></div>`)}
			</div>` : nothing}
			${preview ? html`<div class="md-preview"><span class="lbl">Vorschau</span>${md(this.value)}</div>` : nothing}`;
	}
}

declare global { interface HTMLElementTagNameMap { "md-input": MdInput } }
