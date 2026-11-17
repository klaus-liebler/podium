// Natur: Morgenstimmung auf der Wiese zwischen Apfelbäumen. Podest aus drei unterschiedlich hoch geschnittenen Baumstümpfen.
// Musik: Grieg, Peer Gynt – Morgenstimmung (gemeinfrei, siehe tracks.json "themes.nature").
import {
	BufferGeometry, CanvasTexture, CircleGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Fog, Group, HemisphereLight,
	Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry, Sprite, SpriteMaterial, Vector3, AdditiveBlending, Box3,
	type Object3D,
} from "three";
import { model } from "../assets.ts";
import { canvasTex, place, rng, skyDome, type ThemeCtx, type ThemeDef, type ThemeRuntime } from "./common.ts";

/** Baumstumpf mit Jahresringen oben */
export function stump(h: number, r: number, ringsTex: CanvasTexture): Group {
	const g = new Group();
	const bark = new MeshStandardMaterial({ color: 0x7a5233, roughness: 1, flatShading: true });
	const geo = new CylinderGeometry(r, r * 1.18, h, 14, 3);
	const p = geo.attributes.position, rr = rng(Math.round(h * 100));
	for (let i = 0; i < p.count; i++) { const k = 1 + (rr() - 0.5) * 0.12; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
	geo.computeVertexNormals();
	geo.translate(0, h / 2, 0);
	const trunk = new Mesh(geo, bark); trunk.castShadow = true; trunk.receiveShadow = true; g.add(trunk);
	const top = new Mesh(new CircleGeometry(r * 0.97, 24), new MeshStandardMaterial({ map: ringsTex, roughness: 0.9 }));
	top.rotation.x = -Math.PI / 2; top.position.y = h + 0.002; top.receiveShadow = true; g.add(top);
	// Wurzeln
	for (let i = 0; i < 5; i++) {
		const a = i / 5 * Math.PI * 2 + 0.3;
		const root = new Mesh(new CylinderGeometry(0.03, 0.11, 0.55, 6), bark);
		root.position.set(Math.cos(a) * r * 1.05, 0.08, Math.sin(a) * r * 1.05); root.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2);
		g.add(root);
	}
	return g;
}

export function ringsTexture() {
	return canvasTex(256, 256, (x, w) => {
		x.fillStyle = "#e3c08b"; x.fillRect(0, 0, w, w);
		for (let i = 18; i > 0; i--) { x.beginPath(); x.arc(w / 2 + Math.sin(i) * 3, w / 2 + Math.cos(i * 1.3) * 3, i * 6.8, 0, Math.PI * 2); x.strokeStyle = i % 3 ? "rgba(140,90,50,.35)" : "rgba(120,70,40,.6)"; x.lineWidth = i % 3 ? 1.5 : 3; x.stroke(); }
		x.strokeStyle = "rgba(90,55,30,.5)"; x.lineWidth = 2; x.beginPath(); x.moveTo(w / 2, w / 2); x.lineTo(w * 0.85, w * 0.3); x.stroke();
	}).tex;
}

export const nature: ThemeDef = {
	id: "nature", label: "Apfelwiese", icon: "🍎",
	bloom: 0.3, exposure: 1.08,
	cams: {
		lobby: { pos: [-1.9, 2.3, 7.6], look: [-1.9, 0.75, 0], fov: 42 },
		game: { pos: [0, 4.0, 11.5], look: [0, 1.6, -3], fov: 46 },
		podium: { pos: [0, 1.7, 6.0], look: [0, 1.0, 0], fov: 40 },
	},
	lobbyArea: { x0: -0.5, x1: 3.6, z0: -1.8, z1: 2.0 },
	seat: (i) => { const row = Math.floor(i / 12), col = i % 12; return { x: (col - 5.5) * 0.78 + (row % 2) * 0.39, z: -3 - row * 0.85, ry: 0 }; },
	crowd: (i) => { const row = Math.floor(i / 14), k = i % 14; const a = (k / 13 - 0.5) * Math.PI * 0.95, r = 2.7 + row * 0.85; return { x: Math.sin(a) * r * 1.25, z: -Math.cos(a) * r * 0.75 - 0.4, ry: -a * 0.35 }; },
	podium: { x: 0, z: 0, colors: [0x7a5233, 0x7a5233, 0x7a5233], metal: 0 },
	async build(ctx: ThemeCtx): Promise<ThemeRuntime> {
		const g = new Group();
		const sky = skyDome(0x6aa8e8, 0xbfe2c0, { horizon: 0xffd9a8 });
		g.add(sky.mesh);
		ctx.scene.background = new Color(0xbfe2c0);
		ctx.scene.fog = new Fog(0xf4e6cc, 30, 90);

		g.add(new HemisphereLight(0xfff0d8, 0x5a7d34, 1.0));
		const sun = new DirectionalLight(0xffd59a, 2.2); sun.position.set(-12, 7, -6); sun.castShadow = true; // tiefe Morgensonne -> lange Schatten
		sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, far: 70 }); g.add(sun);
		// Sonnenscheibe am Horizont
		const sunTex = canvasTex(256, 256, (x) => { const gr = x.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, "rgba(255,250,220,1)"); gr.addColorStop(0.25, "rgba(255,220,150,.9)"); gr.addColorStop(1, "rgba(255,200,120,0)"); x.fillStyle = gr; x.fillRect(0, 0, 256, 256); });
		const sunSprite = new Sprite(new SpriteMaterial({ map: sunTex.tex, blending: AdditiveBlending, depthWrite: false, fog: false }));
		sunSprite.position.set(-60, 14, -90); sunSprite.scale.setScalar(40); g.add(sunSprite);

		// Wiese (leicht gewellt)
		const geo = new PlaneGeometry(120, 120, 80, 80), p = geo.attributes.position;
		for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), d = Math.hypot(x, y); p.setZ(i, d < 9 ? 0 : (Math.sin(x * 0.12) + Math.cos(y * 0.1)) * 0.5 * Math.min(1, (d - 9) / 10)); }
		geo.computeVertexNormals();
		const meadow = new Mesh(geo, new MeshStandardMaterial({ color: 0x7cc35a, roughness: 1, flatShading: true }));
		meadow.rotation.x = -Math.PI / 2; meadow.receiveShadow = true; g.add(meadow);
		// Gemähte Lichtung
		const glade = new Mesh(new CircleGeometry(4.2, 48), new MeshStandardMaterial({ color: 0x9fd477, roughness: 1 }));
		glade.rotation.x = -Math.PI / 2; glade.position.y = 0.01; glade.receiveShadow = true; g.add(glade);

		// Apfelbäume in Reihen (Obstwiese) + Äpfel
		const jobs: Promise<unknown>[] = [];
		const appleGeo = new SphereGeometry(0.07, 8, 6);
		const appleMats = [0xd62828, 0xe63946, 0x9bc53d].map(c => new MeshStandardMaterial({ color: c, roughness: 0.45 }));
		const fallen: Mesh[] = [];
		const tr = rng(17);
		const treeAt = (x: number, z: number, s: number) => jobs.push(model(Math.round(x + z) % 2 ? "nature/tree_default.glb" : "nature/tree_oak.glb", { scale: s }).then(o => {
			place(g, o, x, z, tr() * 6);
			o.updateMatrixWorld(true);
			const b = new Box3().setFromObject(o), c = b.getCenter(new Vector3()), size = b.getSize(new Vector3());
			const crown = new Vector3(c.x, b.min.y + size.y * 0.66, c.z);
			for (let k = 0; k < 14; k++) {
				const dir = new Vector3(tr() * 2 - 1, tr() * 1.2 - 0.4, tr() * 2 - 1).normalize();
				const ap = new Mesh(appleGeo, appleMats[k % 7 === 0 ? 2 : k % 2]);
				ap.position.copy(crown).add(dir.multiply(new Vector3(size.x * 0.46, size.y * 0.28, size.z * 0.46)));
				ap.castShadow = true; g.add(ap);
			}
			for (let k = 0; k < 3; k++) { const ap = new Mesh(appleGeo, appleMats[k % 2]); ap.position.set(x + (tr() - 0.5) * 2, 0.07, z + (tr() - 0.5) * 2); g.add(ap); fallen.push(ap); }
		}));
		for (let row = 0; row < 4; row++) for (let col = -5; col <= 5; col++) {
			const x = col * 4.2 + (row % 2) * 2.1, z = -7 - row * 4.2;
			treeAt(x + (tr() - 0.5) * 0.8, z + (tr() - 0.5) * 0.8, 2.3 + tr() * 0.6);
		}
		for (const side of [-1, 1]) for (let k = 0; k < 4; k++) treeAt(side * (10 + k * 3.6), 2 - k * 1.5, 2.3 + tr() * 0.5);
		// Blumen, Gräser, Zaun, Steine
		for (let i = 0; i < 70; i++) {
			const a = tr() * Math.PI * 2, d = 4.6 + tr() * 14, x = Math.sin(a) * d, z = Math.cos(a) * d;
			if (z > 4 && Math.abs(x) < 7) continue;
			jobs.push(model(["nature/flower_redA.glb", "nature/flower_yellowA.glb", "nature/flower_purpleA.glb", "nature/grass_large.glb", "nature/grass.glb"][i % 5], { scale: 2.2 }).then(o => place(g, o, x, z, tr() * 6)));
		}
		for (let k = -6; k <= 6; k++) jobs.push(model("nature/fence_simple.glb", { scale: 2.0 }).then(o => place(g, o, k * 2, -24, 0)));
		jobs.push(model("nature/rock_largeA.glb", { scale: 2.4 }).then(o => place(g, o, 6.5, 2.5, 0.8)));
		jobs.push(model("nature/log.glb", { scale: 2.4 }).then(o => place(g, o, -6.2, 3.4, 1.1)));
		await Promise.all(jobs);

		// Schmetterlinge
		const flies: { m: Group; c: Vector3; ph: number }[] = [];
		const wingMats = [0xffd84d, 0xff8fab, 0x8ec5ff, 0xffffff].map(c => new MeshStandardMaterial({ color: c, side: DoubleSide, roughness: 0.6 }));
		const wingGeo = new PlaneGeometry(0.16, 0.12) as BufferGeometry;
		for (let i = 0; i < 12; i++) {
			const m = new Group(); const mat = wingMats[i % 4];
			for (const s of [-1, 1]) { const w = new Mesh(wingGeo, mat); w.position.x = s * 0.08; w.name = s < 0 ? "L" : "R"; m.add(w); }
			g.add(m); flies.push({ m, c: new Vector3((tr() - 0.5) * 16, 0.8 + tr() * 1.4, (tr() - 0.5) * 10 - 1), ph: tr() * 10 });
		}

		ctx.scene.add(g);
		return {
			group: g,
			update(dt, st) {
				sky.uniforms.time.value = st.t;
				for (const f of flies) {
					const t = st.t * 0.6 + f.ph;
					f.m.position.set(f.c.x + Math.sin(t) * 2.2, f.c.y + Math.sin(t * 2.3) * 0.4, f.c.z + Math.cos(t * 0.8) * 1.6);
					f.m.rotation.y = -t + Math.PI / 2;
					const flap = Math.sin(st.t * 18 + f.ph) * 0.9;
					(f.m.children[0] as Object3D).rotation.y = flap; (f.m.children[1] as Object3D).rotation.y = -flap;
				}
			},
			celebrate() {
				// Blätter-/Blütenregen aus den Bäumen
				for (let i = 0; i < 6; i++) setTimeout(() => ctx.burst({ x: (Math.random() - 0.5) * 8, y: 3.5, z: -3 }, 120, 0.5), i * 250);
			},
			dispose() { g.removeFromParent(); sunTex.tex.dispose(); ctx.scene.fog = null; },
		};
	},
};
