// Live-Ergebnisse einer Direktfrage: Balken (Auswahl), Histogramm + Kennwerte (Zahl), Word Cloud (Text).
import { html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { LETTERS, LightElement, isDarkText, shape } from "../core/util.ts";
import type { ChoiceResults, HostDirect, NumberResults, TextResults } from "../core/types.ts";

const nf = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const CLOUD_COLORS = ["#ffd84d", "#7ee0d6", "#ff8fab", "#b9a3ff", "#8ec5ff", "#c6f07a", "#ffb27a", "#ffffff"];

@customElement("direct-results")
export class DirectResultsView extends LightElement {
	@property({ attribute: false }) d!: HostDirect;

	protected override render() {
		const d = this.d, r = d.results;
		if (!r) return html`<div class="dr-hidden">
			<div class="dr-big">${d.count}</div><div>${d.count === 1 ? "Antwort" : "Antworten"}</div>
			<p class="muted">Die Ergebnisse erscheinen, sobald du die Abstimmung schließt${d.open ? " – oder schalte die Live-Anzeige ein" : ""}.</p>
		</div>`;
		switch (d.kind) {
			case "choice": return this.bars(d, r as ChoiceResults);
			case "number": return this.histogram(d, r as NumberResults);
			case "text": return html`<word-cloud .words=${(r as TextResults).words}></word-cloud>`;
		}
	}

	private bars(d: HostDirect, r: ChoiceResults) {
		const total = r.counts.reduce((a, b) => a + b, 0);
		const max = Math.max(1, ...r.counts);
		return html`<div class="dr-bars">${d.options.map((o, i) => {
			const n = r.counts[i] ?? 0, pct = total ? Math.round(100 * n / (d.multi ? d.count || 1 : total)) : 0;
			return html`<div class="dr-bar-row">
				<span class="dr-key c${i} ${isDarkText(i) ? "dark" : ""}">${shape(i)}${LETTERS[i]}</span>
				<span class="dr-label">${o}</span>
				<span class="dr-track"><i class="c${i}" style="width:${(n / max) * 100}%"></i></span>
				<span class="dr-num">${n}<small>${pct} %</small></span>
			</div>`;
		})}</div>`;
	}

	private histogram(d: HostDirect, r: NumberResults) {
		if (!r.n) return html`<div class="dr-hidden"><div class="dr-big">0</div><div>Antworten</div></div>`;
		const v = r.values;
		let lo = d.min ?? r.min!, hi = d.max ?? r.max!;
		const allInt = v.every(x => Number.isInteger(x)) && (d.min == null || Number.isInteger(d.min)) && (d.max == null || Number.isInteger(d.max));
		let bins: { from: number; to: number; n: number; label: string }[];
		if (allInt && hi - lo <= 24) {
			bins = [];
			for (let x = lo; x <= hi; x++) bins.push({ from: x, to: x + 1, n: 0, label: String(x) });
			for (const x of v) bins[Math.round(x - lo)].n++;
		} else {
			if (hi === lo) { lo -= 0.5; hi += 0.5; }
			const raw = (hi - lo) / 10, mag = Math.pow(10, Math.floor(Math.log10(raw)));
			const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw)!;
			const start = Math.floor(lo / step) * step;
			const count = Math.max(1, Math.ceil((hi - start) / step + 1e-9));
			bins = Array.from({ length: count }, (_, i) => ({ from: start + i * step, to: start + (i + 1) * step, n: 0, label: nf.format(start + i * step) }));
			for (const x of v) bins[Math.min(count - 1, Math.floor((x - start) / step))].n++;
			lo = start; hi = start + count * step;
		}
		const maxN = Math.max(1, ...bins.map(b => b.n));
		const span = allInt && hi - lo <= 24 ? (bins.length) : hi - lo;
		const pos = (x: number) => allInt && hi - lo <= 24 ? ((x - lo + 0.5) / span) * 100 : ((x - lo) / span) * 100;
		const u = d.unit ? ` ${d.unit}` : "";
		return html`
			<div class="dr-stats">
				<span class="pill">n = ${r.n}</span>
				<span class="pill mean">Mittelwert ${nf.format(r.mean!)}${u}</span>
				<span class="pill median">Median ${nf.format(r.median!)}${u}</span>
				<span class="pill">Min ${nf.format(r.min!)}${u}</span>
				<span class="pill">Max ${nf.format(r.max!)}${u}</span>
				<span class="pill">σ ${nf.format(r.sd!)}</span>
			</div>
			<div class="dr-hist">
				<div class="dr-hist-bars">${bins.map((b, i) => html`<div class="dr-hcol">
					<span class="dr-hn">${b.n || ""}</span>
					<i class="c${i % 6}" style="height:${(b.n / maxN) * 100}%"></i>
				</div>`)}</div>
				<div class="dr-marker mean" style="left:${pos(r.mean!)}%"><span>Ø</span></div>
				<div class="dr-marker median" style="left:${pos(r.median!)}%"><span>M</span></div>
				<div class="dr-hist-axis">${bins.map(b => html`<span>${b.label}</span>`)}</div>
			</div>`;
	}
}

// ---------------------------------------------------------------- Word Cloud (Spiral-Layout, animierte Übergänge)
interface Placed { w: string; n: number; x: number; y: number; size: number; color: string; vertical: boolean; }

@customElement("word-cloud")
export class WordCloud extends LightElement {
	@property({ attribute: false }) words: { w: string; n: number }[] = [];
	private placed: Placed[] = [];
	private ctx = document.createElement("canvas").getContext("2d")!;
	private ro = new ResizeObserver(() => this.requestUpdate());

	override connectedCallback() { super.connectedCallback(); this.ro.observe(this); }
	override disconnectedCallback() { super.disconnectedCallback(); this.ro.disconnect(); }

	protected override willUpdate() {
		const W = this.clientWidth || 900, H = this.clientHeight || 420;
		const words = this.words.slice(0, 80);
		const maxN = Math.max(1, ...words.map(w => w.n));
		const scale = Math.min(1, Math.sqrt(W * H / 520000));
		const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
		const prev = new Map(this.placed.map(p => [p.w, p]));
		this.placed = [];
		words.forEach((wd, i) => {
			const size = Math.round((20 + Math.pow(wd.n / maxN, 0.65) * 74) * scale);
			this.ctx.font = `600 ${size}px Fredoka, system-ui, sans-serif`;
			const tw = this.ctx.measureText(wd.w).width + size * 0.3, th = size * 1.1;
			const vertical = i > 2 && hash(wd.w) % 5 === 0;
			const bw = vertical ? th : tw, bh = vertical ? tw : th;
			// archimedische Spirale ab Mitte, erste freie Stelle
			for (let t = 0; t < 2400; t++) {
				const a = t * 0.12, rad = 2.2 * a;
				const cx = W / 2 + rad * Math.cos(a) * (W / H) * 0.9, cy = H / 2 + rad * Math.sin(a);
				const b = { x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2 };
				if (b.x0 < 0 || b.y0 < 0 || b.x1 > W || b.y1 > H) continue;
				if (boxes.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0)) continue;
				boxes.push(b);
				this.placed.push({ w: wd.w, n: wd.n, x: cx, y: cy, size, vertical, color: prev.get(wd.w)?.color ?? CLOUD_COLORS[hash(wd.w) % CLOUD_COLORS.length] });
				break;
			}
		});
	}

	protected override render() {
		if (!this.words.length) return html`<div class="dr-hidden"><div class="dr-big">0</div><div>Antworten</div></div>`;
		return html`${repeat(this.placed, p => p.w, p => html`<span class="wc-word" title="${p.w}: ${p.n}"
			style="left:${p.x}px;top:${p.y}px;font-size:${p.size}px;color:${p.color};transform:translate(-50%,-50%)${p.vertical ? " rotate(-90deg)" : ""}">${p.w}</span>`)}`;
	}
}

function hash(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
