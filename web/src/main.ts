// Einstieg: eine einzige Seite mit Hash-Routing.
//   #/                 Dozentenbereich (Quiz-Übersicht)
//   #/folder/<id>      Dozentenbereich, ein Ordner (z. B. Kurs) geöffnet
//   #/edit/new|<id>    Quiz-Editor (#/edit/new?folder=<id> legt im Ordner an)
//   #/host/<pin>/<key> Leinwand (3D-Welt, Musik)
//   #/join[/<pin>]     Handy der Studierenden (Ziel des QR-Codes bei Quiz)
//   #/login · #/invite/<token> · #/account · #/users   Anmeldung und Konten
//   #/ask/<pin>        anonyme Antwortseite einer Live-Fragerunde (ohne Login/Avatar)
//   #/music            Musikmanager (Musik je Spielabschnitt, eigene Uploads) · #/music/quiz/<id> eigene Musik eines Quiz
//   #/preview/<welt>   Szenen-Vorschau (Admin): Leinwand mit 20 Beispielteilnehmenden, ohne echtes Spiel
//   #/remote/<pin>     Fernbedienung (Handy der Lehrperson, mit Anmeldung)
//   #/session/<id>     Auswertung einer gespielten Runde · #/shared/<token> geteiltes Quiz · #/trash Papierkorb
import "./styles/game.css";
import "./styles/player.css";
import "./styles/teacher.css";
import "./styles/direct.css";
import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { LightElement, nav } from "./core/util.ts";
import "./views/teacher-home.ts";
import "./views/quiz-editor.ts";
import "./views/host-view.ts";
import "./views/player-view.ts";
import "./views/auth-views.ts";
import "./views/music-view.ts";
import "./views/session-view.ts";
import "./views/shared-view.ts";
import "./views/remote-view.ts";

@customElement("podium-app")
export class PodiumApp extends LightElement {
	@state() private route = location.hash;

	override connectedCallback() {
		super.connectedCallback();
		window.addEventListener("hashchange", () => {
			// ungespeicherte Änderungen (z. B. im Editor)? Bei „Abbrechen“ zurück zur bisherigen Adresse, ohne neu zu rendern
			if (location.hash !== this.route && nav.guard && !nav.guard()) { history.replaceState(null, "", this.route || "#/"); return; }
			this.route = location.hash;
		});
	}

	protected override render(): TemplateResult {
		const [path, query = ""] = this.route.replace(/^#\/?/, "").split("?");
		const parts = path.split("/").filter(Boolean);
		switch (parts[0]) {
			case "login": { const q = new URLSearchParams(query); return html`<login-view .next=${q.get("next") ?? "#/"} .ssoError=${q.get("ssoerror") ?? ""} .zweiterFaktor=${q.has("zweiterfaktor")}></login-view>`; }
			case "invite": return html`<invite-view .token=${parts[1] ?? ""}></invite-view>`;
			case "account": return html`<account-view></account-view>`;
			case "users": return html`<users-view></users-view>`;
			case "host": return html`<host-view .pin=${parts[1] ?? ""} .hostKey=${parts[2] ?? ""}></host-view>`;
			case "preview": return html`<host-view .preview=${parts[1] ?? "studio"}></host-view>`;
			case "music": return html`<music-view .quizId=${parts[1] === "quiz" ? Number(parts[2] ?? 0) : 0}></music-view>`;
			case "remote": return html`<remote-view .pin=${parts[1] ?? ""}></remote-view>`;
			case "session": return html`<session-view .sessionId=${Number(parts[1] ?? 0)}></session-view>`;
			case "shared": return html`<shared-view .token=${parts[1] ?? ""}></shared-view>`;
			case "trash": return html`<teacher-home .trash=${true}></teacher-home>`;
			case "join": return html`<player-view .pin=${parts[1] ?? ""}></player-view>`;
			case "ask": return html`<player-view .pin=${parts[1] ?? ""} .anon=${true}></player-view>`;
			case "edit": return html`<quiz-editor .quizId=${parts[1] === "new" ? 0 : Number(parts[1] ?? 0)} .folderId=${Number(new URLSearchParams(query).get("folder") ?? 0)}></quiz-editor>`;
			case "folder": return html`<teacher-home .folderId=${Number(parts[1] ?? 0)}></teacher-home>`;
			default: return html`<teacher-home></teacher-home>`;
		}
	}
}
