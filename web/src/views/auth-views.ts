// Anmeldung, Einladung/Passwort-Link einlösen, eigenes Konto, Benutzerverwaltung (Admin). Klassisch und schlicht.
import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LightElement } from "../core/util.ts";
import { ApiError, api, getMe, setMe, teacherHeader, type Me } from "../core/session.ts";

const fmt = (d: string | null) => d ? new Date(d).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "–";
const val = (root: HTMLElement, id: string) => (root.querySelector<HTMLInputElement>("#" + id)?.value ?? "");

async function copy(text: string, btn?: EventTarget | null) {
	try { await navigator.clipboard.writeText(text); } catch { prompt("Link kopieren:", text); return; }
	const b = btn as HTMLButtonElement | null;
	if (b) { const t = b.textContent; b.textContent = "✓ kopiert"; setTimeout(() => { b.textContent = t; }, 1500); }
}

// ---------------------------------------------------------------- Anmeldung
@customElement("login-view")
export class LoginView extends LightElement {
	@property() next = "#/";
	@state() private error = "";
	@state() private busy = false;
	/** Ersteinrichtung: Datenbank enthält noch kein Konto -> erstes Admin-Konto anlegen */
	@state() private setup = false;

	override connectedCallback() {
		super.connectedCallback();
		document.body.className = "teacher"; document.title = "Podium – Anmeldung";
		void getMe(true).then(m => { if (m) location.hash = this.next; });
		void api<{ needed: boolean }>("auth/setup").then(s => {
			this.setup = s.needed;
			if (s.needed) document.title = "Podium – Ersteinrichtung";
		}).catch(() => { });
	}
	override firstUpdated() { this.querySelector<HTMLInputElement>("#user")?.focus(); }
	override updated(changed: Map<string, unknown>) { if (changed.has("setup")) this.querySelector<HTMLInputElement>("#user")?.focus(); }

	private async submit(e: Event) {
		e.preventDefault();
		if (this.setup && val(this, "pw") !== val(this, "pw2")) { this.error = "Die beiden Passwörter stimmen nicht überein."; return; }
		this.busy = true; this.error = "";
		try {
			const m = this.setup
				? await api<Me>("auth/setup", { method: "POST", json: { userName: val(this, "user"), displayName: val(this, "name"), password: val(this, "pw") } })
				: await api<Me>("auth/login", { method: "POST", json: { userName: val(this, "user"), password: val(this, "pw") } });
			setMe(m);
			location.hash = this.next || "#/";
		} catch (err) {
			this.error = (err as Error).message;
			if ((err as ApiError).status === 409) this.setup = false;   // jemand anderes war schneller
		}
		finally { this.busy = false; }
	}

	protected override render() {
		if (this.setup) return html`<div class="auth-page">
			<form class="box auth-box" @submit=${(e: Event) => this.submit(e)}>
				<h1>Podium</h1>
				<p><b>Ersteinrichtung</b> – es gibt noch kein Konto. Legen Sie jetzt das Administrator-Konto an.
					Das geht nur dieses eine Mal; weitere Konten entstehen danach per Einladungslink.</p>
				${this.error ? html`<div class="msg err" role="alert">${this.error}</div>` : nothing}
				<label class="field"><span>Benutzername (a–z, 0–9, . _ -)</span><input type="text" id="user" autocomplete="username" required pattern="[a-zA-Z0-9._\\-]{2,40}"></label>
				<label class="field"><span>Anzeigename</span><input type="text" id="name" autocomplete="name" placeholder="z. B. Prof. Erika Muster"></label>
				<label class="field"><span>Passwort (mindestens 10 Zeichen)</span><input type="password" id="pw" autocomplete="new-password" minlength="10" required></label>
				<label class="field"><span>Passwort wiederholen</span><input type="password" id="pw2" autocomplete="new-password" minlength="10" required></label>
				<button class="primary" type="submit" ?disabled=${this.busy}>Admin-Konto anlegen</button>
			</form>
		</div>`;
		return html`<div class="auth-page">
			<form class="box auth-box" @submit=${(e: Event) => this.submit(e)}>
				<h1>Podium</h1>
				<p class="muted">Dozentenbereich – bitte anmelden.</p>
				${this.error ? html`<div class="msg err" role="alert">${this.error}</div>` : nothing}
				<label class="field"><span>Benutzername</span><input type="text" id="user" autocomplete="username" required></label>
				<label class="field"><span>Passwort</span><input type="password" id="pw" autocomplete="current-password" required></label>
				<button class="primary" type="submit" ?disabled=${this.busy}>Anmelden</button>
				<p class="muted small">Passwort vergessen? Bitte bei der Administration einen Link zum Zurücksetzen anfordern.<br>
				Studierende brauchen keine Anmeldung – sie treten per QR-Code bei.</p>
			</form>
		</div>`;
	}
}

// ---------------------------------------------------------------- Einladung / Passwort-Link einlösen
interface InviteInfo { kind: "invite" | "reset"; note: string; expiresUtc: string; userName: string | null; displayName: string | null; }

@customElement("invite-view")
export class InviteView extends LightElement {
	@property() token = "";
	@state() private info: InviteInfo | null = null;
	@state() private error = "";
	@state() private busy = false;

	override connectedCallback() {
		super.connectedCallback();
		document.body.className = "teacher"; document.title = "Podium – Zugang einrichten";
		api<InviteInfo>(`invite/${encodeURIComponent(this.token)}`).then(i => { this.info = i; }).catch(e => { this.error = (e as Error).message; });
	}

	private async submit(e: Event) {
		e.preventDefault();
		if (val(this, "pw") !== val(this, "pw2")) { this.error = "Die beiden Passwörter stimmen nicht überein."; return; }
		this.busy = true; this.error = "";
		try {
			const m = await api<Me>(`invite/${encodeURIComponent(this.token)}`, { method: "POST", json: { userName: val(this, "user"), displayName: val(this, "name"), password: val(this, "pw") } });
			setMe(m);
			location.hash = "#/";
		} catch (err) { this.error = (err as Error).message; }
		finally { this.busy = false; }
	}

	protected override render() {
		const i = this.info;
		return html`<div class="auth-page">
			<form class="box auth-box" @submit=${(e: Event) => this.submit(e)}>
				<h1>Podium</h1>
				${!i && !this.error ? html`<p>Link wird geprüft …</p>` : nothing}
				${this.error ? html`<div class="msg err" role="alert">${this.error}</div>` : nothing}
				${i?.kind === "invite" ? html`
					<p>Sie wurden eingeladen, Podium als Dozent·in zu nutzen. Legen Sie Ihren Zugang an:</p>
					<label class="field"><span>Benutzername (a–z, 0–9, . _ -)</span><input type="text" id="user" autocomplete="username" required pattern="[a-zA-Z0-9._\\-]{2,40}"></label>
					<label class="field"><span>Anzeigename</span><input type="text" id="name" autocomplete="name" placeholder="z. B. Prof. Erika Muster"></label>` : nothing}
				${i?.kind === "reset" ? html`<p>Neues Passwort für <b>${i.displayName}</b> (${i.userName}) festlegen:</p>` : nothing}
				${i ? html`
					<label class="field"><span>Passwort (mindestens 10 Zeichen)</span><input type="password" id="pw" autocomplete="new-password" minlength="10" required></label>
					<label class="field"><span>Passwort wiederholen</span><input type="password" id="pw2" autocomplete="new-password" minlength="10" required></label>
					<button class="primary" type="submit" ?disabled=${this.busy}>${i.kind === "invite" ? "Zugang anlegen" : "Passwort speichern"}</button>
					<p class="muted small">Der Link gilt bis ${fmt(i.expiresUtc)} und nur einmal.</p>` : nothing}
				${this.error && !i ? html`<p><a href="#/login">Zur Anmeldung</a></p>` : nothing}
			</form>
		</div>`;
	}
}

// ---------------------------------------------------------------- Eigenes Konto
@customElement("account-view")
export class AccountView extends LightElement {
	@state() private me: Me | null = null;
	@state() private msg: { text: string; ok: boolean } | null = null;

	override connectedCallback() {
		super.connectedCallback();
		document.body.className = "teacher"; document.title = "Podium – Mein Konto";
		void getMe().then(m => { this.me = m; if (!m) location.hash = "#/login"; });
	}

	private async submit(e: Event) {
		e.preventDefault();
		if (val(this, "pw") !== val(this, "pw2")) { this.msg = { text: "Die beiden neuen Passwörter stimmen nicht überein.", ok: false }; return; }
		try {
			await api("auth/password", { method: "POST", json: { current: val(this, "old"), new: val(this, "pw") } });
			this.msg = { text: "Passwort geändert.", ok: true };
			(e.target as HTMLFormElement).reset();
		} catch (err) { this.msg = { text: (err as Error).message, ok: false }; }
	}

	protected override render() {
		const m = this.me;
		return html`${teacherHeader(m, html`<a class="button" href="#/">← Zur Übersicht</a>`)}
			<main>
				<h2>Mein Konto</h2>
				${m ? html`<p>Angemeldet als <b>${m.displayName}</b> (${m.userName})${m.isAdmin ? " · Administrator·in" : ""}</p>` : nothing}
				${this.msg ? html`<div class="msg ${this.msg.ok ? "ok" : "err"}">${this.msg.text}</div>` : nothing}
				<form class="box" style="padding:16px;max-width:460px" @submit=${(e: Event) => this.submit(e)}>
					<label class="field"><span>Bisheriges Passwort</span><input type="password" id="old" autocomplete="current-password" required></label>
					<label class="field"><span>Neues Passwort (mindestens 10 Zeichen)</span><input type="password" id="pw" autocomplete="new-password" minlength="10" required></label>
					<label class="field"><span>Neues Passwort wiederholen</span><input type="password" id="pw2" autocomplete="new-password" minlength="10" required></label>
					<button class="primary" type="submit">Passwort ändern</button>
				</form>
			</main>`;
	}
}

// ---------------------------------------------------------------- Benutzerverwaltung (Admin)
interface UserRow { id: number; userName: string; displayName: string; isAdmin: boolean; active: boolean; createdUtc: string; lastLoginUtc: string | null; quizzes: number; }
interface InviteRow { id: number; note: string; isAdmin: boolean; createdUtc: string; expiresUtc: string; }

@customElement("users-view")
export class UsersView extends LightElement {
	@state() private me: Me | null = null;
	@state() private users: UserRow[] = [];
	@state() private invites: InviteRow[] = [];
	@state() private msg: { text: string; ok: boolean } | null = null;
	@state() private newLink: { title: string; link: string; expires: string } | null = null;

	override connectedCallback() {
		super.connectedCallback();
		document.body.className = "teacher"; document.title = "Podium – Benutzer";
		void this.load();
	}
	private async load() {
		this.me = await getMe();
		if (!this.me) return;
		if (!this.me.isAdmin) { this.msg = { text: "Nur für Administrator·innen.", ok: false }; return; }
		try {
			this.users = await api<UserRow[]>("users");
			this.invites = await api<InviteRow[]>("invites");
		} catch (e) { if ((e as ApiError).status !== 401) this.msg = { text: (e as Error).message, ok: false }; }
	}

	private async invite(e: Event) {
		e.preventDefault();
		const f = e.target as HTMLFormElement;
		try {
			const r = await api<{ link: string; expiresUtc: string }>("invites", { method: "POST", json: {
				note: val(f, "inv-note"), isAdmin: f.querySelector<HTMLInputElement>("#inv-admin")!.checked, days: Number(val(f, "inv-days")) } });
			this.newLink = { title: "Einladungslink", link: r.link, expires: r.expiresUtc };
			f.reset(); void this.load();
		} catch (err) { this.msg = { text: (err as Error).message, ok: false }; }
	}
	private async reset(u: UserRow) {
		try {
			const r = await api<{ link: string; expiresUtc: string }>(`users/${u.id}/reset`, { method: "POST" });
			this.newLink = { title: `Link zum Zurücksetzen des Passworts für ${u.displayName}`, link: r.link, expires: r.expiresUtc };
		} catch (err) { this.msg = { text: (err as Error).message, ok: false }; }
	}
	private async saveUser(u: UserRow, patch: Partial<UserRow>) {
		try { await api(`users/${u.id}`, { method: "PUT", json: { ...u, ...patch } }); void this.load(); }
		catch (err) { this.msg = { text: (err as Error).message, ok: false }; }
	}
	private async deleteUser(u: UserRow) {
		if (!confirm(`Konto „${u.userName}“ löschen?`)) return;
		try { await api(`users/${u.id}`, { method: "DELETE" }); void this.load(); }
		catch (err) { this.msg = { text: (err as Error).message, ok: false }; }
	}
	private async revoke(i: InviteRow) { await api(`invites/${i.id}`, { method: "DELETE" }); void this.load(); }

	protected override render() {
		const mail = this.newLink ? `mailto:?subject=${encodeURIComponent("Zugang zu Podium")}&body=${encodeURIComponent(`Hallo,\n\nhier ist Ihr persönlicher Link für Podium (gültig bis ${fmt(this.newLink.expires)}, nur einmal verwendbar):\n\n${this.newLink.link}\n\nViele Grüße`)}` : "";
		return html`${teacherHeader(this.me, html`<a class="button" href="#/">← Zur Übersicht</a>`)}
			<main>
				${this.msg ? html`<div class="msg ${this.msg.ok ? "ok" : "err"}">${this.msg.text}</div>` : nothing}
				${this.newLink ? html`<div class="box link-box">
					<b>${this.newLink.title}</b> – gültig bis ${fmt(this.newLink.expires)}, nur einmal verwendbar. Der Link wird nicht gespeichert und ist nur jetzt sichtbar.
					<div class="link-row"><input type="text" readonly .value=${this.newLink.link} @focus=${(e: Event) => (e.target as HTMLInputElement).select()}>
						<button class="primary" @click=${(e: Event) => copy(this.newLink!.link, e.target)}>Kopieren</button>
						<a class="button" href=${mail}>Per E-Mail</a>
						<button @click=${() => { this.newLink = null; }}>Schließen</button></div>
				</div>` : nothing}

				<h2>Kolleg·innen einladen</h2>
				<form class="box invite-form" @submit=${(e: Event) => this.invite(e)}>
					<label class="field"><span>Für wen? (Notiz, z. B. Name)</span><input type="text" id="inv-note" maxlength="100" placeholder="Prof. Erika Muster"></label>
					<label class="field small-field"><span>Gültig</span>
						<select id="inv-days"><option value="3">3 Tage</option><option value="7" selected>7 Tage</option><option value="14">14 Tage</option><option value="30">30 Tage</option></select></label>
					<label class="correct"><input type="checkbox" id="inv-admin"> Admin-Rechte</label>
					<button class="primary" type="submit">Einladungslink erzeugen</button>
				</form>
				${this.invites.length ? html`<div class="box"><table>
					<thead><tr><th>Offene Einladung</th><th>Erstellt</th><th>Gültig bis</th><th></th></tr></thead>
					<tbody>${this.invites.map(i => html`<tr><td>${i.note || "–"}${i.isAdmin ? html` <span class="tag">Admin</span>` : nothing}</td>
						<td class="muted">${fmt(i.createdUtc)}</td><td class="muted">${fmt(i.expiresUtc)}</td>
						<td class="actions"><button class="danger" @click=${() => this.revoke(i)}>Zurückziehen</button></td></tr>`)}</tbody>
				</table></div>` : nothing}

				<h2>Konten</h2>
				<div class="box"><table>
					<thead><tr><th>Name</th><th>Benutzer</th><th>Quizze</th><th>Zuletzt angemeldet</th><th></th></tr></thead>
					<tbody>${this.users.map(u => html`<tr class=${u.active ? "" : "inactive"}>
						<td><b>${u.displayName}</b>${u.isAdmin ? html` <span class="tag">Admin</span>` : nothing}${u.active ? nothing : html` <span class="tag off">deaktiviert</span>`}</td>
						<td>${u.userName}</td><td>${u.quizzes}</td><td class="muted">${fmt(u.lastLoginUtc)}</td>
						<td class="actions">${u.id === this.me?.id ? html`<span class="muted">(Sie)</span>` : html`
							<button @click=${() => this.reset(u)} title="Einmal-Link zum Setzen eines neuen Passworts">Passwort-Link</button>
							<button @click=${() => this.saveUser(u, { isAdmin: !u.isAdmin })}>${u.isAdmin ? "Admin entziehen" : "Zum Admin machen"}</button>
							<button @click=${() => this.saveUser(u, { active: !u.active })}>${u.active ? "Deaktivieren" : "Aktivieren"}</button>
							<button class="danger" @click=${() => this.deleteUser(u)}>Löschen</button>`}</td>
					</tr>`)}</tbody>
				</table></div>
			</main>`;
	}
}
