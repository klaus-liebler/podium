// Musikmanager (Dozentenbereich): je Abschnitt Stücke wählen – mitgelieferte oder eigene Uploads. Gilt für alle Runden dieses Kontos.
import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { LightElement } from "../core/util.ts";
import { ApiError, api, getMe, teacherHeader, type Me } from "../core/session.ts";
import { SLOTS, loadBuiltins, type Builtin, type MusicConfig, type Selection, type Upload } from "../audio/music-config.ts";
import type { MusicSlot } from "../audio/engine.ts";

const KIND_LABEL: Record<string, string> = { lobby: "Warteraum", question: "Frage", celebrate: "Feier", winner: "Siegerehrung", tada: "Tusch", extra: "nur bei Auswahl" };
const mb = (n: number) => (n / 1_000_000).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " MB";

@customElement("music-view")
export class MusicView extends LightElement {
	@state() private me: Me | null = null;
	@state() private builtins: Builtin[] = [];
	@state() private cfg: MusicConfig | null = null;
	@state() private error = "";
	@state() private info = "";
	@state() private busy = false;
	@state() private playing = "";
	private audio = new Audio();

	override connectedCallback() {
		super.connectedCallback();
		document.body.className = "teacher";
		document.title = "Podium – Musik";
		this.audio.addEventListener("ended", () => { this.playing = ""; });
		void this.load();
	}
	override disconnectedCallback() { super.disconnectedCallback(); this.audio.pause(); }

	private async load() {
		this.me = await getMe();
		if (!this.me) return;
		try {
			[this.builtins, this.cfg] = await Promise.all([loadBuiltins(), api<MusicConfig>("music")]);
		} catch (e) { if ((e as ApiError).status !== 401) this.error = "Server nicht erreichbar."; }
	}

	private sel(slot: MusicSlot) { return this.cfg?.selection?.[slot] ?? []; }
	private async toggle(slot: MusicSlot, ref: string, on: boolean) {
		if (!this.cfg) return;
		const list = this.sel(slot).filter(r => r !== ref);
		if (on) list.push(ref);
		const next: Selection = { ...this.cfg.selection, [slot]: list };
		this.cfg = { ...this.cfg, selection: next };
		try { this.cfg = { ...this.cfg, selection: await api<Selection>("music/selection", { method: "PUT", json: next }) }; this.error = ""; }
		catch (e) { this.error = (e as Error).message; }
	}
	private async reset(slot: MusicSlot) {
		if (!this.cfg) return;
		const next: Selection = { ...this.cfg.selection, [slot]: [] };
		this.cfg = { ...this.cfg, selection: await api<Selection>("music/selection", { method: "PUT", json: next }) };
	}

	private play(key: string, src: string, start = 0) {
		if (this.playing === key) { this.audio.pause(); this.playing = ""; return; }
		this.audio.src = src;
		this.audio.currentTime = start;
		this.audio.addEventListener("loadedmetadata", () => { this.audio.currentTime = start; }, { once: true });
		void this.audio.play().catch(() => { this.error = "Datei lässt sich im Browser nicht abspielen."; this.playing = ""; });
		this.playing = key;
	}

	private async upload(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = [...(input.files ?? [])]; if (!files.length) return;
		this.busy = true; this.error = ""; this.info = "";
		try {
			for (let i = 0; i < files.length; i += 4) { // höchstens 4 Dateien je Anfrage
				const fd = new FormData(); files.slice(i, i + 4).forEach(f => fd.append("files", f));
				await api<Upload[]>("music/uploads", { method: "POST", body: fd });
			}
			this.info = files.length === 1 ? `„${files[0].name}“ hochgeladen.` : `${files.length} Dateien hochgeladen.`;
		} catch (err) { this.error = (err as Error).message; }
		finally { this.busy = false; input.value = ""; this.cfg = await api<MusicConfig>("music"); }
	}
	private async patch(u: Upload, p: Partial<Pick<Upload, "title" | "start" | "introEnd">>) {
		const body = { title: p.title ?? u.title, start: "start" in p ? p.start : u.start, introEnd: "introEnd" in p ? p.introEnd : u.introEnd };
		try {
			const nu = await api<Upload>(`music/uploads/${u.id}`, { method: "PUT", json: body });
			this.cfg = { ...this.cfg!, uploads: this.cfg!.uploads.map(x => x.id === u.id ? nu : x) };
		} catch (e) { this.error = (e as Error).message; }
	}
	private async del(u: Upload) {
		if (!confirm(`„${u.title}“ löschen?`)) return;
		if (this.playing === "u:" + u.id) { this.audio.pause(); this.playing = ""; }
		await api(`music/uploads/${u.id}`, { method: "DELETE" });
		this.cfg = await api<MusicConfig>("music");
	}

	private checks(ref: string) {
		return SLOTS.map(s => html`<td class="ck"><input type="checkbox" aria-label="${s.label}" title="${s.label}"
			.checked=${this.sel(s.id).includes(ref)} @change=${(e: Event) => this.toggle(s.id, ref, (e.target as HTMLInputElement).checked)}></td>`);
	}
	private num(v: number | null, set: (n: number | null) => void, title: string) {
		return html`<input class="sec" type="number" min="0" step="0.5" placeholder="–" title=${title} .value=${v == null ? "" : String(v)}
			@change=${(e: Event) => { const t = (e.target as HTMLInputElement).value; set(t === "" ? null : Number(t)); }}>`;
	}

	protected override render() {
		const c = this.cfg;
		const used = c?.uploads.reduce((a, u) => a + u.size, 0) ?? 0;
		return html`
			${teacherHeader(this.me, html`<a class="button" href="#/">← Zur Übersicht</a>`)}
			<main class="music">
				<h2>🎵 Musik für meine Runden</h2>
				<p class="muted">Wähle pro Abschnitt ein oder mehrere Stücke – bei mehreren wird abwechselnd gespielt.
					Ist in einer Spalte nichts angehakt, gilt der <b>Standard</b> der jeweiligen 3D-Welt. Die Auswahl gilt für alle Runden dieses Kontos – laufende Leinwände übernehmen sie ab der nächsten Frage.</p>
				${this.error ? html`<div class="msg err">${this.error}</div>` : nothing}
				${this.info ? html`<div class="msg ok">${this.info}</div>` : nothing}
				${!c ? html`<div class="box empty" style="padding:16px">Lade …</div>` : html`
				<div class="box"><table class="music-table">
					<thead>
						<tr><th></th><th>Stück</th>${SLOTS.map(s => html`<th class="ck" title=${s.hint}>${s.label}<br>
							${this.sel(s.id).length ? html`<button class="link" @click=${() => this.reset(s.id)} title="Auswahl leeren – Standard der 3D-Welt">zurücksetzen</button>`
							: html`<span class="muted small">Standard</span>`}</th>`)}<th></th></tr>
					</thead>
					<tbody>
						<tr class="sep"><td colspan="7">Eigene Stücke ${c.uploads.length ? html`<span class="muted small">(${mb(used)} belegt)</span>` : nothing}</td></tr>
						${c.uploads.length ? c.uploads.map(u => html`<tr>
							<td><button class="play" title="Anhören" @click=${() => this.play("u:" + u.id, u.url, u.start ?? 0)}>${this.playing === "u:" + u.id ? "⏸" : "▶"}</button></td>
							<td><input class="title" .value=${u.title} @change=${(e: Event) => this.patch(u, { title: (e.target as HTMLInputElement).value })}>
								<div class="muted small">${u.fileName} · ${mb(u.size)} · ab Sek. ${this.num(u.start, n => this.patch(u, { start: n }), "Wiedergabe ab Sekunde (z. B. um Stille am Anfang zu überspringen)")}
								· Intro-Ende ${this.num(u.introEnd, n => this.patch(u, { introEnd: n }), "Nur Siegerehrung: hier blendet „Nach dem Intro ausblenden“ aus (sonst 18 s)")}</div></td>
							${this.checks("u:" + u.id)}
							<td><button class="danger" @click=${() => this.del(u)}>Löschen</button></td>
						</tr>`) : html`<tr><td></td><td colspan="6" class="muted">Noch keine eigenen Stücke.</td></tr>`}
						<tr><td></td><td colspan="6">
							<label class="button ${this.busy ? "disabled" : ""}">⬆ Dateien hochladen
								<input type="file" multiple accept=".mp3,.ogg,.oga,.opus,.m4a,.aac,.wav,.flac,.webm,audio/*" hidden ?disabled=${this.busy} @change=${(e: Event) => this.upload(e)}></label>
							<span class="muted small">${this.busy ? "Lädt hoch …" : "MP3, OGG, M4A, WAV, FLAC · max. 30 MB je Datei"}</span>
						</td></tr>
						<tr class="sep"><td colspan="7">Mitgelieferte Stücke</td></tr>
						${this.builtins.map(t => html`<tr>
							<td><button class="play" title="Anhören" @click=${() => this.play("b:" + t.file, "music/" + t.file, t.start ?? 0)}>${this.playing === "b:" + t.file ? "⏸" : "▶"}</button></td>
							<td><b>${t.title}</b><div class="muted small">${t.author} · Standard: ${t.kinds.map(k => KIND_LABEL[k] ?? k).join(", ")}</div></td>
							${this.checks("b:" + t.file)}
							<td></td>
						</tr>`)}
					</tbody>
				</table></div>`}
				<p class="muted small" style="margin-top:18px">Nur Musik hochladen, die du verwenden darfst (eigene Stücke, CC0/gemeinfrei, passende Lizenz).
					Stoppuhr-Ticken, Gong und Effekte laufen unabhängig von der Musik.</p>
			</main>`;
	}
}
