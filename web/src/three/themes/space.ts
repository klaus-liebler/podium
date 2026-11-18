// Weltraum-Arena: Mondoberfläche mit Kratern, leuchtenden Kristallen, Hangars, Satellitenschüsseln, Planeten, Sternen,
// Rovern, die auf freien Bahnen hin- und herfahren, Raumschiffen auf getrennten Flughöhen und einer Rakete,
// die bei der Siegerehrung startet.
import {
	AdditiveBlending, Color, ConeGeometry, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial,
	PlaneGeometry, PointLight, RingGeometry, SphereGeometry, DoubleSide, type Object3D,
} from "three";
import { model } from "../assets.ts";
import { canvasTex, centered, footprint, place, rng, skyDome, starfield, type ThemeCtx, type ThemeDef, type ThemeRuntime } from "./common.ts";

/** Bereich der Figuren (Lobby, Sitzreihen, Publikum der Siegerehrung) – hier fährt nichts */
const PEOPLE = { x: 9.5, z0: -7.5, z1: 3.5 };
/** Felsen/Kristalle nicht in den Bereich der Figuren (mit 1,5 m Rand) */
const inPeople = (x: number, z: number) => Math.abs(x) < PEOPLE.x + 1.5 && z > PEOPLE.z0 - 1.5 && z < PEOPLE.z1 + 1.5;

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
		const geo = new PlaneGeometry(60, 60, 60, 60); // 1-m-Raster, Höhe per heightAt() abfragbar
		const p = geo.attributes.position, r = rng(5);
		for (let i = 0; i < p.count; i++) {
			const x = p.getX(i), y = p.getY(i), d = Math.hypot(x, y);
			const h = d < 7 ? 0 : (Math.sin(x * 0.35) * Math.cos(y * 0.3) * 0.6 + r() * 0.25) * Math.min(1, (d - 7) / 6) * (1 + d * 0.04);
			p.setZ(i, h);
		}
		geo.computeVertexNormals();
		/** Bodenhöhe an Weltposition (bilinear; Ebene ist um -90° gekippt: Welt-z = -lokal-y) */
		const heightAt = (x: number, z: number) => {
			const fx = Math.max(0, Math.min(59.999, x + 30)), fz = Math.max(0, Math.min(59.999, z + 30));
			const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
			const h = (a: number, b: number) => p.getZ(b * 61 + a);
			return (h(ix, iz) * (1 - u) + h(ix + 1, iz) * u) * (1 - v) + (h(ix, iz + 1) * (1 - u) + h(ix + 1, iz + 1) * u) * v;
		};
		const ground = new Mesh(geo, new MeshStandardMaterial({ color: 0x8d8f9e, roughness: 1, flatShading: true }));
		ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; g.add(ground);

		// Landeplattform mit Leuchtring
		const pad = new Mesh(new RingGeometry(3.6, 3.75, 64), new MeshBasicMaterial({ color: 0x46e6ff, toneMapped: false, side: DoubleSide }));
		pad.rotation.x = -Math.PI / 2; pad.position.y = 0.02; g.add(pad);
		const padFloor = new Mesh(new RingGeometry(0, 3.6, 64), new MeshStandardMaterial({ color: 0x3a4258, roughness: 0.5, metalness: 0.6 }));
		padFloor.rotation.x = -Math.PI / 2; padFloor.position.y = 0.01; padFloor.receiveShadow = true; g.add(padFloor);

		const jobs: Promise<unknown>[] = [];
		const statics: Object3D[] = [];
		const put = (path: string, x: number, z: number, ry: number, s: number, y = 0) => jobs.push(model(path, { scale: s }).then(o => { statics.push(place(g, centered(o), x, z, ry, 1, y)); })); // Modell-Ursprung liegt neben dem Modell → zentrieren
		put("space/hangar_roundGlass.glb", -8, -9, 0.3, 2.6);
		put("space/hangar_largeA.glb", 8.5, -10, -0.2, 2.6);
		put("space/hangar_smallA.glb", -12, -3, 1.2, 2.4);
		put("space/structure_detailed.glb", 12, -4, 0.4, 2.2);
		// Satellitenschüsseln: ortsfest, schwenken nur ganz langsam um die Hochachse (Ursprung des Modells liegt neben der Schüssel → zentrieren)
		const dishes: { o: Object3D; base: number }[] = [];
		for (const [x, z, ry] of [[-10, 2, 0.9], [11, 1.5, -0.9], [5, -12, 0.2]] as const) jobs.push(model("space/satelliteDish_large.glb", { scale: 2.4 }).then(o => {
			const c = place(g, centered(o), x, z, ry); statics.push(c); dishes.push({ o: c, base: ry });
		}));
		const cr = rng(11);
		const crystals: Mesh[] = [];
		for (let i = 0; i < 14; i++) {
			const a = cr() * Math.PI * 2, d = 6 + cr() * 10, x = Math.sin(a) * d, z = Math.cos(a) * d;
			if ((z > 3 && Math.abs(x) < 6) || inPeople(x, z)) continue;
			const kind = ["space/craterLarge.glb", "space/crater.glb", "space/rock_largeA.glb", "space/rock_largeB.glb", "space/meteor_detailed.glb"][i % 5];
			put(kind, x, z, cr() * 6, 2.5 + cr() * 2);
		}
		for (let i = 0; i < 8; i++) {
			const a = cr() * Math.PI * 2, d = 5 + cr() * 8, x = Math.sin(a) * d, z = Math.cos(a) * d - 2, ry = cr() * 6, sc = 1.8 + cr();
			if (inPeople(x, z)) continue;
			jobs.push(model(i % 2 ? "space/rock_crystalsLargeA.glb" : "space/rock_crystalsLargeB.glb", { scale: sc }).then(o => {
				statics.push(place(g, centered(o), x, z, ry));
				o.traverse(m => { if (m instanceof Mesh) { const mm = (m.material as MeshStandardMaterial).clone(); if (mm.color.b > mm.color.r) { mm.emissive = new Color(0x46e6ff); mm.emissiveIntensity = 0.6; crystals.push(m); } m.material = mm; } });
			}));
		}
		/** Rover pendelt auf einer geraden Bahn a→b (Parameter s in Metern), wendet an den Enden auf der Stelle */
		const rovers: { o: Object3D; ax: number; az: number; ux: number; uz: number; len: number; s: number; dir: number; ry: number; speed: number }[] = [];
		const roverModels = [0, 1].map(() => model("space/rover.glb", { scale: 4.5 }).then(o => centered(o)));

		// Rakete (gestapelt) rechts hinten
		const rocket = new Group(); rocket.position.set(10.5, 0, -5.5); g.add(rocket);
		const parts: [string, number][] = [["space/rocket_baseA.glb", 0], ["space/rocket_fuelA.glb", 1.6], ["space/rocket_sidesA.glb", 2.1], ["space/rocket_finsA.glb", 0.0], ["space/rocket_topA.glb", 3.1]];
		for (const [path, y] of parts) jobs.push(model(path, { scale: 1 }).then(o => { o.position.y = y; rocket.add(o); }));
		rocket.scale.setScalar(1.4);
		const flame = new Mesh(new ConeGeometry(0.6, 2.4, 16, 1, true), new MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
		flame.rotation.x = Math.PI; flame.position.y = -1.0; rocket.add(flame);

		// Raumgleiter im Orbit
		// Raumschiffe: jedes auf eigener Flughöhe und eigener Ellipse (Abstand zur Raketen-Startachse ≥ 6 m) → keine Kollisionen
		const crafts: { o: Object3D; R: number; y: number; w: number; a0: number }[] = [];
		for (const [path, s, R, y, w] of [
			["space/craft_speederA.glb", 1.6, 22, 7, 0.07], ["space/craft_racer.glb", 1.6, 26, 10, -0.055], ["space/craft_cargoA.glb", 3.4, 31, 14, 0.03],
		] as const)
			jobs.push(model(path, { scale: s }).then(o => { const c = centered(o); c.userData.noCollide = true; g.add(c); crafts.push({ o: c, R, y, w, a0: crafts.length * 2.1 }); }));
		await Promise.all(jobs);

		// Rover: freie, gut sichtbare Fahrbahnen suchen – quer hinter den Sitzreihen oder längs neben der Bühne –
		// mit Abstand zu allen Bauten, Felsen, Schüsseln, zur Rakete und zum Bereich der Figuren
		const fps = statics.map(footprint).filter(f => f.h > 0.3);
		const free = (x: number, z: number) => Math.abs(x) < 16 && z > -22 && z < 7 && !(Math.abs(x) < PEOPLE.x && z > PEOPLE.z0 && z < PEOPLE.z1)
			&& fps.every(f => (x - f.x) ** 2 + (z - f.z) ** 2 > (f.r + 1.0) ** 2) && Math.hypot(x - 10.5, z + 5.5) > 3.5;
		type Lane = { ax: number; az: number; bx: number; bz: number; len: number };
		const cands: Lane[] = [];
		/** längster freier Abschnitt einer Linie (Rover-Breite: Prüfung auch 0,7 m seitlich) */
		const scan = (x0: number, z0: number, x1: number, z1: number) => {
			const L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
			let run = -1, best: Lane | null = null;
			for (let s = 0; s <= L + 0.01; s += 0.25) {
				const x = x0 + ux * s, z = z0 + uz * s;
				const ok = s < L && [-0.7, 0, 0.7].every(o => free(x - uz * o, z + ux * o));
				if (ok && run < 0) run = s;
				if (!ok && run >= 0) {
					const len = s - 0.25 - run - 2; // 1 m Sicherheitsabstand an beiden Enden
					if (len >= 5 && (!best || len > best.len)) best = { ax: x0 + ux * (run + 1), az: z0 + uz * (run + 1), bx: x0 + ux * (s - 1.25), bz: z0 + uz * (s - 1.25), len };
					run = -1;
				}
			}
			if (best) cands.push(best);
		};
		for (let z = -8.5; z >= -20; z -= 0.5) scan(-16, z, 16, z);                              // quer hinter den Reihen
		for (let x = 10; x <= 15.5; x += 0.5) { scan(x, -20, x, 6); scan(-x, -20, -x, 6); }       // längs neben der Bühne
		// zwei Bahnen wählen: möglichst lang und nah an der Bildmitte, mit Abstand zueinander
		const mid = (l: Lane) => ({ x: (l.ax + l.bx) / 2, z: (l.az + l.bz) / 2 });
		// Sichtbarkeit aus der Quiz-Kamera: Sichtlinie zu Punkten der Bahn darf kein Bauwerk schneiden
		const cam = space.cams.game.pos;
		const seen = (x: number, z: number) => fps.every(f => {
			const dx = x - cam[0], dz = z - cam[2], L2 = dx * dx + dz * dz;
			const t = Math.max(0, Math.min(1, ((f.x - cam[0]) * dx + (f.z - cam[2]) * dz) / L2));
			if (t > 0.97) return true;
			const y = cam[1] + (0.4 - cam[1]) * t;                       // Höhe der Sichtlinie über dem Hindernis
			return y > f.h + 0.2 || Math.hypot(cam[0] + dx * t - f.x, cam[2] + dz * t - f.z) > f.r * 0.9;
		});
		const visible = (l: Lane) => { let n = 0; for (let i = 0; i <= 8; i++) n += seen(l.ax + (l.bx - l.ax) * i / 8, l.az + (l.bz - l.az) * i / 8) ? 1 : 0; return n / 9; };
		const score = (l: Lane) => Math.min(l.len, 14) * visible(l) * 1.5 - Math.abs(mid(l).x) * 0.2 - Math.abs(mid(l).z + 10) * 0.15;
		const lanes: Lane[] = [];
		for (const l of cands.sort((a, b) => score(b) - score(a))) {
			if (lanes.length >= 2) break;
			if (lanes.every(o => segDist(l, o) > 3)) lanes.push(l);
		}
		g.userData.roverLanes = lanes; // zur Kontrolle (Vorschau-Konsole)
		const rm = await Promise.all(roverModels);
		lanes.forEach((l, i) => {
			const o = rm[i]; o.userData.noCollide = true; g.add(o);
			const ux = (l.bx - l.ax) / l.len, uz = (l.bz - l.az) / l.len;
			rovers.push({ o, ax: l.ax, az: l.az, ux, uz, len: Math.hypot(l.bx - l.ax, l.bz - l.az), s: l.len * (i ? 0.7 : 0.3), dir: i ? -1 : 1, ry: Math.atan2(ux * (i ? -1 : 1), uz * (i ? -1 : 1)), speed: 0.9 + i * 0.25 });
		});

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
				dishes.forEach((d, i) => { d.o.rotation.y = d.base + Math.sin(st.t * 0.03 + i * 2.3) * 0.45; });
				crafts.forEach(c => {
					const a = c.a0 + st.t * c.w, R = c.R;
					c.o.position.set(Math.cos(a) * R, c.y + Math.sin(a * 2) * 0.4, Math.sin(a) * R * 0.6 - 10);
					// Flugrichtung = Tangente der Ellipse
					const vx = -Math.sin(a) * R * Math.sign(c.w), vz = Math.cos(a) * R * 0.6 * Math.sign(c.w);
					c.o.rotation.set(0, Math.atan2(vx, vz), -0.18 * Math.sign(c.w));
				});
				rovers.forEach(r => {
					const want = Math.atan2(r.ux * r.dir, r.uz * r.dir);
					let d = want - r.ry; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
					if (Math.abs(d) > 0.02) r.ry += Math.sign(d) * Math.min(Math.abs(d), dt * 0.9);   // am Bahnende auf der Stelle wenden
					else {
						r.s += r.dir * r.speed * dt;
						if (r.s > r.len) { r.s = r.len; r.dir = -1; } else if (r.s < 0) { r.s = 0; r.dir = 1; }
					}
					const x = r.ax + r.ux * r.s, z = r.az + r.uz * r.s;
					const y = heightAt(x, z), ahead = heightAt(x + Math.sin(r.ry) * 0.6, z + Math.cos(r.ry) * 0.6);
					r.o.position.set(x, y, z);
					r.o.rotation.set(0, r.ry, 0); r.o.rotateX(-Math.atan2(ahead - y, 0.6));
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

/** Kleinster Abstand zweier Strecken in der Bodenebene (Näherung über Stützpunkte) */
function segDist(a: { ax: number; az: number; bx: number; bz: number }, b: { ax: number; az: number; bx: number; bz: number }) {
	let m = Infinity;
	for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
		const t = i / 20, u = j / 20;
		m = Math.min(m, Math.hypot(a.ax + (a.bx - a.ax) * t - (b.ax + (b.bx - b.ax) * u), a.az + (a.bz - a.az) * t - (b.az + (b.bz - b.az) * u)));
	}
	return m;
}
