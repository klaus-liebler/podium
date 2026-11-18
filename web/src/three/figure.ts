// Animierte 3D-Figur (Kenney Mini Characters, CC0) für einen Teilnehmenden.
// Übernimmt aus dem gestalteten Avatar: Figur, Hut/Extra, Sonnenbrille, Farbe (Namensschild), Hilfsmittel (Brille/Sonnenbrille).
import {
	AnimationMixer, Box3, BoxGeometry, CanvasTexture, ConeGeometry, CylinderGeometry, Group, LoopOnce, LoopRepeat, Mesh,
	MeshBasicMaterial, MeshStandardMaterial, Object3D, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, TorusGeometry, Vector3,
	type AnimationAction, type AnimationClip,
} from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { loadGltf, model, prepare } from "./assets.ts";
import { BODY_FILES, COLORS } from "../core/avatar.ts";
import type { AvatarSpec } from "../core/types.ts";

export const CHARACTER_FILES = BODY_FILES;

export type Anim = "idle" | "walk" | "sprint" | "jump" | "fall" | "sit" | "emote-yes" | "emote-no" | "interact-right" | "pick-up" | "crouch";

export class Figure {
	readonly root = new Group();
	readonly hit: Mesh;
	height = 0.75;
	private mixer!: AnimationMixer;
	private clips: AnimationClip[] = [];
	private actions = new Map<string, AnimationAction>();
	private current: AnimationAction | null = null;
	private currentName = "";
	private label: Sprite | null = null;
	private body: Object3D | null = null;
	private onceDone: (() => void) | null = null;
	private prop: Object3D | null = null;

	private constructor() {
		this.hit = new Mesh(new BoxGeometry(0.6, 1, 0.5), new MeshBasicMaterial({ visible: false }));
		this.hit.position.y = 0.45;
		this.root.add(this.hit);
	}

	static async create(spec: AvatarSpec, nick: string): Promise<Figure> {
		const f = new Figure();
		const file = CHARACTER_FILES[((spec.body ?? 0) % CHARACTER_FILES.length + CHARACTER_FILES.length) % CHARACTER_FILES.length];
		const g = await loadGltf(`characters/${file}.glb`);
		const body = prepare(SkeletonUtils.clone(g.scene));
		f.body = body;
		f.root.add(body);
		f.clips = g.animations;
		f.mixer = new AnimationMixer(body);
		f.mixer.addEventListener("finished", () => { const cb = f.onceDone; f.onceDone = null; cb?.(); });
		body.updateMatrixWorld(true);
		const box = new Box3().setFromObject(body);
		f.height = box.max.y;

		const head = body.getObjectByName("head");
		if (head) {
			// Kopf-Oberkante im Knochen-Koordinatensystem
			const topLocal = head.worldToLocal(new Vector3(0, box.max.y, 0));
			const hat = makeHat(spec.hat, spec.color);
			if (hat) { hat.position.copy(topLocal); hat.position.x = 0; hat.position.z = 0; hat.position.y -= 0.02; head.add(hat); f.prop = hat.getObjectByName("propeller") ?? null; }
			const glasses = spec.aid === 2 ? "aid-sunglasses" : spec.aid === 1 ? "aid-glasses" : null;
			if (glasses) {
				const gl = await model(`characters/${glasses}.glb`);
				gl.position.set(0, topLocal.y * 0.45, 0.17);
				head.add(gl);
			}
		}
		f.setName(nick, COLORS[spec.color % COLORS.length]);
		f.play("idle");
		return f;
	}

	setName(nick: string, color: string) {
		if (!nick) { if (this.label) this.label.visible = false; return; }
		const c = document.createElement("canvas"); c.width = 256; c.height = 64;
		const x = c.getContext("2d")!;
		x.font = "600 34px Fredoka, system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
		let name = nick; while (x.measureText(name).width > 220 && name.length > 2) name = name.slice(0, -2) + "…";
		const w = Math.min(250, x.measureText(name).width + 30);
		x.fillStyle = "rgba(15,10,40,.72)"; x.beginPath(); x.roundRect(128 - w / 2, 6, w, 52, 26); x.fill();
		x.fillStyle = color; x.beginPath(); x.arc(128 - w / 2 + 16, 32, 7, 0, Math.PI * 2); x.fill();
		x.fillStyle = "#fff"; x.fillText(name, 136, 33);
		const tex = new CanvasTexture(c); tex.colorSpace = SRGBColorSpace;
		if (!this.label) {
			this.label = new Sprite(new SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true }));
			this.label.renderOrder = 10;
			this.label.scale.set(0.9, 0.225, 1);
			this.root.add(this.label);
		} else { (this.label.material as SpriteMaterial).map?.dispose(); (this.label.material as SpriteMaterial).map = tex; }
		this.label.position.y = this.height + 0.32;
	}
	showLabel(v: boolean) { if (this.label) this.label.visible = v; }

	private action(name: string): AnimationAction | null {
		let a = this.actions.get(name);
		if (!a) {
			const clip = this.clips.find(c => c.name === name);
			if (!clip) return null;
			a = this.mixer.clipAction(clip);
			this.actions.set(name, a);
		}
		return a;
	}

	/** Animation abspielen. once: einmal, danach callback/idle. */
	play(anim: Anim, opts: { once?: boolean; fade?: number; speed?: number; then?: () => void; offset?: number } = {}) {
		const name = anim;
		if (name === this.currentName && !opts.once) return;
		const a = this.action(name); if (!a) return;
		a.reset();
		a.setLoop(opts.once ? LoopOnce : LoopRepeat, opts.once ? 1 : Infinity);
		a.clampWhenFinished = !!opts.once;
		a.timeScale = opts.speed ?? 1;
		if (opts.offset) a.time = opts.offset * a.getClip().duration;
		a.enabled = true;
		const fade = opts.fade ?? 0.25;
		if (this.current && this.current !== a) a.crossFadeFrom(this.current, fade, false);
		a.play();
		this.current = a; this.currentName = name;
		this.onceDone = opts.once ? (opts.then ?? (() => this.play("idle"))) : null;
	}
	get anim() { return this.currentName; }

	/** Eingefroren (ruhige Welt): neutrale Pose, keine Animation, kein Propeller */
	still = false;
	/** In neutraler Grundpose (Anfang der Leerlauf-Animation) einfrieren – ohne Überblendung, damit keine Zwischenpose hängen bleibt */
	hold() {
		this.still = true;
		const a = this.action("idle"); if (!a || !this.mixer) return;
		this.mixer.stopAllAction();
		a.reset(); a.setLoop(LoopRepeat, Infinity); a.enabled = true; a.setEffectiveWeight(1); a.time = 0; a.play();
		this.current = a; this.currentName = "idle"; this.onceDone = null;
		this.mixer.update(0);
	}
	update(dt: number) {
		if (this.still) return;
		this.mixer?.update(dt); if (this.prop) this.prop.rotation.y += dt * 14;
	}

	dispose() {
		this.root.removeFromParent();
		this.mixer?.stopAllAction();
		(this.label?.material as SpriteMaterial | undefined)?.map?.dispose();
	}
}

// ---------------------------------------------------------------- Hüte als kleine 3D-Modelle (passend zu den 2D-Avatar-Extras)
const mat = (color: number, emissive = 0) => new MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1, emissive: emissive ? color : 0, emissiveIntensity: emissive });

function makeHat(hat: number, colorIdx: number): Object3D | null {
	const g = new Group();
	switch (hat) {
		case 1: { // Partyhut
			const c = new Mesh(new ConeGeometry(0.12, 0.3, 16), mat(0x7950f2)); c.position.y = 0.15; g.add(c);
			const p = new Mesh(new SphereGeometry(0.04, 10, 8), mat(0xff6b6b)); p.position.y = 0.31; g.add(p);
			const s = new Mesh(new TorusGeometry(0.085, 0.015, 6, 20), mat(0xffd43b)); s.rotation.x = Math.PI / 2; s.position.y = 0.09; g.add(s);
			break;
		}
		case 2: { // Krone
			const ring = new Mesh(new CylinderGeometry(0.15, 0.15, 0.09, 16, 1, true), mat(0xffd43b, 0.25)); ring.position.y = 0.045;
			(ring.material as MeshStandardMaterial).metalness = 0.8; (ring.material as MeshStandardMaterial).side = 2; g.add(ring);
			for (let i = 0; i < 5; i++) {
				const sp = new Mesh(new ConeGeometry(0.035, 0.09, 6), mat(0xffd43b, 0.25)); const a = i / 5 * Math.PI * 2;
				sp.position.set(Math.cos(a) * 0.14, 0.13, Math.sin(a) * 0.14); g.add(sp);
			}
			const gem = new Mesh(new SphereGeometry(0.025, 8, 6), mat(0xff3b6b, 0.5)); gem.position.set(0, 0.05, 0.15); g.add(gem);
			break;
		}
		case 3: { // Mütze
			const b = new Mesh(new SphereGeometry(0.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xff922b)); b.scale.y = 0.7; g.add(b);
			const band = new Mesh(new CylinderGeometry(0.205, 0.205, 0.06, 18), mat(0xe8590c)); band.position.y = 0.02; g.add(band);
			const p = new Mesh(new SphereGeometry(0.05, 10, 8), mat(0xffffff)); p.position.y = 0.16; g.add(p);
			break;
		}
		case 4: { // Kopfhörer
			const arc = new Mesh(new TorusGeometry(0.2, 0.025, 8, 24, Math.PI), mat(0x2b1d3a)); arc.position.y = -0.12; g.add(arc);
			for (const s of [-1, 1]) { const cup = new Mesh(new CylinderGeometry(0.07, 0.07, 0.06, 14), mat(0xff3b6b)); cup.rotation.z = Math.PI / 2; cup.position.set(s * 0.2, -0.13, 0); g.add(cup); }
			break;
		}
		case 5: { // Propellermütze
			const cap = new Mesh(new SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x4dabf7)); cap.scale.y = 0.6; g.add(cap);
			const stick = new Mesh(new CylinderGeometry(0.01, 0.01, 0.1, 6), mat(0x2b1d3a)); stick.position.y = 0.14; g.add(stick);
			const prop = new Group(); prop.position.y = 0.19; prop.name = "propeller";
			for (const s of [-1, 1]) { const bl = new Mesh(new BoxGeometry(0.16, 0.01, 0.05), mat(s > 0 ? 0xffd43b : 0x69db7c)); bl.position.x = s * 0.08; prop.add(bl); }
			g.add(prop);
			break;
		}
		case 6: { // Blume
			const fl = new Group(); fl.position.set(0.12, 0.02, 0.05);
			for (let i = 0; i < 5; i++) { const pe = new Mesh(new SphereGeometry(0.04, 8, 6), mat(0xf783ac)); const a = i / 5 * Math.PI * 2; pe.position.set(Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0); fl.add(pe); }
			const c = new Mesh(new SphereGeometry(0.03, 8, 6), mat(0xffd43b)); fl.add(c);
			g.add(fl);
			break;
		}
		case 7: { // Hörner
			for (const s of [-1, 1]) { const h = new Mesh(new ConeGeometry(0.04, 0.16, 8), mat(0xf1f3f5)); h.position.set(s * 0.1, 0.06, 0); h.rotation.z = -s * 0.4; g.add(h); }
			break;
		}
		default: return null;
	}
	void colorIdx;
	return g;
}

