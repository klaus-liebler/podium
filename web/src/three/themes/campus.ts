// Campus-Insel: schwebende Low-Poly-Insel mit Hochschulgebäuden, Bäumen, Wegen, Wolken; Feuerwerk bei der Siegerehrung.
import {
	CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshStandardMaterial,
	PlaneGeometry, SphereGeometry, type Object3D,
} from "three";
import { model } from "../assets.ts";
import { canvasTex, place, rng, skyDome, type ThemeCtx, type ThemeDef, type ThemeRuntime } from "./common.ts";

export const campus: ThemeDef = {
	id: "campus", label: "Campus-Insel", icon: "🏫",
	bloom: 0.35, exposure: 1.05,
	cams: {
		lobby: { pos: [-1.9, 2.3, 7.6], look: [-1.9, 0.75, 0], fov: 42 },
		game: { pos: [0, 4.6, 12], look: [0, 1.6, -3], fov: 46 },
		podium: { pos: [0, 1.8, 6.2], look: [0, 1.05, 0], fov: 40 },
	},
	lobbyArea: { x0: -0.5, x1: 3.6, z0: -1.8, z1: 2.0 },
	seat: (i) => { const row = Math.floor(i / 12), col = i % 12; return { x: (col - 5.5) * 0.75 + (row % 2) * 0.35, z: -3.2 - row * 0.8, ry: 0 }; },
	crowd: (i) => { const row = Math.floor(i / 14), k = i % 14; const a = (k / 13 - 0.5) * Math.PI * 0.95, r = 2.7 + row * 0.85; return { x: Math.sin(a) * r * 1.25, z: -Math.cos(a) * r * 0.75 - 0.4, ry: -a * 0.35 }; },
	podium: { x: 0, z: 0, colors: [0xf2c230, 0xd5dbe6, 0xd08a52], metal: 0.55 },
	async build(ctx: ThemeCtx): Promise<ThemeRuntime> {
		const g = new Group();
		const sky = skyDome(0x3b8de0, 0x9fd2ff, { horizon: 0xe9f6ff });
		g.add(sky.mesh);
		ctx.scene.background = new Color(0x9fd2ff);
		ctx.scene.fog = new Fog(0xcfe9ff, 40, 120);

		g.add(new HemisphereLight(0xcfe8ff, 0x4f7a3a, 1.0));
		const sun = new DirectionalLight(0xfff1d6, 2.0); sun.position.set(8, 14, 6); sun.castShadow = true;
		sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, far: 60 }); g.add(sun);

		// Insel
		const grass = new Mesh(new CylinderGeometry(17, 16.5, 0.6, 40), new MeshStandardMaterial({ color: 0x6cbf4a, roughness: 0.95, flatShading: true }));
		grass.position.y = -0.3; grass.receiveShadow = true; g.add(grass);
		const dirt = new Mesh(new CylinderGeometry(16.5, 15, 1.2, 40), new MeshStandardMaterial({ color: 0x8b5a2b, roughness: 1, flatShading: true }));
		dirt.position.y = -1.2; g.add(dirt);
		const rockGeo = new ConeGeometry(15, 10, 28, 4);
		const pos = rockGeo.attributes.position, r = rng(42);
		for (let i = 0; i < pos.count; i++) { if (pos.getY(i) < 4.9) { pos.setX(i, pos.getX(i) * (0.85 + r() * 0.3)); pos.setZ(i, pos.getZ(i) * (0.85 + r() * 0.3)); } }
		rockGeo.computeVertexNormals();
		const rock = new Mesh(rockGeo, new MeshStandardMaterial({ color: 0x7a6a5a, roughness: 1, flatShading: true }));
		rock.rotation.x = Math.PI; rock.position.y = -6.8; g.add(rock);

		// Platz + Wege
		const stone = new MeshStandardMaterial({ color: 0xe1d8c6, roughness: 0.9 });
		const plaza = new Mesh(new CircleGeometry(3.6, 48), stone); plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.01; plaza.receiveShadow = true; g.add(plaza);
		const plazaRing = new Mesh(new CircleGeometry(3.9, 48), new MeshStandardMaterial({ color: 0xb9ad96, roughness: 0.9 })); plazaRing.rotation.x = -Math.PI / 2; plazaRing.position.y = 0.005; g.add(plazaRing);
		for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
			const p = new Mesh(new PlaneGeometry(1.5, 13), stone); p.rotation.x = -Math.PI / 2; p.rotation.z = a;
			p.position.set(Math.sin(a) * 9.5, 0.008, Math.cos(a) * 9.5); p.receiveShadow = true; g.add(p);
		}

		// Gebäude (Kenney City Kits) im Halbkreis hinten
		const jobs: Promise<unknown>[] = [];
		const put = (path: string, x: number, z: number, ry: number, s: number) => jobs.push(model(path, { scale: s }).then(o => place(g, o, x, z, ry)));
		put("city-commercial/building-skyscraper-a.glb", 0, -12, 0, 2.6);
		put("city-commercial/building-a.glb", -5.2, -11, 0.25, 3.2);
		put("city-commercial/building-b.glb", 5.2, -11, -0.25, 3.2);
		put("city-commercial/building-d.glb", -9.6, -8, 0.7, 3.0);
		put("city-commercial/building-c.glb", 9.6, -8, -0.7, 3.0);
		put("city-suburban/building-type-f.glb", -12.5, -2.5, 1.2, 2.6);
		put("city-suburban/building-type-c.glb", 12.5, -2.5, -1.2, 2.6);
		put("city-commercial/detail-parasol-a.glb", -6.5, 4.5, 0, 2.4);
		put("city-commercial/detail-parasol-a.glb", -5.2, 5.6, 0, 2.4);
		// Bäume & Pflanzen (Nature Kit)
		const trees = ["nature/tree_oak.glb", "nature/tree_default.glb", "nature/tree_detailed.glb", "nature/tree_fat.glb", "nature/tree_pineRoundA.glb"];
		const tr = rng(3);
		for (let i = 0; i < 26; i++) {
			const a = tr() * Math.PI * 2, d = 6.5 + tr() * 9;
			const x = Math.sin(a) * d, z = Math.cos(a) * d;
			if (Math.abs(x) < 1.3 || Math.abs(z) < 1.3 || (z < -6 && Math.abs(x) < 11)) continue;
			put(trees[i % trees.length], x, z, tr() * 6, 2.0 + tr() * 0.8);
		}
		for (let i = 0; i < 40; i++) {
			const a = tr() * Math.PI * 2, d = 4.5 + tr() * 11, x = Math.sin(a) * d, z = Math.cos(a) * d;
			if (Math.abs(x) < 1.2 || Math.abs(z) < 1.2) continue;
			put(["nature/plant_bushDetailed.glb", "nature/flower_redA.glb", "nature/flower_yellowA.glb", "nature/flower_purpleA.glb", "nature/grass_large.glb"][i % 5], x, z, tr() * 6, 2.2);
		}
		// Bänke aus Baumstämmen
		put("nature/log.glb", 4.6, 3.6, 1.2, 2.4); put("nature/log.glb", -4.4, -3.8, 0.3, 2.4);
		await Promise.all(jobs);

		// Hochschul-Schild
		const sign = canvasTex(512, 128, (x, w, h) => {
			x.fillStyle = "#1d3c6e"; x.fillRect(0, 0, w, h); x.fillStyle = "#ffd84d"; x.fillRect(0, h - 12, w, 12);
			x.font = "600 54px Fredoka, system-ui"; x.fillStyle = "#fff"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("Podium Campus", w / 2, h / 2 - 4);
		});
		const board = new Mesh(new PlaneGeometry(3.2, 0.8), new MeshStandardMaterial({ map: sign.tex, roughness: 0.6 }));
		board.position.set(5.6, 1.3, -4.6); board.rotation.y = -0.45; g.add(board);
		for (const dx of [-1.4, 1.4]) { const post = new Mesh(new CylinderGeometry(0.05, 0.05, 1.3, 8), new MeshStandardMaterial({ color: 0x444a55 })); post.position.set(5.6 + dx * Math.cos(0.45), 0.65, -4.6 + dx * Math.sin(0.45)); g.add(post); }

		// Wolken
		const clouds: Object3D[] = [];
		const cm = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
		const cr = rng(9);
		for (let i = 0; i < 14; i++) {
			const c = new Group();
			for (let k = 0; k < 5; k++) { const s = new Mesh(new SphereGeometry(1 + cr() * 1.2, 7, 5), cm); s.position.set(k * 1.3 - 2.6, cr() * 0.6, cr() * 0.8); c.add(s); }
			c.position.set((cr() - 0.5) * 90, -4 + cr() * 22, -20 - cr() * 50); c.scale.setScalar(1 + cr() * 1.5);
			g.add(c); clouds.push(c);
		}

		g.add(ctx.fireworks.points);
		ctx.scene.add(g);
		return {
			group: g,
			update(dt, st) {
				sky.uniforms.time.value = st.t;
				clouds.forEach((c, i) => { c.position.x += dt * (0.3 + (i % 3) * 0.15); if (c.position.x > 50) c.position.x = -50; });
			},
			celebrate() { ctx.fireworks.show(0, -8, 9, 18); setTimeout(() => ctx.fireworks.show(0, -6, 7, 14), 2600); },
			dispose() { g.removeFromParent(); ctx.scene.fog = null; },
		};
	},
};
