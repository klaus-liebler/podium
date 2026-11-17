// Weltraum-Arena: Mondoberfläche mit Kratern, leuchtenden Kristallen, Hangars, Satellitenschüsseln, Planeten, Sternen,
// kreisenden Raumgleitern und einer Rakete, die bei der Siegerehrung startet.
import {
	AdditiveBlending, Color, ConeGeometry, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial,
	PlaneGeometry, PointLight, RingGeometry, SphereGeometry, DoubleSide, type Object3D,
} from "three";
import { model } from "../assets.ts";
import { canvasTex, place, rng, skyDome, starfield, type ThemeCtx, type ThemeDef, type ThemeRuntime } from "./common.ts";

export const space: ThemeDef = {
	id: "space", label: "Weltraum-Arena", icon: "🚀",
	bloom: 0.8, exposure: 1.0, hop: 1.9,
	cams: {
		lobby: { pos: [-1.9, 2.3, 7.6], look: [-1.9, 0.75, 0], fov: 42 },
		game: { pos: [0, 3.6, 11], look: [0, 1.8, -3], fov: 46 },
		podium: { pos: [0, 1.8, 6.2], look: [0, 1.1, 0], fov: 40 },
	},
	lobbyArea: { x0: -0.5, x1: 3.6, z0: -1.8, z1: 2.0 },
	seat: (i) => { const row = Math.floor(i / 12), col = i % 12; return { x: (col - 5.5) * 0.78 + (row % 2) * 0.39, z: -3 - row * 0.85, ry: 0 }; },
	crowd: (i) => { const row = Math.floor(i / 14), k = i % 14; const a = (k / 13 - 0.5) * Math.PI * 0.95, r = 2.7 + row * 0.85; return { x: Math.sin(a) * r * 1.25, z: -Math.cos(a) * r * 0.75 - 0.4, ry: -a * 0.35 }; },
	podium: { x: 0, z: 0, colors: [0xffc940, 0xb8c6dc, 0xe0884a], metal: 0.85, base: 0x2a3550 },
	async build(ctx: ThemeCtx): Promise<ThemeRuntime> {
		const g = new Group();
		const sky = skyDome(0x0a0620, 0x02010a, { horizon: 0x2a1450, stars: 1.0 });
		g.add(sky.mesh);
		g.add(starfield(1600, 150, 0.4));
		ctx.scene.background = new Color(0x02010a);
		ctx.scene.fog = null;

		g.add(new HemisphereLight(0x7b8cff, 0x14102a, 0.7));
		const key = new DirectionalLight(0xdfe8ff, 1.6); key.position.set(-6, 10, 6); key.castShadow = true;
		key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 }); g.add(key);
		const rim = new PointLight(0xff8a3c, 60, 30, 1.5); rim.position.set(8, 3, -6); g.add(rim);

		// Mondboden mit Hügeln
		const geo = new PlaneGeometry(60, 60, 60, 60);
		const p = geo.attributes.position, r = rng(5);
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i), y = p.getY(i), d = Math.hypot(x, y);
			const h = d < 7 ? 0 : (Math.sin(x * 0.35) * Math.cos(y * 0.3) * 0.6 + r() * 0.25) * Math.min(1, (d - 7) / 6) * (1 + d * 0.04);
			p.setZ(i, h);
		}
		geo.computeVertexNormals();
		const ground = new Mesh(geo, new MeshStandardMaterial({ color: 0x8d8f9e, roughness: 1, flatShading: true }));
		ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; g.add(ground);

		// Landeplattform mit Leuchtring
		const pad = new Mesh(new RingGeometry(3.6, 3.75, 64), new MeshBasicMaterial({ color: 0x46e6ff, toneMapped: false, side: DoubleSide }));
		pad.rotation.x = -Math.PI / 2; pad.position.y = 0.02; g.add(pad);
		const padFloor = new Mesh(new RingGeometry(0, 3.6, 64), new MeshStandardMaterial({ color: 0x3a4258, roughness: 0.5, metalness: 0.6 }));
		padFloor.rotation.x = -Math.PI / 2; padFloor.position.y = 0.01; padFloor.receiveShadow = true; g.add(padFloor);

		const jobs: Promise<unknown>[] = [];
		const put = (path: string, x: number, z: number, ry: number, s: number, y = 0) => jobs.push(model(path, { scale: s }).then(o => place(g, o, x, z, ry, 1, y)));
		put("space/hangar_roundGlass.glb", -8, -9, 0.3, 2.6);
		put("space/hangar_largeA.glb", 8.5, -10, -0.2, 2.6);
		put("space/hangar_smallA.glb", -12, -3, 1.2, 2.4);
		put("space/structure_detailed.glb", 12, -4, 0.4, 2.2);
		const dishes: Object3D[] = [];
		for (const [x, z] of [[-10, 2], [11, 1.5], [5, -12]] as const) jobs.push(model("space/satelliteDish_large.glb", { scale: 2.4 }).then(o => { place(g, o, x, z, 0); dishes.push(o); }));
		const cr = rng(11);
		const crystals: Mesh[] = [];
		for (let i = 0; i < 14; i++) {
			const a = cr() * Math.PI * 2, d = 6 + cr() * 10, x = Math.sin(a) * d, z = Math.cos(a) * d;
			if (z > 3 && Math.abs(x) < 6) continue;
			const kind = ["space/craterLarge.glb", "space/crater.glb", "space/rock_largeA.glb", "space/rock_largeB.glb", "space/meteor_detailed.glb"][i % 5];
			put(kind, x, z, cr() * 6, 2.5 + cr() * 2);
		}
		for (let i = 0; i < 8; i++) {
			const a = cr() * Math.PI * 2, d = 5 + cr() * 8;
			jobs.push(model(i % 2 ? "space/rock_crystalsLargeA.glb" : "space/rock_crystalsLargeB.glb", { scale: 1.8 + cr() }).then(o => {
				place(g, o, Math.sin(a) * d, Math.cos(a) * d - 2, cr() * 6);
				o.traverse(m => { if (m instanceof Mesh) { const mm = (m.material as MeshStandardMaterial).clone(); if (mm.color.b > mm.color.r) { mm.emissive = new Color(0x46e6ff); mm.emissiveIntensity = 0.6; crystals.push(m); } m.material = mm; } });
			}));
		}
		put("space/rover.glb", 3.5, 5.5, -0.8, 2.2);

		// Rakete (gestapelt) rechts hinten
		const rocket = new Group(); rocket.position.set(10.5, 0, -5.5); g.add(rocket);
		const parts: [string, number][] = [["space/rocket_baseA.glb", 0], ["space/rocket_fuelA.glb", 1.6], ["space/rocket_sidesA.glb", 2.1], ["space/rocket_finsA.glb", 0.0], ["space/rocket_topA.glb", 3.1]];
		for (const [path, y] of parts) jobs.push(model(path, { scale: 1 }).then(o => { o.position.y = y; rocket.add(o); }));
		rocket.scale.setScalar(1.4);
		const flame = new Mesh(new ConeGeometry(0.6, 2.4, 16, 1, true), new MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
		flame.rotation.x = Math.PI; flame.position.y = -1.0; rocket.add(flame);

		// Raumgleiter im Orbit
		const crafts: Object3D[] = [];
		for (const [path, s] of [["space/craft_speederA.glb", 1.6], ["space/craft_racer.glb", 1.6], ["space/craft_cargoA.glb", 1.4]] as const)
			jobs.push(model(path, { scale: s }).then(o => { g.add(o); crafts.push(o); }));
		await Promise.all(jobs);

		// Planeten
		const ptex = canvasTex(512, 256, (x, w, h) => {
			for (let y = 0; y < h; y++) { const v = Math.sin(y * 0.09) * 0.5 + Math.sin(y * 0.031) * 0.5; x.fillStyle = `hsl(${22 + v * 18}, 65%, ${48 + v * 12}%)`; x.fillRect(0, y, w, 1); }
		});
		const planet = new Mesh(new SphereGeometry(14, 48, 32), new MeshStandardMaterial({ map: ptex.tex, roughness: 1 }));
		planet.position.set(-38, 22, -80); g.add(planet);
		const ringP = new Mesh(new RingGeometry(18, 26, 96), new MeshBasicMaterial({ color: 0xe8c9a0, transparent: true, opacity: 0.55, side: DoubleSide }));
		ringP.position.copy(planet.position); ringP.rotation.set(1.2, 0.3, 0.2); g.add(ringP);
		const moon = new Mesh(new SphereGeometry(4, 32, 20), new MeshStandardMaterial({ color: 0x9fb6ff, roughness: 1, emissive: 0x1c2a6a, emissiveIntensity: 0.4 }));
		moon.position.set(30, 18, -60); g.add(moon);

		g.add(ctx.fireworks.points);
		ctx.scene.add(g);
		let launch = -1;
		return {
			group: g,
			update(dt, st) {
				sky.uniforms.time.value = st.t;
				dishes.forEach((d, i) => { d.rotation.y = st.t * 0.25 + i; });
				crafts.forEach((c, i) => {
					const a = st.t * (0.18 + i * 0.05) + i * 2.1, R = 16 + i * 4;
					c.position.set(Math.cos(a) * R, 6 + i * 2.5 + Math.sin(a * 2) * 0.8, Math.sin(a) * R * 0.6 - 10);
					c.rotation.y = -a + Math.PI; c.rotation.z = 0.3;
				});
				const glow = 0.5 + Math.sin(st.t * 2) * 0.2 + st.pulse * 0.6 + (st.mode === "answering" ? st.tension * 0.8 : 0);
				crystals.forEach(m => { (m.material as MeshStandardMaterial).emissiveIntensity = glow; });
				(pad.material as MeshBasicMaterial).color.setHSL(0.52 - (st.mode === "answering" ? st.tension * 0.5 : 0), 0.9, 0.55 + st.pulse * 0.2);
				planet.rotation.y += dt * 0.02;
				if (launch >= 0) {
					launch += dt;
					rocket.position.y = launch < 1.2 ? Math.sin(launch * 40) * 0.03 : Math.pow(launch - 1.2, 2) * 4;
					(flame.material as MeshBasicMaterial).opacity = Math.min(1, launch);
					flame.scale.y = 1 + Math.sin(st.t * 40) * 0.15 + Math.min(2, launch);
					if (launch > 1.2 && Math.random() < 0.6) ctx.burst({ x: rocket.position.x, y: rocket.position.y - 1, z: rocket.position.z }, 6, 0.2);
					if (launch > 9) { launch = -1; rocket.position.y = 0; (flame.material as MeshBasicMaterial).opacity = 0; }
				}
			},
			celebrate() { launch = 0; setTimeout(() => ctx.fireworks.show(0, -10, 8, 20), 1800); },
			dispose() { g.removeFromParent(); ptex.tex.dispose(); },
		};
	},
};
