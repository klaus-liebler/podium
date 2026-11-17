// Gemeinsame 3D-Welt der Leinwand mit umschaltbaren Themes (Studio, Campus, Weltraum, Stadion, Apfelwiese).
// Teilnehmende sind animierte 3D-Figuren (Kenney Mini Characters, CC0):
//   Lobby: fallen vom Himmel, laufen herum, winken · Quiz: stehen als Publikum, springen beim Antworten, nicken/schütteln beim Auflösen
//   Siegerehrung: Podest wächst aus dem Boden, Sieger springen auf ihre Plätze und jubeln, das Publikum feiert.
import {
	ACESFilmicToneMapping, Box3, CanvasTexture, Clock, Color, DoubleSide, DynamicDrawUsage, Euler, Group, InstancedMesh, Mesh,
	MeshBasicMaterial, MeshStandardMaterial, Object3D, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, Raycaster, Scene,
	SRGBColorSpace, Vector2, Vector3, WebGLRenderer, type Material,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Figure } from "./figure.ts";
import { Fireworks, type Cam, type ThemeDef, type ThemeId, type ThemeRuntime } from "./themes/common.ts";
import { studio } from "./themes/studio.ts";
import { campus } from "./themes/campus.ts";
import { space } from "./themes/space.ts";
import { stadium } from "./themes/stadium.ts";
import { nature, ringsTexture, stump } from "./themes/nature.ts";
import { osnabrueck } from "./themes/osnabrueck.ts";
import type { AvatarSpec, Phase } from "../core/types.ts";
import { store } from "../core/util.ts";

export type StageMode = Phase;
export type { ThemeId } from "./themes/common.ts";
export const THEMES: ThemeDef[] = [studio, campus, space, stadium, nature, osnabrueck];
export interface StagePlayer { id: string; nick: string; avatar: AvatarSpec; answered?: boolean; connected?: boolean; lastCorrect?: boolean; }
export interface XYZ { x: number; y: number; z: number; }

const MAX_FIGURES = 60;
const PLACE_X: Record<number, number> = { 1: 0, 2: -1.15, 3: 1.15 };
const PLACE_H: Record<number, number> = { 1: 1.0, 2: 0.72, 3: 0.48 };
const easeBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

type State = "loading" | "drop" | "idle" | "walk" | "seated" | "cheer" | "fly" | "victory";
interface Obstacle { x: number; z: number; r: number; }
interface Entry {
	id: string; key: string; idx: number; nick: string; avatar: AvatarSpec;
	fig: Figure | null; pos: Vector3; ry: number; vy: number;
	state: State; target: Vector3 | null; targetRy: number; wait: number;
	answered: boolean; lastCorrect: boolean; connected: boolean;
	place: number; flyT: number; flyFrom: Vector3; victoryT: number; seed: number;
}
interface Column { obj: Object3D; h: number; x: number; t0: number; up: boolean; }
interface Conf { p: Vector3; v: Vector3; r: Euler; w: Vector3; life: number; }

export class Stage {
	onPlayerClick: ((id: string) => void) | null = null;
	theme: ThemeDef = THEMES.find(t => t.id === store.get<ThemeId>("podium-theme", "studio")) ?? studio;
	private runtime: ThemeRuntime | null = null;
	private building: Promise<void> | null = null;
	private mode: StageMode = "lobby";
	private tension = 0; private pulseAmt = 0; private warpAmt = 0;
	private clock = new Clock();
	private renderer: WebGLRenderer; private scene = new Scene(); private camera: PerspectiveCamera;
	private composer: EffectComposer; private bloom: UnrealBloomPass;
	private camPos = new Vector3(0, 3, 10); private camLook = new Vector3(0, 1, 0); private camFov = 45;
	private fireworks = new Fireworks();
	private players = new Map<string, Entry>();
	private podiumGroup = new Group();
	private columns: Record<number, Column> = {};
	private podiumIds: Record<number, string> = {};
	private conf!: InstancedMesh; private confData: Conf[] = []; private confN = 1400; private confNext = 0;
	private dummy = new Object3D();
	private raycaster = new Raycaster();
	private hopFactor = 1;
	/** Hindernisse der aktuellen Welt (Kreise in der Bodenebene), automatisch aus den Modellen ermittelt */
	private obstacles: Obstacle[] = [];
	private static readonly BODY_R = 0.28; // Radius einer Figur

	constructor(private canvas: HTMLCanvasElement) {
		const r = this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
		r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
		r.toneMapping = ACESFilmicToneMapping;
		r.shadowMap.enabled = true; r.shadowMap.type = PCFSoftShadowMap;
		this.camera = new PerspectiveCamera(45, 1, 0.1, 400);
		this.scene.add(this.podiumGroup);
		this.buildConfetti();

		this.composer = new EffectComposer(r);
		this.composer.addPass(new RenderPass(this.scene, this.camera));
		this.bloom = new UnrealBloomPass(new Vector2(512, 512), 0.5, 0.5, 0.85);
		this.composer.addPass(this.bloom);
		this.composer.addPass(new OutputPass());

		canvas.addEventListener("click", e => this.handleClick(e));
		this.resize();
		window.addEventListener("resize", () => this.resize());
		void this.setTheme(this.theme.id, true);
		r.setAnimationLoop(() => this.frame());
	}

	private resize() {
		const w = window.innerWidth, h = window.innerHeight;
		this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
		this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
	}

	// ------------------------------------------------------------ Themes
	async setTheme(id: ThemeId, initial = false) {
		const def = THEMES.find(t => t.id === id) ?? studio;
		if (!initial && def === this.theme && this.runtime) return;
		await this.building;
		this.theme = def; store.set("podium-theme", id);
		this.building = (async () => {
			this.runtime?.dispose(); this.runtime = null;
			this.fireworks.points.removeFromParent();
			const rt = await def.build({ scene: this.scene, renderer: this.renderer, fireworks: this.fireworks, burst: (o, c, p) => this.burst(c, o, p) });
			if (this.theme !== def) { rt.dispose(); return; }
			this.runtime = rt;
			this.renderer.toneMappingExposure = def.exposure;
			this.hopFactor = def.hop ?? 1;
			this.buildPodium();
			this.obstacles = this.findObstacles(rt.group);
			this.layout(true);
			this.snapCamera();
		})();
		await this.building;
	}

	private buildPodium() {
		this.podiumGroup.clear(); this.columns = {};
		const th = this.theme;
		this.podiumGroup.position.set(th.podium.x, 0, th.podium.z);
		const rings = th.id === "nature" ? ringsTexture() : null;
		for (const place of [1, 2, 3]) {
			const h = PLACE_H[place];
			let obj: Object3D;
			if (rings) obj = stump(h + 0.1, 0.48 - place * 0.02, rings);
			else {
				const geo = new RoundedBoxGeometry(1.05, h, 0.95, 4, 0.07); geo.translate(0, h / 2, 0);
				const m = new Mesh(geo, new MeshStandardMaterial({ color: th.podium.colors[place - 1], metalness: th.podium.metal, roughness: 0.28 }));
				m.castShadow = true; m.receiveShadow = true;
				const c = document.createElement("canvas"); c.width = c.height = 128;
				const x = c.getContext("2d")!; x.font = "700 100px Fredoka, system-ui"; x.textAlign = "center"; x.textBaseline = "middle";
				x.fillStyle = th.id === "stadium" ? "#c0392b" : "rgba(255,255,255,.95)"; x.fillText(String(place), 64, 70);
				const tex = new CanvasTexture(c); tex.colorSpace = SRGBColorSpace;
				const label = new Mesh(new PlaneGeometry(0.5, 0.5), new MeshBasicMaterial({ map: tex, transparent: true, side: DoubleSide }));
				label.position.set(0, Math.max(0.28, h * 0.55), 0.48); m.add(label);
				obj = m;
			}
			obj.position.x = PLACE_X[place]; obj.scale.y = 0.001; obj.visible = false;
			this.podiumGroup.add(obj);
			this.columns[place] = { obj, h: rings ? h + 0.1 : h, x: PLACE_X[place], t0: 0, up: false };
		}
	}
	private podiumTop(place: number) {
		const c = this.columns[place];
		return new Vector3(this.theme.podium.x + c.x, c.h * c.obj.scale.y, this.theme.podium.z);
	}

	// ------------------------------------------------------------ Konfetti
	private buildConfetti() {
		const im = this.conf = new InstancedMesh(new PlaneGeometry(0.07, 0.11), new MeshStandardMaterial({ side: DoubleSide, roughness: 0.5, metalness: 0.2 }), this.confN);
		im.instanceMatrix.setUsage(DynamicDrawUsage); im.frustumCulled = false;
		const cols = [0x8a5cf6, 0x13b5a5, 0xf2a516, 0xef476f, 0x3a86ff, 0x7cb518, 0xf783ac, 0xffd84d];
		const col = new Color();
		this.dummy.position.set(0, -999, 0); this.dummy.updateMatrix();
		for (let i = 0; i < this.confN; i++) {
			this.confData.push({ p: new Vector3(0, -999, 0), v: new Vector3(), r: new Euler(), w: new Vector3(), life: 0 });
			im.setColorAt(i, col.setHex(cols[i % cols.length])); im.setMatrixAt(i, this.dummy.matrix);
		}
		this.scene.add(im);
	}

	/** Konfetti-Explosion. Ohne Ursprung: über dem Podest (Siegerehrung) bzw. mitten im Bild. */
	burst(count = 200, o?: XYZ, power = 1) {
		const origin = o ? new Vector3(o.x, o.y, o.z) : this.mode === "podium"
			? new Vector3(this.theme.podium.x, 2.4, this.theme.podium.z)
			: this.camLook.clone().add(new Vector3(0, 1.4, 0));
		for (let k = 0; k < count; k++) {
			const d = this.confData[this.confNext = (this.confNext + 1) % this.confN];
			d.p.copy(origin).add(new Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.4));
			const a = Math.random() * Math.PI * 2, up = 0.6 + Math.random() * 0.8;
			d.v.set(Math.cos(a) * (1.5 + Math.random() * 3), up * (4 + Math.random() * 4), Math.sin(a) * (1 + Math.random() * 2.5)).multiplyScalar(power);
			d.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
			d.w.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
			d.life = 5 + Math.random() * 3;
		}
		this.pulse(power);
	}
	rain(count = 400) {
		const c = new Vector3(this.theme.podium.x, 0, this.theme.podium.z);
		for (let k = 0; k < count; k++) {
			const d = this.confData[this.confNext = (this.confNext + 1) % this.confN];
			d.p.set(c.x + (Math.random() - 0.5) * 10, 5 + Math.random() * 5, c.z + (Math.random() - 0.5) * 5);
			d.v.set((Math.random() - 0.5) * 0.6, -0.8 - Math.random(), (Math.random() - 0.5) * 0.6);
			d.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
			d.w.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
			d.life = 10;
		}
	}
	warp(amount = 1) { this.warpAmt = Math.min(1.5, this.warpAmt + amount); }
	pulse(strength = 1) { this.pulseAmt = Math.min(1.5, this.pulseAmt + 0.5 * strength); }

	// ------------------------------------------------------------ Figuren
	setPlayers(list: StagePlayer[]) {
		const seen = new Set<string>();
		list.slice(0, MAX_FIGURES).forEach((p, i) => {
			seen.add(p.id);
			const key = p.nick + JSON.stringify(p.avatar);
			let e = this.players.get(p.id);
			if (!e) {
				const start = this.mode === "lobby" ? this.randomLobbySpot() : this.seatPos(i).pos;
				e = {
					id: p.id, key: "", idx: i, nick: p.nick, avatar: p.avatar, fig: null, pos: start, ry: 0, vy: 0,
					state: "loading", target: null, targetRy: 0, wait: 0, answered: false, lastCorrect: false, connected: true,
					place: 0, flyT: 0, flyFrom: new Vector3(), victoryT: 0, seed: Math.random() * 10,
				};
				this.players.set(p.id, e);
			}
			e.idx = i; e.nick = p.nick; e.avatar = p.avatar; e.connected = p.connected !== false;
			if (key !== e.key) { e.key = key; void this.loadFigure(e); }
			if (p.answered && !e.answered && e.fig && this.mode !== "lobby") this.hop(e);
			e.answered = !!p.answered;
			e.lastCorrect = !!p.lastCorrect;
		});
		for (const [id, e] of this.players) if (!seen.has(id)) { e.fig?.dispose(); this.players.delete(id); }
		this.layout(false);
	}

	private async loadFigure(e: Entry) {
		const key = e.key;
		const fig = await Figure.create(e.avatar, e.nick);
		if (e.key !== key || !this.players.has(e.id)) { fig.dispose(); return; }
		const old = e.fig;
		e.fig = fig;
		fig.root.position.copy(e.pos); fig.root.rotation.y = e.ry;
		fig.hit.userData.id = e.id;
		this.scene.add(fig.root);
		if (old) { old.dispose(); return; }
		if (this.mode === "lobby") { e.state = "drop"; e.pos.y = 4 + Math.random() * 2; e.vy = 0; fig.play("fall"); }
		else { e.state = "idle"; this.layout(false); }
	}

	private hop(e: Entry) { e.fig?.play("jump", { once: true, then: () => e.fig?.play("idle") }); e.vy = 2.2 * Math.sqrt(this.hopFactor); }

	/** Stehende Modelle der Welt als Hindernis-Kreise erfassen (Boden, Himmel, Schwebendes und Flaches ausgenommen) */
	private findObstacles(group: Group): Obstacle[] {
		const out: Obstacle[] = [];
		const box = new Box3(), size = new Vector3(), c = new Vector3();
		group.updateMatrixWorld(true);
		for (const o of group.children) {
			if (!(o instanceof Group || o instanceof Mesh) || !o.visible) continue;
			box.setFromObject(o);
			if (box.isEmpty()) continue;
			box.getSize(size); box.getCenter(c);
			const r = Math.max(size.x, size.z) / 2;
			if (size.y < 0.32 || box.min.y > 0.6 || r > 6 || r < 0.05) continue; // flach, schwebend, Boden/Himmel, winzig
			out.push({ x: c.x, z: c.z, r: r * 0.85 });
		}
		return out;
	}
	private blocked(x: number, z: number, margin = 0.15) {
		return this.obstacles.some(o => (x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + Stage.BODY_R + margin) ** 2);
	}

	private randomLobbySpot() {
		const a = this.theme.lobbyArea;
		for (let k = 0; k < 30; k++) {
			const p = new Vector3(a.x0 + Math.random() * (a.x1 - a.x0), 0, a.z0 + Math.random() * (a.z1 - a.z0));
			const crowded = [...this.players.values()].some(e => e.target && e.state === "walk" && e.target.distanceToSquared(p) < 0.5);
			if (!this.blocked(p.x, p.z, 0.3) && !crowded) return p;
		}
		return this.randomLobbySpotRaw();
	}
	private randomLobbySpotRaw() {
		const a = this.theme.lobbyArea;
		return new Vector3(a.x0 + Math.random() * (a.x1 - a.x0), 0, a.z0 + Math.random() * (a.z1 - a.z0));
	}
	private seatPos(i: number) { const s = this.theme.seat(i, this.players.size); return { pos: new Vector3(s.x, 0, s.z), ry: s.ry }; }

	/** Platzierung für die Siegerehrung: {1: id, 2: id, 3: id} */
	setPodium(map: Record<number, string>) {
		this.podiumIds = map;
		for (const e of this.players.values()) e.place = 0;
		for (const [pl, id] of Object.entries(map)) { const e = this.players.get(id); if (e) e.place = Number(pl); }
		this.layout(false);
	}

	/** Säule wachsen lassen; der Sieger springt hinauf. */
	raise(place: number) {
		const c = this.columns[place]; if (!c) return;
		c.obj.visible = true; c.up = true; c.t0 = this.clock.elapsedTime;
		const id = this.podiumIds[place], e = id ? this.players.get(id) : undefined;
		if (e) { e.state = "fly"; e.flyT = this.clock.elapsedTime + 0.9; e.flyFrom = e.pos.clone(); e.fig?.play("idle"); }
		if (place === 1) this.runtime?.celebrate();
	}

	/** Zielpositionen je Modus berechnen */
	private layout(teleport: boolean) {
		const list = [...this.players.values()].sort((a, b) => a.idx - b.idx);
		if (this.mode === "lobby") {
			for (const e of list) {
				if (teleport) { e.pos.copy(this.randomLobbySpot()); e.state = e.fig ? "idle" : e.state; e.wait = Math.random() * 2; }
				if (e.state === "seated" || e.state === "cheer" || e.state === "victory") { e.state = "idle"; e.wait = Math.random() * 1.5; e.fig?.play("idle"); }
			}
		} else if (this.mode === "podium") {
			let k = 0;
			for (const e of list) {
				if (e.place) {
					if (e.state === "fly" || e.state === "victory") continue;
					const front = new Vector3(this.theme.podium.x + PLACE_X[e.place], 0, this.theme.podium.z + 1.25);
					this.goTo(e, front, 0, teleport);
				} else {
					const s = this.theme.crowd(k++, list.length);
					this.goTo(e, new Vector3(this.theme.podium.x + s.x, 0, this.theme.podium.z + s.z), s.ry, teleport, "cheer");
				}
			}
		} else {
			list.forEach((e, i) => { const s = this.seatPos(i); this.goTo(e, s.pos, s.ry, teleport); });
		}
	}
	private goTo(e: Entry, p: Vector3, ry: number, teleport: boolean, arrive: State = "seated") {
		e.target = p; e.targetRy = ry;
		if (teleport || !e.fig) { e.pos.copy(p); e.ry = ry; e.state = e.fig ? arrive : e.state; if (e.fig) this.arrive(e, arrive); return; }
		if (e.state !== "drop") e.state = "walk";
		(e as Entry & { arriveAs?: State }).arriveAs = arrive;
	}
	private arrive(e: Entry, as: State) {
		e.state = as; e.ry = e.targetRy;
		if (as === "cheer") e.fig?.play("jump", { speed: 0.8 + Math.random() * 0.4, offset: Math.random() });
		else e.fig?.play("idle");
	}

	// ------------------------------------------------------------ Steuerung
	setMode(mode: StageMode) {
		if (mode === this.mode) return;
		const prev = this.mode;
		this.mode = mode;
		if (mode !== "answering") this.tension = 0;
		if (mode === "podium") { for (const c of Object.values(this.columns)) { c.up = false; c.obj.scale.y = 0.001; c.obj.visible = false; } }
		if (prev === "podium") for (const e of this.players.values()) if (e.state === "victory" || e.state === "fly") e.state = "idle";
		if (prev === "podium") for (const c of Object.values(this.columns)) { c.up = false; c.obj.visible = false; c.obj.scale.y = 0.001; }
		this.layout(false);
		for (const e of this.players.values()) e.fig?.showLabel(mode === "lobby" || mode === "podium");
		// Reaktionen beim Auflösen: richtig -> nicken/jubeln, falsch -> Kopfschütteln
		if (mode === "reveal") for (const e of this.players.values()) {
			if (!e.answered || !e.fig) continue;
			setTimeout(() => e.fig?.play(e.lastCorrect ? "emote-yes" : "emote-no", { once: true, then: () => e.fig?.play("idle") }), 600 + Math.random() * 500);
		}
		if (prev === "lobby" || mode === "podium") this.warp(0.6);
	}
	setTension(x: number) { this.tension = x; }

	private handleClick(ev: MouseEvent) {
		if (!this.onPlayerClick || this.mode !== "lobby") return;
		const rect = this.canvas.getBoundingClientRect();
		this.raycaster.setFromCamera(new Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
		const hits = this.raycaster.intersectObjects([...this.players.values()].filter(e => e.fig).map(e => e.fig!.hit));
		const id = hits[0]?.object.userData.id as string | undefined;
		if (id) this.onPlayerClick(id);
	}

	/** Bildschirmposition über dem Kopf einer Figur (für HTML-Overlays) */
	screenPos(id: string): { x: number; y: number } | null {
		const e = this.players.get(id); if (!e?.fig) return null;
		const v = e.fig.root.position.clone(); v.y += e.fig.height + 0.5;
		v.project(this.camera);
		return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
	}

	private camFor(): Cam {
		const c = this.theme.cams;
		return this.mode === "lobby" ? c.lobby : this.mode === "podium" ? c.podium : (c[this.mode] ?? c.game);
	}
	private snapCamera() { const c = this.camFor(); this.camPos.set(...c.pos); this.camLook.set(...c.look); this.camFov = c.fov; }

	// ------------------------------------------------------------ Animation
	private frame() {
		const dt = Math.min(0.05, this.clock.getDelta()), t = this.clock.elapsedTime;
		this.pulseAmt *= Math.pow(0.05, dt);
		this.warpAmt *= Math.pow(0.1, dt);
		this.runtime?.update(dt, { mode: this.mode, tension: this.tension, pulse: this.pulseAmt, t });
		this.fireworks.update(dt);
		this.updatePlayers(dt, t);
		this.updateConfetti(dt, t);

		for (const c of Object.values(this.columns)) if (c.up) c.obj.scale.y = Math.max(0.001, easeBack(Math.min(1, (t - c.t0) / 1.2)));

		// Kamera weich nachführen, sanftes Schweben; in der Antwortzeit leichtes Heranfahren
		const cam = this.camFor();
		const push = this.mode === "answering" ? this.tension * 0.8 : 0;
		const target = new Vector3(...cam.pos), look = new Vector3(...cam.look);
		target.add(look.clone().sub(target).normalize().multiplyScalar(push));
		target.x += Math.sin(t * 0.13) * 0.25; target.y += Math.sin(t * 0.17) * 0.08;
		const k = 1 - Math.pow(0.15, dt);
		this.camPos.lerp(target, k); this.camLook.lerp(look, k);
		this.camFov += (cam.fov + this.warpAmt * 8 - this.camFov) * k;
		this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
		if (Math.abs(this.camera.fov - this.camFov) > 0.01) { this.camera.fov = this.camFov; this.camera.updateProjectionMatrix(); }

		this.bloom.strength = this.theme.bloom * (this.mode === "podium" ? 0.55 : 1) + this.pulseAmt * 0.2 + this.warpAmt * 0.2;
		this.bloom.threshold = this.mode === "podium" ? 0.92 : 0.85;
		this.composer.render(dt);
	}

	private updatePlayers(dt: number, t: number) {
		const camXZ = new Vector3(this.camera.position.x, 0, this.camera.position.z);
		const list = [...this.players.values()].filter(e => e.fig);
		for (const e of list) {
			const fig = e.fig!;
			switch (e.state) {
				case "drop": {
					e.vy -= 9.8 * dt / this.hopFactor; e.pos.y += e.vy * dt;
					if (e.pos.y <= 0) { e.pos.y = 0; e.vy = 0; e.state = "idle"; e.wait = 0.8 + Math.random() * 2; fig.play("jump", { once: true, then: () => fig.play(Math.random() < 0.4 ? "emote-yes" : "idle", { once: false }) }); }
					break;
				}
				case "idle":
					if (this.mode === "lobby") {
						e.wait -= dt;
						if (e.wait <= 0) { e.target = this.randomLobbySpot(); e.state = "walk"; (e as Entry & { arriveAs?: State }).arriveAs = "idle"; }
					}
					break;
				case "walk": {
					if (!e.target) { e.state = "idle"; break; }
					const d = new Vector3(e.target.x - e.pos.x, 0, e.target.z - e.pos.z), dist = d.length();
					if (dist < 0.06 || (this.mode === "lobby" && dist < 0.35 && this.blocked(e.target.x, e.target.z, 0))) {
						(e as Entry & { best?: number }).best = undefined;
						const as = (e as Entry & { arriveAs?: State }).arriveAs ?? "idle";
						if (this.mode === "lobby") { e.state = "idle"; e.wait = 1.5 + Math.random() * 4; fig.play(Math.random() < 0.25 ? "emote-yes" : "idle"); }
						else this.arrive(e, as);
						break;
					}
					const fast = dist > 2.5 && this.mode !== "lobby";
					fig.play(fast ? "sprint" : "walk");
					const sp = (fast ? 2.6 : 0.9);
					const dir = this.steer(e, d.normalize(), list);
					e.pos.addScaledVector(dir, Math.min(dist, sp * dt));
					const want = Math.atan2(dir.x, dir.z);
					e.ry += angleDiff(want, e.ry) * Math.min(1, dt * 8);
					// Feststecken erkennen: kein Fortschritt -> neues Ziel (Lobby) bzw. weiter versuchen
					const ex = e as Entry & { best?: number; stuck?: number };
					if (ex.best === undefined || dist < ex.best - 0.05) { ex.best = dist; ex.stuck = 0; }
					else if ((ex.stuck = (ex.stuck ?? 0) + dt) > 1.6) {
						ex.best = undefined; ex.stuck = 0;
						if (this.mode === "lobby") e.target = this.randomLobbySpot();
					}
					break;
				}
				case "seated": case "cheer": {
					// Blick zur Kamera (Publikum) bzw. vorgegebene Richtung
					const toCam = Math.atan2(camXZ.x - e.pos.x, camXZ.z - e.pos.z);
					e.ry += angleDiff(this.mode === "podium" ? toCam : e.targetRy, e.ry) * Math.min(1, dt * 4);
					break;
				}
				case "fly": {
					const top = this.podiumTop(e.place);
					if (t < e.flyT) { fig.play("crouch"); break; }
					const k = Math.min(1, (t - e.flyT) / 0.9);
					fig.play("jump");
					e.pos.copy(e.flyFrom).lerp(top, k); e.pos.y += Math.sin(k * Math.PI) * 1.6;
					if (k >= 1) { e.state = "victory"; e.victoryT = 0; e.pos.copy(top); }
					break;
				}
				case "victory": {
					e.pos.y = this.podiumTop(e.place).y;
					e.ry += angleDiff(Math.atan2(camXZ.x - e.pos.x, camXZ.z - e.pos.z), e.ry) * Math.min(1, dt * 5);
					e.victoryT -= dt;
					if (e.victoryT <= 0) { e.victoryT = 1.3; fig.play(Math.random() < 0.5 ? "emote-yes" : "jump", { fade: 0.15 }); }
					break;
				}
			}
			// Sprung-Physik (Antwort-Hüpfer), Mond: höher und langsamer
			if (e.state !== "drop" && e.state !== "fly" && e.state !== "victory" && (e.vy !== 0 || e.pos.y > 0)) {
				e.vy -= 9.8 * dt / this.hopFactor; e.pos.y = Math.max(0, e.pos.y + e.vy * dt); if (e.pos.y === 0) e.vy = 0;
			}
			fig.root.position.copy(e.pos);
			fig.root.rotation.y = e.ry;
			fig.update(dt);
		}
		// Kollisionen auflösen: Figuren untereinander (nur wer auf dem Boden steht/läuft) und gegen Hindernisse
		const ground = list.filter(e => e.state !== "fly" && e.state !== "victory" && e.state !== "drop");
		const min = Stage.BODY_R * 2;
		for (let i = 0; i < ground.length; i++) for (let j = i + 1; j < ground.length; j++) {
			const A = ground[i], B = ground[j], a = A.pos, b = B.pos, dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
			if (d2 >= min * min) continue;
			const d = Math.sqrt(d2) || 0.001, over = (min - d) / d;
			// Wer steht, gibt weniger nach als wer läuft
			const wa = A.state === "walk" ? 0.7 : 0.3, wb = B.state === "walk" ? 0.7 : 0.3, sum = wa + wb;
			a.x -= dx * over * wa / sum; a.z -= dz * over * wa / sum; b.x += dx * over * wb / sum; b.z += dz * over * wb / sum;
		}
		for (const e of ground) for (const o of this.obstacles) {
			const dx = e.pos.x - o.x, dz = e.pos.z - o.z, rr = o.r + Stage.BODY_R, d2 = dx * dx + dz * dz;
			if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.001; e.pos.x = o.x + dx / d * rr; e.pos.z = o.z + dz / d * rr; }
		}
		for (const e of ground) e.fig!.root.position.set(e.pos.x, e.pos.y, e.pos.z);
		void t;
	}

	/** Vorausschauendes Ausweichen: Richtung zum Ziel, seitlich abgelenkt von Hindernissen und entgegenkommenden Figuren */
	private steer(e: Entry, want: Vector3, list: Entry[]): Vector3 {
		const out = want.clone();
		const look = 0.9;
		const avoid = (cx: number, cz: number, r: number, w: number) => {
			const tx = cx - e.pos.x, tz = cz - e.pos.z;
			const ahead = tx * want.x + tz * want.z;               // Abstand entlang der Laufrichtung
			if (ahead <= 0 || ahead > look + r) return;
			const side = tx * want.z - tz * want.x;                // seitlicher Versatz (Vorzeichen = Seite)
			const clear = r + Stage.BODY_R + 0.08;
			if (Math.abs(side) > clear) return;
			const strength = w * (1 - ahead / (look + r)) * (1 - Math.abs(side) / clear) * 2.2;
			const s = side >= 0 ? -1 : 1;                           // zur freien Seite ausweichen
			out.x += want.z * s * strength; out.z += -want.x * s * strength;
		};
		for (const o of this.obstacles) avoid(o.x, o.z, o.r, 1.2);
		for (const o of list) if (o !== e && o.fig && o.state !== "fly" && o.state !== "victory") avoid(o.pos.x, o.pos.z, Stage.BODY_R, o.state === "walk" ? 0.6 : 0.9);
		return out.lengthSq() > 1e-6 ? out.normalize() : want;
	}

	private updateConfetti(dt: number, t: number) {
		let any = false;
		for (let i = 0; i < this.confN; i++) {
			const d = this.confData[i];
			if (d.life <= 0) {
				if (d.p.y > -900) { d.p.y = -999; this.dummy.position.copy(d.p); this.dummy.scale.setScalar(1); this.dummy.updateMatrix(); this.conf.setMatrixAt(i, this.dummy.matrix); any = true; }
				continue;
			}
			d.life -= dt;
			d.v.y -= 5.5 * dt; d.v.multiplyScalar(Math.pow(0.3, dt));
			d.v.x += Math.sin(t * 3 + i) * dt * 0.8;
			d.p.addScaledVector(d.v, dt);
			if (d.p.y < 0.01) { d.p.y = 0.01; d.v.set(0, 0, 0); d.w.multiplyScalar(0.9); }
			d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
			this.dummy.position.copy(d.p); this.dummy.rotation.copy(d.r); this.dummy.scale.setScalar(Math.min(1, d.life));
			this.dummy.updateMatrix(); this.conf.setMatrixAt(i, this.dummy.matrix);
			any = true;
		}
		if (any) this.conf.instanceMatrix.needsUpdate = true;
	}
}

function angleDiff(a: number, b: number) { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

export function createStage(canvas: HTMLCanvasElement): Stage | null {
	try { return new Stage(canvas); }
	catch (e) { console.warn("3D nicht verfügbar", e); return null; }
}

export type { Material };
