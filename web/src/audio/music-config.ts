// Musikmanager: mitgelieferte Stücke (public/music/tracks.json) und eigene Uploads zu Abspiellisten je Abschnitt auflösen.
import type { MusicSlot, Track } from "./engine.ts";

export const SLOTS: { id: MusicSlot; label: string; hint: string }[] = [
	{ id: "lobby", label: "Warteraum", hint: "Beitreten, Live-Fragerunde" },
	{ id: "question", label: "Fragestellung", hint: "Frage und Antwortzeit (mit Stoppuhr-Ticken)" },
	{ id: "reveal", label: "Lösung & Statistik", hint: "Lösungsfolie, Zwischenstand, Endstatistik" },
	{ id: "podium", label: "Siegerehrung", hint: "startet mit dem Wachsen des Podests" },
];

export interface Upload { id: number; title: string; fileName: string; url: string; size: number; start: number | null; introEnd: number | null; createdUtc: string; }
export type Selection = Partial<Record<MusicSlot, string[] | null>>;
export interface MusicConfig { uploads: Upload[]; selection: Selection; }
/** Mitgeliefertes Stück mit den Abschnitten, in denen es standardmäßig läuft */
export interface Builtin extends Track { kinds: string[]; }

let builtins: Promise<Builtin[]> | null = null;
/** Alle mitgelieferten Stücke (ohne Doppelte), mit ihren Standard-Stimmungen */
export function loadBuiltins(): Promise<Builtin[]> {
	builtins ??= fetch("music/tracks.json", { cache: "no-cache" }).then(r => r.json()).then((j: Record<string, unknown>) => {
		const map = new Map<string, Builtin>();
		const add = (kind: string, list: unknown) => {
			if (!Array.isArray(list)) return;
			for (const t of list as Track[]) {
				const b = map.get(t.file) ?? { ...t, kinds: [] };
				if (!b.kinds.includes(kind)) b.kinds.push(kind);
				map.set(t.file, b);
			}
		};
		for (const [k, v] of Object.entries(j)) if (k !== "themes" && !k.startsWith("_")) add(k, v);
		for (const th of Object.values((j.themes ?? {}) as Record<string, Record<string, unknown>>)) for (const [k, v] of Object.entries(th)) add(k, v);
		return [...map.values()];
	}).catch(() => []);
	return builtins;
}

export const uploadTrack = (u: Upload): Track => ({ file: u.url, title: u.title, author: "eigene Datei", start: u.start ?? undefined, introEnd: u.introEnd ?? undefined });

/** Auswahl (Verweise "b:<datei>" / "u:<id>") in Abspiellisten für die AudioEngine übersetzen */
export async function resolveMusic(cfg: MusicConfig): Promise<Partial<Record<MusicSlot, Track[]>>> {
	const b = new Map((await loadBuiltins()).map(t => [t.file, t]));
	const u = new Map(cfg.uploads.map(x => [x.id, x]));
	const out: Partial<Record<MusicSlot, Track[]>> = {};
	for (const s of SLOTS) {
		const list: Track[] = [];
		for (const ref of cfg.selection?.[s.id] ?? []) {
			if (ref.startsWith("b:")) { const t = b.get(ref.slice(2)); if (t) list.push({ file: t.file, title: t.title, author: t.author, url: t.url, start: t.start, end: t.end, introEnd: t.introEnd }); }
			else if (ref.startsWith("u:")) { const x = u.get(Number(ref.slice(2))); if (x) list.push(uploadTrack(x)); }
		}
		if (list.length) out[s.id] = list;
	}
	return out;
}
