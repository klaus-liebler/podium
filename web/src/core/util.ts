import { LitElement, svg, type SVGTemplateResult } from "lit";
import { HubConnectionBuilder, LogLevel, type HubConnection } from "@microsoft/signalr";

export const LETTERS = "ABCDEF";

/** Lit-Element ohne Shadow DOM: nutzt die globalen Stylesheets (styles/*.css). */
export class LightElement extends LitElement {
	protected override createRenderRoot() { return this; }
}

export function connectHub(): HubConnection {
	return new HubConnectionBuilder()
		.withUrl("hub")
		.withAutomaticReconnect([0, 1000, 2000, 3000, 5000, 5000, 10000, 10000, 10000])
		.configureLogging(LogLevel.Warning)
		.build();
}

// ------------------------------------------------------------ Barrierefreiheit: Farbe UND Form UND Buchstabe
export const SHAPE_NAMES = ["Kreis", "Quadrat", "Dreieck", "Raute", "Stern", "Kreuz"];
const SHAPES: SVGTemplateResult[] = [
	svg`<circle cx="12" cy="12" r="9"/>`,
	svg`<rect x="3.5" y="3.5" width="17" height="17" rx="2"/>`,
	svg`<path d="M12 2.5 L22 20.5 H2 Z"/>`,
	svg`<path d="M12 1.5 L22.5 12 L12 22.5 L1.5 12 Z"/>`,
	svg`<path d="M12 1.8 L14.9 8.6 L22.2 9.2 L16.6 14 L18.3 21.2 L12 17.4 L5.7 21.2 L7.4 14 L1.8 9.2 L9.1 8.6 Z"/>`,
	svg`<path d="M8.5 2 H15.5 V8.5 H22 V15.5 H15.5 V22 H8.5 V15.5 H2 V8.5 H8.5 Z"/>`,
];
export const shape = (i: number) => svg`<svg class="shp" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${SHAPES[i % 6]}</svg>`;
export const optionLabel = (i: number) => `${LETTERS[i]} (${SHAPE_NAMES[i % 6]})`;
/** Antwortfarben mit dunkler Schrift (Kontrast) */
export const isDarkText = (i: number) => i === 2 || i === 5;

export const fmtInt = (n: number) => n.toLocaleString("de-DE");
export const fmtSecs = (ms: number) => (ms / 1000).toFixed(1).replace(".", ",");

/** Zahl animiert hochzählen */
export function countUp(el: Element, from: number, to: number, ms = 1200) {
	const t0 = performance.now();
	const step = (now: number) => {
		const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
		el.textContent = fmtInt(Math.round(from + (to - from) * e));
		if (k < 1) requestAnimationFrame(step);
	};
	requestAnimationFrame(step);
}

export const store = {
	get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
	set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat/blockiert */ } },
	del(k: string) { try { localStorage.removeItem(k); } catch { /* egal */ } },
};

export const vibrate = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* nicht unterstützt */ } };

/** Sammlung von Timeouts/RAFs, die bei Phasenwechsel gemeinsam abgebrochen werden */
export class Timers {
	private ids: number[] = [];
	private rafs: number[] = [];
	later(ms: number, fn: () => void) { this.ids.push(window.setTimeout(fn, ms)); }
	raf(fn: FrameRequestCallback) { const id = requestAnimationFrame(fn); this.rafs.push(id); return id; }
	clear() { this.ids.forEach(clearTimeout); this.rafs.forEach(cancelAnimationFrame); this.ids = []; this.rafs = []; }
}

/**
 * Schutz vor dem Verlassen mit ungespeicherten Änderungen: Eine Ansicht setzt `nav.guard`; der Router (main.ts) fragt
 * vor jedem Routenwechsel nach und springt bei „nein“ zurück. Beim Schließen des Tabs greift zusätzlich beforeunload.
 */
export const nav: { guard: (() => boolean) | null } = { guard: null };

/** Termin-/Datumsanzeige im Dozentenbereich */
export const fmtDate = (d: string) => new Date(d).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });

/** Datei aus dem Browser speichern */
export function download(name: string, data: BlobPart, type: string) {
	const a = document.createElement("a");
	a.href = URL.createObjectURL(new Blob([data], { type }));
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Zahl deutsch formatiert (ohne unnötige Nachkommastellen) */
export const fmtNum = (n: number | null | undefined, unit = "") =>
	n == null ? "–" : n.toLocaleString("de-DE", { maximumFractionDigits: 3 }) + (unit ? " " + unit : "");

/** Kurze Meldung unten am Bildschirmrand, verschwindet nach `ms` von selbst. */
export function toast(text: string, ms = 3000, kind: "ok" | "err" = "ok") {
	document.querySelector(".toast")?.remove();
	const el = Object.assign(document.createElement("div"), { className: `toast ${kind}`, textContent: text });
	el.setAttribute("role", "status");
	document.body.append(el);
	setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, ms);
}
