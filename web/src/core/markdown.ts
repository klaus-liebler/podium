// Markdown-Teilmenge für Frage- und Antworttexte (wie die "Formatierungshilfe" bei Quizacademy):
//   **fett**, *kursiv*, ~~durchgestrichen~~, `Code`, ```Codeblock```, # Überschrift, > Zitat,
//   - Liste, 1. Liste, [Link](https://…), | Tabelle |, $Formel$ und $$abgesetzte Formel$$ (LaTeX-Teilmenge → MathML).
// Sicher per Konstruktion: Der Quelltext wird vollständig HTML-maskiert, Tags entstehen nur hier im Code.
import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// ---------------------------------------------------------------- Inline

/** Platzhalter für bereits fertiges HTML (Code, Formeln, maskierte Zeichen) */
function inline(src: string): string {
	const slots: string[] = [];
	const put = (h: string) => `\u0000${slots.push(h) - 1}\u0000`;
	let s = src.replace(/\u0000/g, "");
	s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _t, c: string) => put(`<code>${esc(c.trim() || c)}</code>`));
	s = s.replace(/(?<!\\)\$\$([\s\S]+?)\$\$/g, (_, m: string) => put(tex(m, true)));
	s = s.replace(/(?<!\\)\$(?!\s)([^$\n]*?[^\s\\$]|[^\s$])\$(?!\d)/g, (_, m: string) => put(tex(m, false)));
	s = s.replace(/\\([\\`*_{}[\]()#+\-.!|$~>])/g, (_, c: string) => put(esc(c)));
	s = esc(s);
	s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, t: string, u: string) =>
		/^(https?:\/\/|mailto:)/i.test(u) ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>` : m);
	s = s.replace(/(?<![\w/"=])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, (u, _x, off: number, all: string) =>
		/href="$/.test(all.slice(0, off)) || /<a [^>]*>[^<]*$/.test(all.slice(0, off)) ? u : `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
	s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "<strong>$2</strong>");
	s = s.replace(/\*(?=[^\s*])([^*]*?[^\s*])\*|(?<![\w])_(?=[^\s_])([^_]*?[^\s_])_(?![\w])/g, (_, a?: string, b?: string) => `<em>${a ?? b}</em>`);
	s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>");
	s = s.replace(/\n/g, "<br>");
	return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => slots[+i]);
}

// ---------------------------------------------------------------- Blöcke

const reUl = /^\s*[-*+]\s+/, reOl = /^\s*\d+[.)]\s+/, reQuote = /^\s*>\s?/, reHead = /^(#{1,3})\s+(.*)$/;
const reFence = /^\s*```/, reTableSep = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map(c => c.trim());

function blocks(src: string): string {
	const lines = src.replace(/\r\n?/g, "\n").split("\n");
	const out: string[] = [];
	let para: string[] = [];
	const flush = () => { if (para.length) out.push(`<p>${inline(para.join("\n"))}</p>`); para = []; };
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		if (!l.trim()) { flush(); continue; }
		if (reFence.test(l)) {
			flush();
			const code: string[] = [];
			while (++i < lines.length && !reFence.test(lines[i])) code.push(lines[i]);
			out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
			continue;
		}
		if (/^\s*\$\$/.test(l) && !/^\s*\$\$[\s\S]+\$\$\s*$/.test(l)) { // mehrzeilige $$ … $$
			flush();
			const m: string[] = [l.replace(/^\s*\$\$/, "")];
			while (++i < lines.length && !/\$\$\s*$/.test(lines[i])) m.push(lines[i]);
			if (i < lines.length) m.push(lines[i].replace(/\$\$\s*$/, ""));
			out.push(tex(m.join("\n"), true));
			continue;
		}
		const h = reHead.exec(l);
		if (h) { flush(); out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`); continue; }
		if (reQuote.test(l)) {
			flush();
			const q: string[] = [];
			for (; i < lines.length && reQuote.test(lines[i]); i++) q.push(lines[i].replace(reQuote, ""));
			i--;
			out.push(`<blockquote>${blocks(q.join("\n"))}</blockquote>`);
			continue;
		}
		if (reUl.test(l) || reOl.test(l)) {
			flush();
			const re = reUl.test(l) ? reUl : reOl, items: string[] = [];
			const start = re === reOl ? parseInt(l, 10) : 1;
			for (; i < lines.length && lines[i].trim(); i++) {
				if (re.test(lines[i])) items.push(lines[i].replace(re, ""));
				else if (/^\s+/.test(lines[i]) && items.length) items[items.length - 1] += "\n" + lines[i].trim();
				else break;
			}
			i--;
			const tag = re === reUl ? "ul" : "ol";
			out.push(`<${tag}${tag === "ol" && start !== 1 ? ` start="${start}"` : ""}>${items.map(t => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
			continue;
		}
		if (l.includes("|") && i + 1 < lines.length && reTableSep.test(lines[i + 1]) && lines[i + 1].includes("-")) {
			flush();
			const head = cells(l), align = cells(lines[i + 1]).map(c => c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : "");
			const td = (tag: string, c: string, j: number) => `<${tag}${align[j] ? ` style="text-align:${align[j]}"` : ""}>${inline(c)}</${tag}>`;
			let body = "";
			for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++)
				body += `<tr>${head.map((_, j) => td("td", cells(lines[i])[j] ?? "", j)).join("")}</tr>`;
			i--;
			out.push(`<table><thead><tr>${head.map((c, j) => td("th", c, j)).join("")}</tr></thead><tbody>${body}</tbody></table>`);
			continue;
		}
		para.push(l);
	}
	flush();
	return out.join("");
}

const cache = new Map<string, string>();
/** Markdown → HTML-String (sicher, s. o.) */
export function mdToHtml(src: string): string {
	let h = cache.get(src);
	if (h === undefined) {
		if (cache.size > 400) cache.clear();
		h = blocks(src ?? "");
		// ein einzelner Absatz ohne <p>, damit er sich wie bisher in Kacheln/Karten einfügt
		const m = /^<p>([\s\S]*)<\/p>$/.exec(h);
		if (m && !m[1].includes("<p>")) h = m[1];
		cache.set(src, h);
	}
	return h;
}

/** Formatierten Text als Lit-Inhalt in einem <div class="md">. */
export const md = (src: string | null | undefined, cls = "") =>
	src ? html`<div class="md ${cls}">${unsafeHTML(mdToHtml(src))}</div>` : nothing;

/** Klartext ohne Formatierungszeichen (für title/aria-label und kompakte Listen) */
export function mdPlain(src: string): string {
	const slots: string[] = [];
	const put = (s: string) => `\u0000${slots.push(s) - 1}\u0000`;
	return (src ?? "").replace(/\u0000/g, "")
		.replace(/```[\s\S]*?```/g, m => put(m.replace(/```\w*/g, " ")))
		.replace(/`([^`]+)`/g, (_, c: string) => put(c))
		.replace(/(?<!\\)\$\$([\s\S]+?)\$\$/g, (_, m: string) => put(texPlain(m)))
		.replace(/(?<!\\)\$(?!\s)([^$\n]*?[^\s\\$]|[^\s$])\$(?!\d)/g, (_, m: string) => put(texPlain(m)))
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/^\s*(#{1,3}|>|[-*+]|\d+[.)])\s+/gm, "")
		.replace(/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$\n?/gm, "")
		.replace(/^\s*\|(.*?)\|?\s*$/gm, (_, r: string) => r.split("|").map(c => c.trim()).join(" · ") + ";")
		.replace(/(\*\*|__|~~)/g, "").replace(/(?<!\w)[*_](?=\S)|(?<=\S)[*_](?!\w)/g, "")
		.replace(/\\(.)/g, "$1")
		.replace(/\u0000(\d+)\u0000/g, (_, i: string) => slots[+i])
		.replace(/\s+/g, " ").replace(/;$/, "").trim();
}

/** Formel als lesbarer Klartext, z. B. "\frac{a}{b} \cdot \alpha" → "(a)/(b) ⋅ α" */
function texPlain(s: string): string {
	let p = s.replace(/\\(begin|end)\s*\{[^{}]*\}/g, " ").replace(/\s*&\s*/g, " ").replace(/\\\\/g, "; ");
	for (let k = 0; k < 5; k++) p = p
		.replace(/([_^])\{([^{}]*)\}/g, (_, o: string, x: string) => x.length > 1 ? `${o}(${x})` : o + x)
		.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
		.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
		.replace(/\\(?:text|mathrm|mathbf|operatorname|mbox)\s*\{([^{}]*)\}/g, "$1")
		.replace(/\\mathbb\s*\{([^{}]*)\}/g, (_, x: string) => variant(x, "bb"));
	return p.replace(/\\([a-zA-Z]+)/g, (_, c: string) => GREEK[c] ?? OPS[c] ?? (FUNCS.has(c) ? c : ""))
		.replace(/\\(.)/g, "$1").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/** Enthält der Text Formatierungen? (für die Vorschau im Editor) */
export const hasMarkup = (s: string) => /[*_`~$|\\[]|^\s*(#|>|[-+]\s|\d+[.)]\s)|\n/m.test(s);

// ---------------------------------------------------------------- Formeln: LaTeX-Teilmenge → MathML

const GREEK: Record<string, string> = {
	alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
	iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς",
	tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
	Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
	infty: "∞", partial: "∂", nabla: "∇", ell: "ℓ", hbar: "ℏ", emptyset: "∅", varnothing: "∅", Re: "ℜ", Im: "ℑ", aleph: "ℵ",
};
const OPS: Record<string, string> = {
	cdot: "⋅", times: "×", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆", circ: "∘", bullet: "∙", oplus: "⊕", otimes: "⊗",
	le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼", simeq: "≃", cong: "≅", propto: "∝",
	ll: "≪", gg: "≫", to: "→", rightarrow: "→", leftarrow: "←", gets: "←", leftrightarrow: "↔", Rightarrow: "⇒", Leftarrow: "⇐",
	Leftrightarrow: "⇔", implies: "⟹", iff: "⟺", mapsto: "↦", uparrow: "↑", downarrow: "↓",
	in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇", cup: "∪", cap: "∩", setminus: "∖",
	forall: "∀", exists: "∃", neg: "¬", lnot: "¬", land: "∧", wedge: "∧", lor: "∨", vee: "∨", perp: "⊥", parallel: "∥", angle: "∠",
	mid: "∣", cdots: "⋯", ldots: "…", dots: "…", vdots: "⋮", ddots: "⋱", prime: "′", degree: "°",
	sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", iiint: "∭", oint: "∮", bigcup: "⋃", bigcap: "⋂",
	langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉", lbrace: "{", rbrace: "}", vert: "|", Vert: "‖",
	"{": "{", "}": "}", "|": "‖", "%": "%", "#": "#", "&": "&", _: "_", $: "$",
};
const BIG = new Set(["sum", "prod", "coprod", "bigcup", "bigcap", "lim", "max", "min", "sup", "inf", "limsup", "liminf"]);
const FUNCS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "coth",
	"exp", "ln", "log", "lg", "lim", "max", "min", "sup", "inf", "det", "dim", "ker", "deg", "arg", "gcd", "Pr", "limsup", "liminf", "sgn"]);
const ACCENT: Record<string, string> = { vec: "→", hat: "^", widehat: "^", bar: "‾", overline: "‾", dot: "˙", ddot: "¨", tilde: "~", widetilde: "~", overrightarrow: "→" };
const SPACE: Record<string, string> = { ",": "0.167em", ":": "0.222em", ";": "0.278em", " ": "0.25em", quad: "1em", qquad: "2em", "!": "-0.167em" };
const FENCE: Record<string, string> = { "(": "(", ")": ")", "[": "[", "]": "]", "|": "|", ".": "", "\\{": "{", "\\}": "}", "\\langle": "⟨", "\\rangle": "⟩", "\\|": "‖", "\\lvert": "|", "\\rvert": "|" };

/** Buchstaben in mathematische Alphanumerik umsetzen (MathML Core kennt nur mathvariant="normal"). */
function variant(s: string, v: string): string {
	const DS: Record<string, string> = { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" };
	const CAL: Record<string, string> = { B: "ℬ", E: "ℰ", F: "ℱ", H: "ℋ", I: "ℐ", L: "ℒ", M: "ℳ", R: "ℛ" };
	return [...s].map(c => {
		const up = c >= "A" && c <= "Z", lo = c >= "a" && c <= "z", dg = c >= "0" && c <= "9";
		const o = up ? c.charCodeAt(0) - 65 : lo ? c.charCodeAt(0) - 97 + 26 : 0;
		switch (v) {
			case "bf": return up || lo ? String.fromCodePoint(0x1d400 + o) : dg ? String.fromCodePoint(0x1d7ce + +c) : c;
			case "bb": return DS[c] ?? (up || lo ? String.fromCodePoint(0x1d538 + o) : dg ? String.fromCodePoint(0x1d7d8 + +c) : c);
			case "cal": return up ? CAL[c] ?? String.fromCodePoint(0x1d49c + o) : c;
			default: return c;
		}
	}).join("");
}

type Tok = { t: "cmd" | "ch" | "num"; v: string; p: number };
function lex(src: string): Tok[] {
	const out: Tok[] = [];
	for (let i = 0; i < src.length;) {
		const c = src[i];
		if (c === "\\") {
			const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
			if (!m) { i++; continue; }
			out.push({ t: "cmd", v: m[1], p: i }); i += m[0].length;
			if (/^[a-zA-Z]/.test(m[1])) while (src[i] === " ") i++;
		} else if (/\d/.test(c)) {
			const m = /^\d+(?:[.,]\d+)?|^\d+\{,\}\d+/.exec(src.slice(i))!;
			out.push({ t: "num", v: m[0].replace("{,}", ","), p: i }); i += m[0].length;
		} else if (/\s/.test(c)) i++;
		else { out.push({ t: "ch", v: c, p: i }); i++; }
	}
	return out;
}

class TexParser {
	private i = 0;
	private toks: Tok[];
	private src: string;
	constructor(toks: Tok[], src: string) { this.toks = toks; this.src = src; }
	private peek() { return this.toks[this.i]; }
	private next() { return this.toks[this.i++]; }
	private isEnd(stop: string[]) {
		const t = this.peek();
		return !t || (t.t === "ch" && stop.includes(t.v)) || (t.t === "cmd" && stop.includes("\\" + t.v));
	}

	/** Folge von Atomen bis zu einem Stopp-Token */
	expr(stop: string[] = []): string {
		let out = "";
		while (!this.isEnd(stop)) out += this.script();
		return out;
	}
	private row(s: string) { return `<mrow>${s}</mrow>`; }

	/** Atom mit optionalem ^ und _ */
	private script(): string {
		const t = this.peek();
		const big = t?.t === "cmd" && BIG.has(t.v);
		let base = this.atom();
		let sub = "", sup = "";
		for (; ;) {
			const n = this.peek();
			if (n?.t === "ch" && n.v === "_" && !sub) { this.next(); sub = this.arg(); }
			else if (n?.t === "ch" && n.v === "^" && !sup) { this.next(); sup = this.arg(); }
			else if (n?.t === "ch" && n.v === "'") { this.next(); sup += "<mo>′</mo>"; }
			else break;
		}
		if (!base) base = "<mrow></mrow>";
		if (big && (sub || sup)) return sub && sup ? `<munderover>${base}${this.row(sub)}${this.row(sup)}</munderover>` : sub ? `<munder>${base}${this.row(sub)}</munder>` : `<mover>${base}${this.row(sup)}</mover>`;
		return sub && sup ? `<msubsup>${base}${this.row(sub)}${this.row(sup)}</msubsup>` : sub ? `<msub>${base}${this.row(sub)}</msub>` : sup ? `<msup>${base}${this.row(sup)}</msup>` : base;
	}

	/** Argument: {…} oder einzelnes Token */
	private arg(): string {
		const t = this.peek();
		if (!t) return "";
		if (t.t === "ch" && t.v === "{") { this.next(); const e = this.expr(["}"]); this.next(); return e; }
		if (t.t === "num") { this.next(); return `<mn>${esc(t.v[0])}</mn>${t.v.length > 1 ? this.literalRest(t.v.slice(1)) : ""}`; }
		return this.atom();
	}
	private literalRest(s: string) { this.toks.splice(this.i, 0, { t: "num", v: s, p: -1 }); return ""; }

	/** Rohtext eines {…}-Arguments (für \text, \mathrm …) */
	private rawArg(): string {
		const t = this.peek();
		if (!(t?.t === "ch" && t.v === "{")) { this.next(); return t?.v ?? ""; }
		this.next();
		let depth = 1, s = "";
		while (this.peek()) {
			const x = this.next();
			if (x.t === "ch" && x.v === "{") depth++;
			if (x.t === "ch" && x.v === "}" && --depth === 0) break;
			s += x.t === "cmd" ? (/^[a-zA-Z]/.test(x.v) ? `\\${x.v} ` : x.v) : x.v;
		}
		return s;
	}
	/** Text in \text{…}: direkt aus dem Quelltext, damit Leerzeichen erhalten bleiben */
	private textArg(): string {
		const t = this.peek();
		if (!(t?.t === "ch" && t.v === "{" && t.p >= 0)) return this.rawArg();
		let depth = 1, j = t.p + 1;
		for (; j < this.src.length && depth; j++) { if (this.src[j] === "{") depth++; else if (this.src[j] === "}") depth--; }
		this.rawArg();
		return this.src.slice(t.p + 1, j - 1);
	}

	private atom(): string {
		const t = this.next();
		if (!t) return "";
		if (t.t === "num") return `<mn>${esc(t.v)}</mn>`;
		if (t.t === "ch") {
			const c = t.v;
			if (c === "{") { const e = this.expr(["}"]); this.next(); return this.row(e); }
			if (c === "}") return "";
			if (c === "~") return `<mspace width="0.25em"></mspace>`;
			if (/[a-zA-Z]/.test(c)) return `<mi>${c}</mi>`;
			if (c === "-") return "<mo>−</mo>";
			if (c === "*") return "<mo>∗</mo>";
			if ("()[]|".includes(c)) return `<mo stretchy="false">${c}</mo>`;
			return `<mo>${esc(c)}</mo>`;
		}
		const v = t.v;
		if (v in SPACE) return `<mspace width="${SPACE[v]}"></mspace>`;
		if (v === "\\") return "";
		if (v in GREEK) return `<mi>${GREEK[v]}</mi>`;
		if (v in OPS) return BIG.has(v) || ["int", "iint", "iiint", "oint"].includes(v) ? `<mo largeop="true" movablelimits="${BIG.has(v)}">${OPS[v]}</mo>` : `<mo>${esc(OPS[v])}</mo>`;
		if (FUNCS.has(v)) return BIG.has(v) ? `<mo movablelimits="true" form="prefix">${v === "limsup" ? "lim sup" : v === "liminf" ? "lim inf" : v}</mo>` : `<mi>${v}</mi><mo>&#x2061;</mo>`;
		switch (v) {
			case "frac": case "dfrac": case "tfrac": { const a = this.arg(), b = this.arg(); return `<mfrac>${this.row(a)}${this.row(b)}</mfrac>`; }
			case "sqrt": {
				let n = "";
				if (this.peek()?.t === "ch" && this.peek().v === "[") { this.next(); n = this.expr(["]"]); this.next(); }
				const a = this.arg();
				return n ? `<mroot>${this.row(a)}${this.row(n)}</mroot>` : `<msqrt>${a}</msqrt>`;
			}
			case "text": case "textrm": case "mbox": case "textit": return `<mtext>${esc(this.textArg())}</mtext>`;
			case "textbf": return `<mtext>${esc(variant(this.textArg(), "bf"))}</mtext>`;
			case "mathrm": case "operatorname": case "rm": return `<mi mathvariant="normal">${esc(this.rawArg().replace(/\s+/g, ""))}</mi>`;
			case "mathbf": case "boldsymbol": case "bm": return `<mi mathvariant="normal">${esc(variant(this.rawArg().replace(/\s+/g, ""), "bf"))}</mi>`;
			case "mathbb": return `<mi mathvariant="normal">${esc(variant(this.rawArg().replace(/\s+/g, ""), "bb"))}</mi>`;
			case "mathcal": return `<mi mathvariant="normal">${esc(variant(this.rawArg().replace(/\s+/g, ""), "cal"))}</mi>`;
			case "mathit": return `<mi>${esc(this.rawArg())}</mi>`;
			case "underline": return `<munder accentunder="true">${this.row(this.arg())}<mo stretchy="true">_</mo></munder>`;
			case "overbrace": case "underbrace": {
				const a = this.arg(), o = v === "overbrace" ? "⏞" : "⏟";
				return v === "overbrace" ? `<mover>${this.row(a)}<mo stretchy="true">${o}</mo></mover>` : `<munder>${this.row(a)}<mo stretchy="true">${o}</mo></munder>`;
			}
			case "left": case "right": case "big": case "Big": case "bigg": case "Bigg": case "bigl": case "bigr": case "Bigl": case "Bigr": {
				const d = this.next();
				const f = d ? (FENCE[d.t === "cmd" ? "\\" + d.v : d.v] ?? (d.t === "cmd" ? OPS[d.v] ?? "" : d.v)) : "";
				if (v === "left") {
					const inner = this.expr(["\\right"]);
					this.next();
					const r = this.next();
					const rf = r ? (FENCE[r.t === "cmd" ? "\\" + r.v : r.v] ?? (r.t === "cmd" ? OPS[r.v] ?? "" : r.v)) : "";
					return this.row(`${f ? `<mo fence="true" stretchy="true">${esc(f)}</mo>` : ""}${inner}${rf ? `<mo fence="true" stretchy="true">${esc(rf)}</mo>` : ""}`);
				}
				return f ? `<mo stretchy="false" minsize="${v.startsWith("B") ? "1.8em" : v.startsWith("bigg") ? "2.4em" : "1.2em"}">${esc(f)}</mo>` : "";
			}
			case "begin": return this.env(this.rawArg());
			case "end": return "";
			case "displaystyle": return "";
		}
		if (v in ACCENT) {
			const a = this.arg();
			return `<mover accent="true">${this.row(a)}<mo stretchy="${v.startsWith("wide") || v === "overline" || v === "overrightarrow"}">${ACCENT[v]}</mo></mover>`;
		}
		return `<merror><mtext>\\${esc(v)}</mtext></merror>`;
	}

	/** \begin{matrix|pmatrix|bmatrix|vmatrix|cases|aligned} … \end{…} */
	private env(name: string): string {
		const rows: string[][] = [[]];
		for (; ;) {
			const cell = this.expr(["&", "\\\\", "\\end"]);
			rows[rows.length - 1].push(cell);
			const t = this.next();
			if (!t || (t.t === "cmd" && t.v === "end")) { if (t) this.rawArg(); break; }
			if (t.t === "cmd" && t.v === "\\") rows.push([]);
		}
		if (rows.length > 1 && rows[rows.length - 1].every(c => !c)) rows.pop();
		const align = name.startsWith("align") ? ` columnalign="${rows[0].map((_, j) => j % 2 ? "left" : "right").join(" ")}" columnspacing="0"` : name === "cases" ? ` columnalign="left left"` : "";
		const table = `<mtable${align}>${rows.map(r => `<mtr>${r.map(c => `<mtd>${c}</mtd>`).join("")}</mtr>`).join("")}</mtable>`;
		const wrap: Record<string, [string, string]> = { pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["{", "}"], vmatrix: ["|", "|"], Vmatrix: ["‖", "‖"], cases: ["{", ""] };
		const w = wrap[name];
		return w ? this.row(`<mo fence="true" stretchy="true">${w[0]}</mo>${table}${w[1] ? `<mo fence="true" stretchy="true">${w[1]}</mo>` : ""}`) : table;
	}
}

/** LaTeX-Formel als MathML; bei Fehlern der Quelltext als Code. */
export function tex(src: string, display: boolean): string {
	try {
		const body = new TexParser(lex(src), src).expr();
		return `<math${display ? ` display="block"` : ""} aria-label="${esc(src.trim())}"><mrow>${body}</mrow></math>`;
	} catch {
		return `<code>${esc(src)}</code>`;
	}
}
