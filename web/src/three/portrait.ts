// Porträts der 3D-Figuren: Standbilder (für Listen, Kopfzeilen, Bestenlisten) und eine animierte Live-Vorschau (Handy-Editor).
// Ohne WebGL fällt alles auf die Kenney-Vorschaubilder zurück.
import { Box3, Clock, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { html } from "lit";
import { until } from "lit/directives/until.js";
import { Figure } from "./figure.ts";
import { bodyPreview, norm } from "../core/avatar.ts";
import type { AvatarSpec } from "../core/types.ts";

function makeScene() {
	const scene = new Scene();
	scene.add(new HemisphereLight(0xffffff, 0x8a7cc8, 1.6));
	const key = new DirectionalLight(0xffffff, 2.0); key.position.set(1.5, 2.5, 3); scene.add(key);
	const rim = new DirectionalLight(0xffd8a8, 1.0); rim.position.set(-2, 1.5, -2); scene.add(rim);
	return scene;
}
function frame(cam: PerspectiveCamera, fig: Figure, tight = true) {
	fig.root.updateMatrixWorld(true);
	const b = new Box3().setFromObject(fig.root), c = b.getCenter(new Vector3()), s = b.getSize(new Vector3());
	const h = Math.max(s.y, s.x * 0.9) * (tight ? 1.12 : 1.3);
	const d = h / 2 / Math.tan((cam.fov * Math.PI) / 360);
	cam.position.set(c.x + d * 0.18, c.y + h * 0.08, c.z + d);
	cam.lookAt(c.x, c.y, c.z);
}

// ---------------------------------------------------------------- Standbilder
let renderer: WebGLRenderer | null | false = null;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Promise<string>>();
const key = (a: AvatarSpec) => [a.body, a.hat, a.aid].join("-");

function getRenderer(): WebGLRenderer | null {
	if (renderer === false) return null;
	if (!renderer) {
		try {
			const r = new WebGLRenderer({ canvas: document.createElement("canvas"), alpha: true, antialias: true, preserveDrawingBuffer: true });
			r.setPixelRatio(1); r.setSize(256, 256, false); r.setClearColor(0x000000, 0);
			renderer = r;
		} catch { renderer = false; return null; }
	}
	return renderer;
}

/** PNG-Data-URL eines Porträts (zwischengespeichert pro Aussehen) */
export function portrait(spec: AvatarSpec | null | undefined): Promise<string> {
	const a = norm(spec);
	const k = key(a);
	let p = cache.get(k);
	if (!p) {
		p = queue = queue.then(async () => {
			const r = getRenderer();
			if (!r) return bodyPreview(a.body);
			const fig = await Figure.create(a, "");
			const scene = makeScene(); scene.add(fig.root);
			fig.root.rotation.y = -0.35;
			fig.play("idle"); fig.update(0.4);
			const cam = new PerspectiveCamera(30, 1, 0.05, 50);
			frame(cam, fig);
			r.render(scene, cam);
			const url = r.domElement.toDataURL("image/png");
			fig.dispose();
			return url;
		}).catch(() => bodyPreview(a.body)) as Promise<string>;
		cache.set(k, p);
	}
	return p;
}

const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
/** Lit-Baustein: Porträt als <img> (lädt asynchron nach) */
export const figureImg = (spec: AvatarSpec | null | undefined, alt = "") =>
	html`<img class="portrait" alt=${alt} src=${until(portrait(spec), BLANK)}>`;

// ---------------------------------------------------------------- Live-Vorschau (Editor auf dem Handy)
export class LivePreview {
	private r: WebGLRenderer | null = null;
	private scene = makeScene();
	private cam = new PerspectiveCamera(30, 1, 0.05, 50);
	private fig: Figure | null = null;
	private clock = new Clock();
	private raf = 0;
	private loading = 0;
	private t = 0;
	ok = true;

	constructor(private canvas: HTMLCanvasElement) {
		try {
			this.r = new WebGLRenderer({ canvas, alpha: true, antialias: true });
			this.r.setPixelRatio(Math.min(2, devicePixelRatio)); this.r.setClearColor(0x000000, 0);
		} catch { this.ok = false; }
	}

	async setSpec(spec: AvatarSpec) {
		if (!this.r) return;
		const n = ++this.loading;
		const fig = await Figure.create(norm(spec), "");
		if (n !== this.loading) { fig.dispose(); return; }
		this.fig?.dispose();
		this.fig = fig; this.scene.add(fig.root);
		fig.play("emote-yes", { once: true, then: () => fig.play("idle") });
		frame(this.cam, fig, false);
		if (!this.raf) this.loop();
	}

	private loop = () => {
		this.raf = requestAnimationFrame(this.loop);
		const dt = Math.min(0.05, this.clock.getDelta());
		this.t += dt;
		const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
		if (this.r && (this.canvas.width !== Math.round(w * this.r.getPixelRatio()) || this.canvas.height !== Math.round(h * this.r.getPixelRatio()))) {
			this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
		}
		if (this.fig) { this.fig.root.rotation.y = Math.sin(this.t * 0.6) * 0.7; this.fig.update(dt); }
		this.r?.render(this.scene, this.cam);
	};

	/** kurze Freude-Animation (z. B. beim Antippen) */
	cheer() { this.fig?.play("jump", { once: true, then: () => this.fig?.play("idle") }); }

	dispose() { cancelAnimationFrame(this.raf); this.fig?.dispose(); this.r?.dispose(); }
}
