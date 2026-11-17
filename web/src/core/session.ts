// API-Zugriff und Anmeldestatus des Dozentenbereichs.
// Alle URLs sind relativ, damit die App auch unter einem Unterpfad läuft (z. B. /podium/).
import { html, nothing } from "lit";

export interface Me { id: number; userName: string; displayName: string; isAdmin: boolean; }

export class ApiError extends Error {
	constructor(public status: number, message: string, public data: Record<string, unknown> = {}) { super(message); }
}

let me: Me | null | undefined;

/** JSON-API; bei 401 geht es (außer bei der Anmeldung selbst) zur Anmeldeseite. */
export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
	const { json, ...rest } = init;
	const r = await fetch("api/" + path.replace(/^\//, ""), {
		credentials: "same-origin",
		...rest,
		headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
		body: json !== undefined ? JSON.stringify(json) : rest.body,
	});
	if (r.status === 401 && !path.startsWith("auth/login") && !path.startsWith("invite/")) {
		me = null;
		toLogin();
		throw new ApiError(401, "Bitte anmelden.");
	}
	if (r.status === 204) return undefined as T;
	const data = await r.json().catch(() => ({}));
	if (!r.ok) throw new ApiError(r.status, (data as { error?: string }).error ?? `Fehler ${r.status}`, data as Record<string, unknown>);
	return data as T;
}

export function toLogin() {
	if (location.hash.startsWith("#/login")) return;
	const next = encodeURIComponent(location.hash || "#/");
	location.hash = `#/login?next=${next}`;
}

export async function getMe(force = false): Promise<Me | null> {
	if (me !== undefined && !force) return me;
	try { me = await api<Me>("auth/me"); } catch { me = null; }
	return me;
}
export function setMe(m: Me | null) { me = m; }

export async function logout() {
	await api("auth/logout", { method: "POST" }).catch(() => { });
	me = null;
	location.hash = "#/login";
}

/** Kopfzeile des Dozentenbereichs */
export function teacherHeader(m: Me | null, extra: unknown = nothing) {
	return html`<header class="top">
		<h1><a href="#/">Podium · Dozentenbereich</a></h1>
		<span class="spacer"></span>
		${extra}
		${m ? html`
			${m.isAdmin ? html`<a class="button" href="#/users" title="Konten und Einladungen verwalten">👥 Benutzer</a>` : nothing}
			<a class="button user-btn" href="#/account" title="Eigenes Konto, Passwort ändern">👤 ${m.displayName}</a>
			<button @click=${() => logout()}>Abmelden</button>` : nothing}
	</header>`;
}
