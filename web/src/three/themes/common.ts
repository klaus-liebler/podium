// Gemeinsame Bausteine der 3D-Welten.
import {
	AdditiveBlending, BackSide, Box3, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry, DoubleSide, Group, Mesh,
	Points, PointsMaterial, ShaderMaterial, SphereGeometry, SRGBColorSpace, Vector3, type Object3D, type Scene, type WebGLRenderer,
} from "three";

export type ThemeId = "studio" | "campus" | "space" | "stadium" | "nature" | "osnabrueck" | "calm";
export interface Cam { pos: [number, number, number]; look: [number, number, number]; fov: number; }
export interface Spot { x: number; z: number; ry: number; }
export interface ThemeState { mode: string; tension: number; pulse: number; t: number; }
export interface ThemeCtx {
	scene: Scene; renderer: WebGLRenderer;
	/** Konfetti-Explosion an Weltposition */
	burst(o: { x: number; y: number; z: number }, count: number, power: number): void;
	fireworks: Fireworks;
}
export interface ThemeRuntime {
	group: Group;
	update(dt: number, st: ThemeState): void;
	/** Großer Moment (Platz 1): Feuerwerk, Konfetti-Kanonen, Raketenstart … */
	celebrate(): void;
	dispose(): void;
}
export interface ThemeDef {
	id: ThemeId; label: string; icon: string;
	cams: { lobby: Cam; game: Cam; podium: Cam; [mode: string]: Cam };
	lobbyArea: { x0: number; x1: number; z0: number; z1: number };
	seat(i: number, n: number): Spot;
	crowd(i: number, n: number): Spot;
	podium: { x: number; z: number; colors: [number, number, number]; metal: number; base?: number };
	bloom: number; exposure: number;
	/** Sprunghöhe-Faktor (Mond: höher) */
	hop?: number;
	/** Ruhige Welt (z. B. Grundschule, neurodivergente Kinder): nichts bewegt sich, Figuren stehen fest, kein Konfetti/Feuerwerk */
	calm?: boolean;
	build(ctx: ThemeCtx): Promise<ThemeRuntime>;
}

// ---------------------------------------------------------------- Zufall (deterministisch, damit Szenen stabil aussehen)
export function rng(seed: number) {
	let s = seed >>> 0;
	return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function place<T extends Object3D>(parent: Object3D, o: T, x: number, z: number, ry = 0, s = 1, y = 0): T {
	o.position.set(x, y, z); o.rotation.y = ry; o.scale.multiplyScalar(s); parent.add(o); return o;
}

/**
 * Modell in eine Gruppe packen, deren Ursprung in der Mitte der Grundfläche liegt.
 * Kenney-Modelle haben ihren Ursprung oft an einer Ecke – gedreht würden sie sonst im Kreis „fahren“.
 */
export function centered(o: Object3D): Group {
	const g = new Group(), b = new Box3().setFromObject(o), c = b.getCenter(new Vector3());
	o.position.x -= c.x; o.position.z -= c.z;
	g.add(o);
	return g;
}

/** Grundriss eines Objekts als Kreis in der Bodenebene (Weltkoordinaten) */
export function footprint(o: Object3D) {
	const b = new Box3().setFromObject(o), s = b.getSize(new Vector3()), c = b.getCenter(new Vector3());
	return { x: c.x, z: c.z, r: Math.max(s.x, s.z) / 2, h: s.y };
}

// ---------------------------------------------------------------- Himmel
export function skyDome(top: number, bottom: number, opts: { horizon?: number; stars?: number; radius?: number } = {}) {
	const u = {
		top: { value: new Color(top) }, bottom: { value: new Color(bottom) }, horizon: { value: new Color(opts.horizon ?? bottom) },
		stars: { value: opts.stars ?? 0 }, time: { value: 0 },
	};
	const m = new Mesh(new SphereGeometry(opts.radius ?? 180, 48, 24), new ShaderMaterial({
		side: BackSide, depthWrite: false, fog: false, uniforms: u,
		vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
		fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 horizon; uniform float stars; uniform float time; varying vec3 vP;
			float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
			void main(){
				float h = vP.y;
				vec3 col = mix(horizon, top, smoothstep(0.0, 0.6, h));
				col = mix(bottom, col, smoothstep(-0.25, 0.02, h));
				if (stars > 0.0) {
					vec3 q = floor(vP * 260.0);
					float s = step(0.997, hash(q)) * smoothstep(-0.05, 0.3, h);
					float tw = 0.6 + 0.4 * sin(time * 2.0 + hash(q + 1.0) * 40.0);
					col += vec3(s * tw * stars);
				}
				gl_FragColor = vec4(col, 1.0);
			}`,
	}));
	m.renderOrder = -1;
	return { mesh: m, uniforms: u };
}

export function starfield(count: number, radius: number, size = 0.35) {
	const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), r = rng(7);
	for (let i = 0; i < count; i++) {
		const v = new Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize().multiplyScalar(radius * (0.7 + r() * 0.3));
		pos.set([v.x, Math.abs(v.y) * 0.9 + 2, v.z], i * 3);
		const c = new Color().setHSL(0.55 + r() * 0.2, 0.5, 0.75 + r() * 0.25);
		col.set([c.r, c.g, c.b], i * 3);
	}
	const g = new BufferGeometry();
	g.setAttribute("position", new BufferAttribute(pos, 3));
	g.setAttribute("color", new BufferAttribute(col, 3));
	return new Points(g, new PointsMaterial({ size, vertexColors: true, sizeAttenuation: true, fog: false, depthWrite: false }));
}

// ---------------------------------------------------------------- Texturen
export function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void) {
	const c = document.createElement("canvas"); c.width = w; c.height = h;
	const x = c.getContext("2d")!;
	draw(x, w, h);
	const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 4;
	return { tex: t, ctx: x, canvas: c };
}

// ---------------------------------------------------------------- Lichtkegel (sichtbarer Scheinwerferstrahl)
export function beam(color: number, length: number, radius: number) {
	const geo = new ConeGeometry(radius, length, 32, 1, true);
	geo.translate(0, -length / 2, 0); // Spitze im Ursprung, Kegel zeigt nach unten
	const mat = new ShaderMaterial({
		transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
		uniforms: { color: { value: new Color(color) }, intensity: { value: 0.55 }, len: { value: length } },
		vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
			void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
		fragmentShader: `uniform vec3 color; uniform float intensity; uniform float len; varying float vY; varying vec3 vN; varying vec3 vV;
			void main(){ float along = clamp(-vY / len, 0.0, 1.0); float rim = pow(abs(dot(vN, vV)), 1.5);
				float a = (1.0 - along) * (1.0 - along) * rim * intensity; gl_FragColor = vec4(color * a, a); }`,
	});
	const m = new Mesh(geo, mat);
	return { mesh: m, setColor: (c: number | Color) => (mat.uniforms.color.value as Color).set(c), setIntensity: (v: number) => { mat.uniforms.intensity.value = v; } };
}

// ---------------------------------------------------------------- Feuerwerk (Partikel, additiv)
interface Spark { p: Vector3; v: Vector3; life: number; max: number; c: Color; rocket: boolean; color?: Color; }
export class Fireworks {
	readonly points: Points;
	private sparks: Spark[] = [];
	private pos: Float32Array; private col: Float32Array;
	private N = 2400;
	gravity = 4.5;
	constructor() {
		this.pos = new Float32Array(this.N * 3); this.col = new Float32Array(this.N * 3);
		const g = new BufferGeometry();
		g.setAttribute("position", new BufferAttribute(this.pos, 3));
		g.setAttribute("color", new BufferAttribute(this.col, 3));
		this.points = new Points(g, new PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }));
		this.points.frustumCulled = false;
	}
	launch(x: number, z: number, height = 9, color?: number) {
		this.sparks.push({ p: new Vector3(x, 0.5, z), v: new Vector3((Math.random() - 0.5) * 1.2, height, (Math.random() - 0.5) * 1.2), life: 0, max: 1 + Math.random() * 0.3, c: new Color(0xffe0a0), rocket: true, color: new Color(color ?? new Color().setHSL(Math.random(), 0.9, 0.6).getHex()) });
	}
	explode(p: Vector3, color: Color, n = 140) {
		for (let i = 0; i < n && this.sparks.length < this.N; i++) {
			const v = new Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(3 + Math.random() * 3);
			const c = color.clone().offsetHSL((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.2);
			this.sparks.push({ p: p.clone(), v, life: 0, max: 1.4 + Math.random() * 0.8, c, rocket: false });
		}
	}
	show(x: number, z: number, count = 6, spread = 8) {
		for (let i = 0; i < count; i++) setTimeout(() => this.launch(x + (Math.random() - 0.5) * spread, z + (Math.random() - 0.5) * 3, 8 + Math.random() * 4), i * 280);
	}
	update(dt: number) {
		const keep: Spark[] = [];
		for (const s of this.sparks) {
			s.life += dt;
			s.v.y -= this.gravity * dt * (s.rocket ? 0.6 : 0.35);
			if (!s.rocket) s.v.multiplyScalar(Math.pow(0.4, dt));
			s.p.addScaledVector(s.v, dt);
			if (s.rocket && (s.v.y < 1.5 || s.life > s.max)) { this.explode(s.p, s.color!); continue; }
			if (s.life < s.max) keep.push(s);
		}
		this.sparks = keep;
		let i = 0;
		for (const s of this.sparks) {
			if (i >= this.N) break;
			const fade = s.rocket ? 1 : Math.max(0, 1 - s.life / s.max);
			this.pos[i * 3] = s.p.x; this.pos[i * 3 + 1] = s.p.y; this.pos[i * 3 + 2] = s.p.z;
			this.col[i * 3] = s.c.r * fade; this.col[i * 3 + 1] = s.c.g * fade; this.col[i * 3 + 2] = s.c.b * fade;
			i++;
		}
		for (let k = i; k < this.N; k++) { this.pos[k * 3 + 1] = -999; }
		this.points.geometry.attributes.position.needsUpdate = true;
		this.points.geometry.attributes.color.needsUpdate = true;
		this.points.geometry.setDrawRange(0, Math.max(i, 1));
	}
}

/** Gruppe inkl. Geometrien/Materialien freigeben */
export function disposeTree(o: Object3D) {
	o.traverse(c => {
		const m = c as Mesh;
		if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
	});
	o.removeFromParent();
}
