// Einstieg: eine einzige Seite mit Hash-Routing.
//   #/                 Dozentenbereich (Quiz-Übersicht)
//   #/edit/new|<id>    Quiz-Editor
//   #/host/<pin>/<key> Leinwand (3D-Welt, Musik)
//   #/join[/<pin>]     Handy der Studierenden (Ziel des QR-Codes bei Quiz)
//   #/login · #/invite/<token> · #/account · #/users   Anmeldung und Konten
//   #/ask/<pin>        anonyme Antwortseite einer Live-Fragerunde (ohne Login/Avatar)
//   #/music            Musikmanager (Musik je Spielabschnitt, eigene Uploads)
//   #/preview/<welt>   Szenen-Vorschau (Admin): Leinwand mit 20 Beispielteilnehmenden, ohne echtes Spiel
import "./styles/game.css";
import "./styles/player.css";
import "./styles/teacher.css";
import "./styles/direct.css";
import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { LightElement } from "./core/util.ts";
import "./views/teacher-home.ts";
import "./views/quiz-editor.ts";
import "./views/host-view.ts";
import "./views/player-view.ts";
import "./views/auth-views.ts";
import "./views/music-view.ts";

@customElement("podium-app")
export class PodiumApp extends LightElement {
	@state() private route = location.hash;

	override connectedCallback() {
		super.connectedCallback();
		window.addEventListener("hashchange", () => { this.route = location.hash; });
	}

	protected override render(): TemplateResult {
		const [path, query = ""] = this.route.replace(/^#\/?/, "").split("?");
		const parts = path.split("/").filter(Boolean);
		switch (parts[0]) {
			case "login": return html`<login-view .next=${new URLSearchParams(query).get("next") ?? "#/"}></login-view>`;
			case "invite": return html`<invite-view .token=${parts[1] ?? ""}></invite-view>`;
			case "account": return html`<account-view></account-view>`;
			case "users": return html`<users-view></users-view>`;
			case "host": return html`<host-view .pin=${parts[1] ?? ""} .hostKey=${parts[2] ?? ""}></host-view>`;
			case "preview": return html`<host-view .preview=${parts[1] ?? "studio"}></host-view>`;
			case "music": return html`<music-view></music-view>`;
			case "join": return html`<player-view .pin=${parts[1] ?? ""}></player-view>`;
			case "ask": return html`<player-view .pin=${parts[1] ?? ""} .anon=${true}></player-view>`;
			case "edit": return html`<quiz-editor .quizId=${parts[1] === "new" ? 0 : Number(parts[1] ?? 0)}></quiz-editor>`;
			default: return html`<teacher-home></teacher-home>`;
		}
	}
}
