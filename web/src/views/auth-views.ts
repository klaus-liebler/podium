// Anmeldung, Einladung/Passwort-Link einlösen, eigenes Konto, Benutzerverwaltung (Admin). Klassisch und schlicht.
import { html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { LightElement } from "../core/util.ts";
import { ApiError, api, getMe, methods, setMe, teacherHeader, type LoginResult, type Me, type Methods } from "../core/session.ts";
import { mitPasskeyAnmelden, passkeyHinzufuegen, passkeyMoeglich } from "../core/passkey.ts";

const fmt = (d: string | null) => d ? new Date(d).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "–";
const val = (root: HTMLElement, id: string) => (root.querySelector<HTMLInputElement>("#" + id)?.value ?? "");

async function copy(text: string, btn?: EventTarget | null) {
	try { await navigator.clipboard.writeText(text); } catch { prompt("Link kopieren:", text); return; }
	const b = btn as HTMLButtonElement | null;
	if (b) { const t = b.textContent; b.textContent = "✓ kopiert"; setTimeout(() => { b.textContent = t; }, 1500); }
}

// ---------------------------------------------------------------- Anmeldung
/** Nach erster Stufe: angemeldet → Ziel, sonst zweiter Faktor auf der Anmeldeseite */
export function nachAnmeldung(r: LoginResult, next = "#/"): "code" | "setup" | null {
	if (typeof r.twoFactor === "string") return r.twoFactor;
	setMe(r as Me);
	location.hash = next || "#/";
	return null;
}

/** QR-Code, Schlüssel zum Abtippen und Code-Feld zum Einrichten der Authenticator-App (Anmeldung und „Mein Konto“) */
function totpEinrichtung(s: { key: string; qr: string } | null, absenden: (e: Event) => void, busy: boolean) {
	return html`<form class="totp-setup" @submit=${absenden}>
		<p>Scannen Sie den QR-Code mit einer Authenticator-App (z. B. Microsoft Authenticator, FreeOTP, Aegis, 2FAS) und geben Sie den
			angezeigten sechsstelligen Code ein.</p>
		${s ? html`<div class="totp-row"><img class="totp-qr" src=${s.qr} alt="QR-Code für die Authenticator-App" width="180" height="180">
			<p class="small">Oder den Schlüssel von Hand eingeben:<br><code class="totp-key">${s.key}</code><br><span class="muted">zeitbasiert (TOTP), 6 Stellen</span></p></div>`
			: html`<p class="muted">QR-Code wird erzeugt …</p>`}
		<label class="field"><span>Code aus der App</span><input type="text" id="totp-code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required></label>
		<button class="primary" type="submit" ?disabled=${busy}>Einrichten</button>
	</form>`;
}

function codesAnzeigen(codes: string[]) {
	return html`<div class="msg ok">Der zweite Faktor ist eingerichtet.</div>
		<p>Bewahren Sie diese <b>Wiederherstellungscodes</b> sicher auf (ausdrucken oder im Passwortsafe). Jeder gilt einmal, falls das Telefon
			verloren geht. Sie werden nur jetzt angezeigt.</p>
		<ul class="totp-codes">${codes.map(c => html`<li><code>${c}</code></li>`)}</ul>`;
}

@customElement("login-view")
export class LoginView extends LightElement {
	@property() next = "#/";
	@state() private error = "";
	@state() private busy = false;
	/** Ersteinrichtung: Datenbank enthält noch kein Konto -> erstes Admin-Konto anlegen */
	@state() private setup = false;
	/** Fehlermeldung nach Rückkehr vom Hochschul-Login (#/login?ssoerror=…) */
	@property() ssoError = "";
	/** Rückkehr vom Identitätsdienst mit offenem zweiten Faktor (#/login?zweiterfaktor=1) */
	@property({ type: Boolean }) zweiterFaktor = false;
	@state() private m: Methods | null = null;
	/** zweite Stufe: Code eingeben oder (Admins ohne Faktor) erst einrichten */
	@state() private faktor: "code" | "setup" | null = null;
	@state() private einrichtung: { key: string; qr: string } | null = null;
	@state() private codes: string[] | null = null;
	@state() private wiederherstellung = false;

	override connectedCallback() {
		super.connectedCallback();
		document.body.className = "teacher"; document.title = "Podium – Anmeldung";
		if (this.ssoError) this.error = this.ssoError;
		void methods().then(m => { this.m = m; });
		if (this.zweiterFaktor) void api<{ twoFactor: "code" | "setup" }>("auth/2fa").then(r => this.zweiteStufe(r.twoFactor)).catch(e => { this.error = (e as Error).message; });
		else void getMe(true).then(m => { if (m) location.hash = this.next; });
		void api<{ needed: boolean }>("auth/setup").then(s => {
			this.setup = s.needed;
			if (s.needed) document.title = "Podium – Ersteinrichtung";
		}).catch(() => { });
	}
	override firstUpdated() { this.querySelector<HTMLInputElement>("#user")?.focus(); }
	override updated(changed: Map<string, unknown>) {
		if (changed.has("setup")) this.querySelector<HTMLInputElement>("#user")?.focus();
		if (changed.has("faktor") && this.faktor) this.querySelector<HTMLInputElement>("#totp-code")?.focus();
	}

	private zweiteStufe(f: "code" | "setup" | null) {
		this.faktor = f;
		this.setup = false;
		if (f === "setup") void api<{ key: string; qr: string }>("auth/2fa/setup").then(s => { this.einrichtung = s; }).catch(e => { this.error = (e as Error).message; });
	}

	private async submit(e: Event) {
		e.preventDefault();
		if (this.setup && val(this, "pw") !== val(this, "pw2")) { this.error = "Die beiden Passwörter stimmen nicht überein."; return; }
		this.busy = true; this.error = "";
		try {
			const r = this.setup
				? await api<LoginResult>("auth/setup", { method: "POST", json: { userName: val(this, "user"), displayName: val(this, "name"), password: val(this, "pw") } })
				: await api<LoginResult>("auth/login", { method: "POST", json: { userName: val(this, "user"), password: val(this, "pw") } });
			this.zweiteStufe(nachAnmeldung(r, this.next));
		} catch (err) {
			this.error = (err as Error).message;
			if ((err as ApiError).status === 409) this.setup = false;   // jemand anderes war schneller
		}
		finally { this.busy = false; }
	}

	private async passkey() {
		this.busy = true; this.error = "";
		try { this.zweiteStufe(nachAnmeldung(await mitPasskeyAnmelden<LoginResult>(), this.next)); }
		catch (err) { this.error = (err as Error).message; }
		finally { this.busy = false; }
	}

	private async code(e: Event) {
		e.preventDefault();
		this.busy = true; this.error = "";
		try {
			const json = this.wiederherstellung ? { recoveryCode: val(this, "totp-code") } : { code: val(this, "totp-code") };
			setMe(await api<Me>("auth/2fa", { method: "POST", json }));
			location.hash = this.next || "#/";
		} catch (err) { this.error = (err as Error).message; }
		finally { this.busy = false; }
	}

	private async einrichten(e: Event) {
		e.preventDefault();
		this.busy = true; this.error = "";
		try {
			const r = await api<{ recoveryCodes: string[]; me: Me }>("auth/2fa/enable", { method: "POST", json: { code: val(this, "totp-code") } });
			setMe(r.me);
			this.codes = r.recoveryCodes;
		} catch (err) { this.error = (err as Error).message; }
		finally { this.busy = false; }
	}

	protected override render() {
		const fehler = this.error ? html`<div class="msg err" role="alert">${this.error}</div>` : nothing;
		if (this.codes) return html`<div class="auth-page"><div class="box auth-box">
			<h1>Podium</h1>${codesAnzeigen(this.codes)}
			<button class="primary" @click=${() => { location.hash = this.next || "#/"; }}>Weiter zu Podium</button>
		</div></div>`;
		if (this.faktor === "setup") return html`<div class="auth-page"><div class="box auth-box">
			<h1>Zweiten Faktor einrichten</h1>
			<p class="muted small">Für Administrator·innen ist ein zweiter Faktor Pflicht.</p>
			${fehler}${totpEinrichtung(this.einrichtung, e => this.einrichten(e), this.busy)}
		</div></div>`;
		if (this.faktor === "code") return html`<div class="auth-page"><form class="box auth-box" @submit=${(e: Event) => this.code(e)}>
			<h1>Zweiter Faktor</h1>
			${fehler}
			<p>${this.wiederherstellung ? "Geben Sie einen Ihrer Wiederherstellungscodes ein." : "Geben Sie den sechsstelligen Code aus Ihrer Authenticator-App ein."}</p>
			<label class="field"><span>${this.wiederherstellung ? "Wiederherstellungscode" : "Code"}</span>
				<input type="text" id="totp-code" autocomplete=${this.wiederherstellung ? "off" : "one-time-code"} inputmode=${this.wiederherstellung ? "text" : "numeric"} required></label>
			<button class="primary" type="submit" ?disabled=${this.busy}>Anmelden</button>
			<p class="small"><a href="#" @click=${(e: Event) => { e.preventDefault(); this.wiederherstellung = !this.wiederherstellung; }}>
				${this.wiederherstellung ? "Code aus der App eingeben" : "Telefon verloren? Mit Wiederherstellungscode anmelden"}</a></p>
		</form></div>`;
		if (this.setup) return html`<div class="auth-page">
			<form class="box auth-box" @submit=${(e: Event) => this.submit(e)}>
				<h1>Podium</h1>
				<p><b>Ersteinrichtung</b> – es gibt noch kein Konto. Legen Sie jetzt das Administrator-Konto an.
					Das geht nur dieses eine Mal; weitere Konten entstehen danach per Einladungslink. Danach richten Sie den zweiten Faktor ein.</p>
				${fehler}
				<label class="field"><span>Benutzername (a–z, 0–9, . _ -)</span><input type="text" id="user" autocomplete="username" required pattern="[a-zA-Z0-9._\\-]{2,40}"></label>
				<label class="field"><span>Anzeigename</span><input type="text" id="name" autocomplete="name" placeholder="z. B. Prof. Erika Muster"></label>
				<label class="field"><span>Passwort (mindestens 10 Zeichen)</span><input type="password" id="pw" autocomplete="new-password" minlength="10" required></label>
				<label class="field"><span>Passwort wiederholen</span><input type="password" id="pw2" autocomplete="new-password" minlength="10" required></label>
				<button class="primary" type="submit" ?disabled=${this.busy}>Admin-Konto anlegen</button>
			</form>
		</div>`;
		const m = this.m;
		const sso = !!(m?.saml || m?.oidc);
		const kacheln = [
			m?.saml ? html`<div class="box auth-box">
				<h2>${m.saml.name}</h2>
				<p class="muted small">Für Mitarbeitende der Hochschule: Anmeldung mit der zentralen Hochschulkennung – ohne eigenes Podium-Passwort.</p>
				<a class="button primary auth-sso" href="api/auth/saml/login">Mit Hochschulkennung anmelden</a>
			</div>` : null,
			m?.oidc ? html`<div class="box auth-box">
				<h2>${m.oidc.name}</h2>
				<p class="muted small">Single Sign-on über den Identitätsdienst Ihrer Einrichtung (OpenID Connect).</p>
				<a class="button primary auth-sso" href="api/auth/oidc/login">Mit ${m.oidc.name} anmelden</a>
			</div>` : null,
			m?.passkey ? html`<div class="box auth-box">
				<h2>Passkey</h2>
				<p class="muted small">Ohne Passwort: Fingerabdruck, Gesicht oder Geräte-PIN. Einen Passkey legen Sie nach der ersten Anmeldung unter „Mein Konto“ an.</p>
				<button class="primary auth-sso" type="button" ?disabled=${this.busy || !passkeyMoeglich()} @click=${() => this.passkey()}>Mit Passkey anmelden</button>
				${passkeyMoeglich() ? nothing : html`<p class="muted small">Dieser Browser unterstützt keine Passkeys.</p>`}
			</div>` : null,
			!m || m.password ? html`<form class="box auth-box" @submit=${(e: Event) => this.submit(e)}>
				<h2>${sso ? "Lokales Podium-Konto" : "Benutzername und Passwort"}</h2>
				${sso ? html`<p class="muted small">Für Konten mit eigenem Benutzernamen und Passwort (z. B. per Einladungslink angelegt).</p>` : nothing}
				<label class="field"><span>Benutzername</span><input type="text" id="user" autocomplete="username" required></label>
				<label class="field"><span>Passwort</span><input type="password" id="pw" autocomplete="current-password" required></label>
				<button class=${sso ? "" : "primary"} type="submit" ?disabled=${this.busy}>${sso ? "Mit lokalem Nutzer anmelden" : "Anmelden"}</button>
				<p class="muted small">Passwort vergessen? Bitte bei der Administration einen Link zum Zurücksetzen anfordern.</p>
			</form>` : null,
		].filter(k => k !== null);
		return html`<div class="auth-page">
			<div class="auth-wrap">
				<h1>Podium</h1>
				<p class="muted">Dozentenbereich – bitte anmelden. Studierende brauchen keine Anmeldung – sie treten per QR-Code bei.</p>
				${fehler}
				<div class="auth-split" style=${`--kacheln:${Math.max(1, kacheln.length)}`}>${kacheln}</div>
			</div>
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
			const r = await api<LoginResult>(`invite/${encodeURIComponent(this.token)}`, { method: "POST", json: { userName: val(this, "user"), displayName: val(this, "name"), password: val(this, "pw") } });
			if (nachAnmeldung(r)) location.hash = "#/login?zweiterfaktor=1";   // Admin: zweiter Faktor ist Pflicht
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
	@state() private m: Methods | null = null;
	/** Einrichtung des zweiten Faktors läuft (QR-Code), danach einmalig die Wiederherstellungscodes */
	@state() private einrichtung: { key: string; qr: string } | null = null;
	@state() private codes: string[] | null = null;
	@state() private secMsg: { text: string; ok: boolean } | null = null;
	/** KI-Vorschläge: eigener Claude-API-Schlüssel (nur die letzten 4 Zeichen werden angezeigt) */
	@state() private ai: { enabled: boolean; own: boolean; server: boolean; hint: string | null } | null = null;
	@state() private aiMsg: { text: string; ok: boolean } | null = null;

	override connectedCallback() {
		super.connectedCallback();
		document.body.className = "teacher"; document.title = "Podium – Mein Konto";
		void getMe(true).then(m => { this.me = m; if (!m) location.hash = "#/login"; else void this.loadAi(); });
		void methods().then(m => { this.m = m; });
	}
	private async loadAi() { this.ai = await api<NonNullable<AccountView["ai"]>>("ai").catch(() => null); }
	private async saveAiKey(e: Event) {
		e.preventDefault();
		const input = this.querySelector<HTMLInputElement>("#aikey")!;
		try {
			await api("ai/key", { method: "PUT", json: { key: input.value } });
			input.value = "";
			this.aiMsg = { text: "Schlüssel gespeichert. KI-Vorschläge findest du im Quiz-Editor.", ok: true };
			await this.loadAi();
		} catch (err) { this.aiMsg = { text: (err as Error).message, ok: false }; }
	}
	private async delAiKey() {
		if (!confirm("Claude-API-Schlüssel entfernen?")) return;
		await api("ai/key", { method: "DELETE" });
		this.aiMsg = { text: "Schlüssel entfernt.", ok: true };
		await this.loadAi();
	}

	private async sicher(arbeit: () => Promise<void>, ok?: string) {
		this.secMsg = null;
		try { await arbeit(); if (ok) this.secMsg = { text: ok, ok: true }; }
		catch (err) { this.secMsg = { text: (err as Error).message, ok: false }; }
	}
	private totpStarten() { return this.sicher(async () => { this.codes = null; this.einrichtung = await api<{ key: string; qr: string }>("auth/2fa/setup"); }); }
	private totpEinrichten(e: Event) {
		e.preventDefault();
		return this.sicher(async () => {
			const r = await api<{ recoveryCodes: string[]; me: Me }>("auth/2fa/enable", { method: "POST", json: { code: val(this, "totp-code") } });
			this.einrichtung = null; this.codes = r.recoveryCodes; this.me = r.me; setMe(r.me);
		});
	}
	private totpCodesNeu() {
		if (!confirm("Neue Wiederherstellungscodes erzeugen? Die bisherigen gelten dann nicht mehr.")) return;
		return this.sicher(async () => { this.codes = (await api<{ recoveryCodes: string[] }>("auth/2fa/recovery-codes", { method: "POST" })).recoveryCodes; });
	}
	private totpAus() {
		if (!confirm("Zweiten Faktor ausschalten?")) return;
		return this.sicher(async () => { this.me = await api<Me>("auth/2fa", { method: "DELETE" }); setMe(this.me); this.codes = null; }, "Zweiter Faktor ausgeschaltet.");
	}
	private passkeyNeu(e: Event) {
		e.preventDefault();
		return this.sicher(async () => { this.me = await passkeyHinzufuegen<Me>(val(this, "pk-name")); setMe(this.me); (e.target as HTMLFormElement).reset(); }, "Passkey hinzugefügt.");
	}
	private passkeyWeg(id: string, name: string) {
		if (!confirm(`Passkey „${name}“ entfernen?`)) return;
		return this.sicher(async () => { this.me = await api<Me>("auth/passkeys/remove", { method: "POST", json: { credential: id } }); setMe(this.me); }, "Passkey entfernt.");
	}

	/** Abschnitt „Anmeldung und Sicherheit“: zweiter Faktor und Passkeys */
	private sicherheit(m: Me) {
		return html`<h2>🔐 Anmeldung und Sicherheit</h2>
			${this.secMsg ? html`<div class="msg ${this.secMsg.ok ? "ok" : "err"}">${this.secMsg.text}</div>` : nothing}
			<div class="sec-grid">
				<div class="box sec-box">
					<h3>Zweiter Faktor (Authenticator-App)</h3>
					${this.codes ? codesAnzeigen(this.codes) : nothing}
					${m.twoFactor ? html`<p>✓ Eingerichtet – noch ${m.recoveryCodesLeft} Wiederherstellungscodes.</p>
						<p><button @click=${() => this.totpCodesNeu()}>Neue Wiederherstellungscodes</button>
						${m.isAdmin ? html`<span class="muted small">Für Administrator·innen Pflicht.</span>` : html`<button class="danger" @click=${() => this.totpAus()}>Ausschalten</button>`}</p>`
					: this.einrichtung ? totpEinrichtung(this.einrichtung, e => this.totpEinrichten(e), false)
					: html`<p class="muted">Noch nicht eingerichtet. Danach fragt Podium bei der Anmeldung mit Passwort zusätzlich einen Code ab.</p>
						<button class="primary" @click=${() => this.totpStarten()}>Jetzt einrichten</button>`}
				</div>
				<div class="box sec-box">
					<h3>Passkeys</h3>
					${m.passkeys.length ? html`<ul class="pk-list">${m.passkeys.map(p => html`<li><span><b>${p.name}</b><br><span class="muted small">angelegt ${fmt(p.createdUtc)}</span></span>
						<button class="danger" @click=${() => this.passkeyWeg(p.id, p.name)}>Entfernen</button></li>`)}</ul>`
					: html`<p class="muted">Noch keiner. Mit einem Passkey melden Sie sich ohne Passwort an – geschützt durch Fingerabdruck, Gesicht oder Geräte-PIN.</p>`}
					${this.m?.passkey ? (passkeyMoeglich() ? html`<form @submit=${(e: Event) => this.passkeyNeu(e)}>
						<label class="field"><span>Bezeichnung</span><input type="text" id="pk-name" maxlength="100" placeholder="z. B. Dienstlaptop, Telefon"></label>
						<button class="primary" type="submit">Passkey hinzufügen</button></form>`
						: html`<p class="muted small">Dieser Browser unterstützt keine Passkeys.</p>`)
					: html`<p class="muted small">Passkeys sind auf dieser Instanz ausgeschaltet.</p>`}
				</div>
			</div>`;
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
				${m?.sso ? html`<p>✓ Mit der Hochschulkennung verknüpft – Sie können sich über „Mit Hochschulkennung anmelden“ einloggen.</p>`
					: this.m?.saml && m ? html`<p><a class="button" href="api/auth/saml/login?link=true"
						title="Danach können Sie sich mit Ihrer Hochschulkennung bei diesem Konto anmelden">Mit Hochschulkennung verknüpfen</a></p>` : nothing}
				${m?.oidc ? html`<p>✓ Mit ${this.m?.oidc?.name ?? "dem Firmenkonto"} verknüpft.</p>`
					: this.m?.oidc && m ? html`<p><a class="button" href="api/auth/oidc/login?link=true">Mit ${this.m.oidc.name} verknüpfen</a></p>` : nothing}
				${m && !m.hasPassword ? nothing : html`<h2>Passwort ändern</h2><form class="box" style="padding:16px;max-width:460px" @submit=${(e: Event) => this.submit(e)}>
					<label class="field"><span>Bisheriges Passwort</span><input type="password" id="old" autocomplete="current-password" required></label>
					<label class="field"><span>Neues Passwort (mindestens 10 Zeichen)</span><input type="password" id="pw" autocomplete="new-password" minlength="10" required></label>
					<label class="field"><span>Neues Passwort wiederholen</span><input type="password" id="pw2" autocomplete="new-password" minlength="10" required></label>
					<button class="primary" type="submit">Passwort ändern</button>
				</form>`}
				${m ? this.sicherheit(m) : nothing}
				${m && this.ai ? html`<h2>✨ KI-Vorschläge (Claude)</h2>
				<form class="box" style="padding:16px;max-width:620px" @submit=${(e: Event) => this.saveAiKey(e)}>
					<p style="margin-top:0">Im Quiz-Editor kann Claude aus einem Text oder PDF Fragen vorschlagen. Dafür brauchst du einen eigenen
						API-Schlüssel von <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>;
						die Kosten laufen über dein Anthropic-Konto. Der Schlüssel wird verschlüsselt gespeichert und nie wieder angezeigt.</p>
					${this.aiMsg ? html`<div class="msg ${this.aiMsg.ok ? "ok" : "err"}">${this.aiMsg.text}</div>` : nothing}
					${this.ai.own ? html`<p>✓ Eigener Schlüssel hinterlegt (<code>${this.ai.hint}</code>)
						<button type="button" class="danger" @click=${() => this.delAiKey()}>Entfernen</button></p>`
					: this.ai.server ? html`<p class="muted">Zurzeit wird der Schlüssel des Servers verwendet. Mit einem eigenen Schlüssel laufen die Kosten über dein Konto.</p>` : nothing}
					<label class="field"><span>${this.ai.own ? "Schlüssel ersetzen" : "Claude-API-Schlüssel"} (beginnt mit „sk-ant-“)</span>
						<input type="password" id="aikey" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" required></label>
					<button class="primary" type="submit">Schlüssel speichern</button>
				</form>` : nothing}
			</main>`;
	}
}

// ---------------------------------------------------------------- Benutzerverwaltung (Admin)
interface UserRow { id: number; userName: string; displayName: string; isAdmin: boolean; active: boolean; createdUtc: string; lastLoginUtc: string | null; quizzes: number; sso: boolean; email: string | null; twoFactorEnabled: boolean; passkeys: number; }
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
	private async reset2fa(u: UserRow) {
		if (!confirm(`Zweiten Faktor von „${u.userName}“ zurücksetzen? (z. B. Telefon verloren)`)) return;
		try { await api(`users/${u.id}/reset-2fa`, { method: "POST" }); this.msg = { text: `Zweiter Faktor von ${u.displayName} zurückgesetzt.`, ok: true }; void this.load(); }
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
						<td><b>${u.displayName}</b>${u.isAdmin ? html` <span class="tag">Admin</span>` : nothing}${u.active ? nothing : html` <span class="tag off">deaktiviert</span>`}${u.sso ? html` <span class="tag" title="Anmeldung mit Hochschulkennung">HS</span>` : nothing}${u.twoFactorEnabled ? html` <span class="tag" title="Zweiter Faktor (Authenticator-App) eingerichtet">2FA</span>` : u.isAdmin ? html` <span class="tag off" title="Wird bei der nächsten Anmeldung mit Passwort eingerichtet">2FA fehlt</span>` : nothing}${u.passkeys ? html` <span class="tag" title="Passkeys">🔑 ${u.passkeys}</span>` : nothing}</td>
						<td>${u.userName}${u.email ? html`<br><span class="muted small">${u.email}</span>` : nothing}</td><td>${u.quizzes}</td><td class="muted">${fmt(u.lastLoginUtc)}</td>
						<td class="actions">${u.id === this.me?.id ? html`<span class="muted">(Sie)</span>` : html`
							<button @click=${() => this.reset(u)} title="Einmal-Link zum Setzen eines neuen Passworts">Passwort-Link</button>
							${u.twoFactorEnabled ? html`<button @click=${() => this.reset2fa(u)} title="Telefon verloren: zweiten Faktor zurücksetzen">2FA zurücksetzen</button>` : nothing}
							<button @click=${() => this.saveUser(u, { isAdmin: !u.isAdmin })}>${u.isAdmin ? "Admin entziehen" : "Zum Admin machen"}</button>
							<button @click=${() => this.saveUser(u, { active: !u.active })}>${u.active ? "Deaktivieren" : "Aktivieren"}</button>
							<button class="danger" @click=${() => this.deleteUser(u)}>Löschen</button>`}</td>
					</tr>`)}</tbody>
				</table></div>
			</main>`;
	}
}
