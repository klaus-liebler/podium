// Passkeys (WebAuthn) für Anmeldung und „Mein Konto“. Die Optionen erzeugt und prüft ASP.NET Core Identity auf dem Server;
// der Browser liefert nur öffentliche Daten (JSON nach WebAuthn Level 3).
import { api } from "./session.ts";

/** Passkeys im Browser verfügbar (inkl. JSON-Hilfen der WebAuthn-Level-3-API)? */
export const passkeyMoeglich = () =>
	typeof window.PublicKeyCredential !== "undefined" && typeof PublicKeyCredential.parseRequestOptionsFromJSON === "function";

async function optionen(pfad: string): Promise<unknown> {
	const r = await fetch("api/" + pfad, { method: "POST", credentials: "same-origin" });
	if (!r.ok) throw new Error(`Server antwortet mit ${r.status}`);
	return r.json();
}

function meldung(e: unknown): string {
	const n = (e as { name?: string }).name;
	return n === "NotAllowedError" || n === "AbortError" ? "Abgebrochen oder kein passender Passkey auf diesem Gerät." : `Passkey nicht möglich: ${(e as Error).message}`;
}

/** Anmeldung mit einem auffindbaren Passkey (ohne Benutzername). Liefert die Antwort von auth/passkey/login. */
export async function mitPasskeyAnmelden<T>(): Promise<T> {
	try {
		const o = PublicKeyCredential.parseRequestOptionsFromJSON(await optionen("auth/passkey/options") as PublicKeyCredentialRequestOptionsJSON);
		const c = await navigator.credentials.get({ publicKey: o });
		if (!c) throw new Error("kein Passkey");
		return await api<T>("auth/passkey/login", { method: "POST", json: { credential: JSON.stringify(c) } });
	} catch (e) {
		if ((e as { status?: number }).status) throw e;   // Fehler vom Server unverändert weitergeben
		throw new Error(meldung(e));
	}
}

/** Neuen Passkey für das eigene Konto anlegen. */
export async function passkeyHinzufuegen<T>(name: string): Promise<T> {
	try {
		const o = PublicKeyCredential.parseCreationOptionsFromJSON(await optionen("auth/passkeys/options") as PublicKeyCredentialCreationOptionsJSON);
		const c = await navigator.credentials.create({ publicKey: o });
		if (!c) throw new Error("kein Passkey");
		return await api<T>("auth/passkeys", { method: "POST", json: { credential: JSON.stringify(c), name } });
	} catch (e) {
		if ((e as { status?: number }).status) throw e;
		throw new Error(meldung(e));
	}
}
