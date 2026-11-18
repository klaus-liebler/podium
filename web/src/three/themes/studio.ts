// Gameshow-Studio: Bühne mit LED-Wand, Traversen, Moving Heads mit sichtbaren Lichtkegeln, Lounge-Möbel, Konfetti-Kanonen.
import {
	BoxGeometry, CircleGeometry, Color, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial,
	MeshStandardMaterial, PlaneGeometry, SpotLight, TorusGeometry, type Object3D,
} from "three";
import { model } from "../assets.ts";
import { beam, canvasTex, place, type ThemeCtx, type ThemeDef, type ThemeRuntime, type ThemeState } from "./common.ts";

const BG = 0x07051a;

function truss(len: number) {
	const g = new Group(), m = new MeshStandardMaterial({ color: 0xb8bcc8, metalness: 0.9, roughness: 0.3 });
	const r = 0.025, s = 0.32;
	for (const [y, z] of [[0, 0], [s, 0], [0, s], [s, s]]) {
		const c = new Mesh(new CylinderGeometry(r, r, len, 6), m); c.rotation.z = Math.PI / 2; c.position.set(0, y, z); g.add(c);
	}
	const n = Math.floor(len / s);
	for (let i = 0; i < n; i++) {
		const d = new Mesh(new CylinderGeometry(r * 0.6, r * 0.6, s * 1.42, 4), m);
		d.position.set(-len / 2 + (i + 0.5) * s, s / 2, 0); d.rotation.z = (i % 2 ? 1 : -1) * Math.PI / 4; g.add(d);
		const d2 = d.clone(); d2.position.z = s; g.add(d2);
	}
	return g;
}

export const studio: ThemeDef = {
	id: "studio", label: "Gameshow-Studio", icon: "🎤",
	bloom: 0.75, exposure: 1.0,
	cams: {
		lobby: { pos: [-1.9, 2.3, 7.6], look: [-1.9, 0.75, 0], fov: 42 },
		game: { pos: [0, 3.0, 10.5], look: [0, 1.8, -2], fov: 46 },
		podium: { pos: [0, 1.75, 6.0], look: [0, 1.05, 0], fov: 40 },
	},
	lobbyArea: { x0: -0.5, x1: 3.6, z0: -1.8, z1: 2.0 },
	seat: (i) => { const row = Math.floor(i / 12), col = i % 12; return { x: (col - 5.5) * 0.8 + (row % 2) * 0.4, z: -2.6 - row * 0.85, ry: 0 }; },
	crowd: (i) => { const row = Math.floor(i / 14), k = i % 14; const a = (k / 13 - 0.5) * Math.PI * 0.95, r = 2.7 + row * 0.85; return { x: Math.sin(a) * r * 1.25, z: -Math.cos(a) * r * 0.75 - 0.4, ry: -a * 0.35 }; },
	podium: { x: 0, z: 0, colors: [0xffcf3f, 0xc8d0e0, 0xd98a4e], metal: 0.75 },
	async build(ctx: ThemeCtx): Promise<ThemeRuntime> {
		const g = new Group();
		ctx.scene.background = new Color(BG);
		ctx.scene.fog = new Fog(BG, 16, 42);

		g.add(new HemisphereLight(0x8a7cff, 0x12081f, 0.75));
		const key = new DirectionalLight(0xffffff, 1.3); key.position.set(4, 9, 7); key.castShadow = true;
		key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10 }); g.add(key);

		// Boden + Bühne
		const floor = new Mesh(new CircleGeometry(40, 64), new MeshStandardMaterial({ color: 0x120c2c, roughness: 0.28, metalness: 0.5 }));
		floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
		const stage = new Mesh(new CircleGeometry(6.2, 64), new MeshStandardMaterial({ color: 0x1d1546, roughness: 0.22, metalness: 0.4 }));
		stage.rotation.x = -Math.PI / 2; stage.position.y = 0.005; stage.receiveShadow = true; g.add(stage);
		const ledMat = new MeshBasicMaterial({ color: 0xff3fd0, toneMapped: false });
		const ring = new Mesh(new TorusGeometry(6.2, 0.05, 8, 160), ledMat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.03; g.add(ring);
		const ring2 = new Mesh(new TorusGeometry(2.4, 0.03, 8, 120), new MeshBasicMaterial({ color: 0x3fd8ff, toneMapped: false })); ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.02; g.add(ring2);

		// LED-Wand (animierte Canvas-Textur)
		const led = canvasTex(1024, 384, () => { });
		const wall = new Mesh(new PlaneGeometry(17, 6.4), new MeshBasicMaterial({ map: led.tex, toneMapped: false }));
		wall.position.set(0, 3.4, -7.5); g.add(wall);
		const frame = new Mesh(new BoxGeometry(17.4, 6.8, 0.2), new MeshStandardMaterial({ color: 0x0b0918, metalness: 0.6, roughness: 0.4 }));
		frame.position.set(0, 3.4, -7.62); g.add(frame);
		// LED-Säulen
		const pillars: Mesh[] = [];
		for (const x of [-10, -7.2, 7.2, 10]) {
			const p = new Mesh(new BoxGeometry(0.5, 6.5, 0.5), new MeshBasicMaterial({ color: 0x6f3cff, toneMapped: false }));
			p.position.set(x, 3.25, -5.8); g.add(p); pillars.push(p);
		}

		// Traversen + Moving Heads
		const tr = truss(20); tr.position.set(0, 7, -3.2); g.add(tr);
		for (const x of [-10, 10]) { const post = truss(7); post.rotation.z = Math.PI / 2; post.position.set(x, 3.5, -3.2); g.add(post); }
		const tr2 = truss(16); tr2.position.set(0, 6.2, 3.5); g.add(tr2);
		const heads: { pivot: Group; beam: ReturnType<typeof beam>; phase: number; x: number; a?: number }[] = [];
		const beamColors = [0xff4fd8, 0x4fd8ff, 0xffd84f, 0x7c5cff, 0x4fffb0, 0xff7a4f];
		const xs = [-8, -4.8, -1.6, 1.6, 4.8, 8];
		xs.forEach((x, i) => {
			// Lichtkegel reichen bis zum Boden – sie dürfen nicht als Hindernis für die Figuren gelten
			const pivot = new Group(); pivot.position.set(x, 6.85, -3.0); pivot.userData.noCollide = true; g.add(pivot);
			const body = new Mesh(new CylinderGeometry(0.16, 0.2, 0.35, 12), new MeshStandardMaterial({ color: 0x1b1b24, metalness: 0.7, roughness: 0.3 }));
			body.position.y = -0.15; pivot.add(body);
			const b = beam(beamColors[i], 9, 1.35); b.mesh.position.y = -0.3; pivot.add(b.mesh);
			heads.push({ pivot, beam: b, phase: i * 1.1, x });
		});
		const spots = [-3, 3].map(x => { const s = new SpotLight(0xffffff, 0, 30, 0.35, 0.6, 1.2); s.position.set(x, 6.8, 3.5); s.target.position.set(0, 0, 0); s.castShadow = false; g.add(s, s.target); return s; });

		// Möbel / Deko (Kenney Furniture Kit)
		const deco: Promise<unknown>[] = [];
		const put = (path: string, x: number, z: number, ry: number, s: number) => deco.push(model(path, { scale: s }).then(o => place(g, o, x, z, ry)));
		put("furniture/loungeDesignSofa.glb", -8.6, 1.4, Math.PI / 2.3, 2.0);
		put("furniture/loungeDesignSofa.glb", 7.4, 2.8, -Math.PI / 2.3, 2.0);
		put("furniture/tableCoffeeGlass.glb", -7.2, 2.2, 0.4, 1.8);
		put("furniture/pottedPlant.glb", -9.4, -1.5, 0, 2.6); put("furniture/pottedPlant.glb", 9.6, -1.2, 0, 2.6);
		put("furniture/lampRoundFloor.glb", -9.8, 3.4, 0, 2.2); put("furniture/lampRoundFloor.glb", 9.2, 4.2, 0, 2.2);
		for (const [x, z] of [[-6.8, -4.6], [6.6, -4.6]] as const) put("furniture/speaker.glb", x, z, 0, 3.2);
		put("furniture/televisionModern.glb", -6.4, 4.6, 0.7, 2.2);
		await Promise.all(deco);

		// Konfetti-Kanonen
		const cannons: Object3D[] = [];
		for (const x of [-5.4, 5.4]) {
			const c = new Mesh(new CylinderGeometry(0.16, 0.22, 0.9, 16), new MeshStandardMaterial({ color: 0xd0d4e0, metalness: 0.9, roughness: 0.25 }));
			c.position.set(x, 0.45, 1.2); c.rotation.z = x < 0 ? -0.35 : 0.35; c.castShadow = true; g.add(c); cannons.push(c);
		}

		ctx.scene.add(g);
		let ledT = 0, flash = 0;
		const drawLed = (st: ThemeState) => {
			const x = led.ctx, W = 1024, H = 384, t = st.t;
			const hot = st.mode === "answering" ? st.tension : 0;
			const grad = x.createLinearGradient(0, 0, W, H);
			grad.addColorStop(0, `hsl(${265 - hot * 260}, 80%, ${18 + flash * 30}%)`);
			grad.addColorStop(1, `hsl(${310 - hot * 290}, 85%, ${12 + flash * 25}%)`);
			x.fillStyle = grad; x.fillRect(0, 0, W, H);
			// Equalizer-Balken
			const n = 48;
			for (let i = 0; i < n; i++) {
				const v = 0.25 + 0.75 * Math.abs(Math.sin(t * (1.3 + hot * 4) + i * 0.55) * Math.sin(t * 0.7 + i * 0.21));
				const h = v * H * (0.35 + hot * 0.4 + st.pulse * 0.2);
				x.fillStyle = `hsla(${(i * 7 + t * 40) % 360}, 90%, 62%, .55)`;
				x.fillRect(i * (W / n) + 3, H - h, W / n - 6, h);
			}
			x.font = "700 120px Fredoka, system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
			x.fillStyle = "rgba(255,255,255,.92)"; x.shadowColor = "rgba(255,80,220,.9)"; x.shadowBlur = 30;
			x.fillText(st.mode === "podium" ? "SIEGEREHRUNG" : "PODIUM", W / 2, H / 2 - 20);
			x.shadowBlur = 0;
			led.tex.needsUpdate = true;
		};

		return {
			group: g,
			update(dt, st) {
				// ruhiges Schwenken; zum Ende der Antwortzeit nur leicht schneller
				const speed = 0.13 + (st.mode === "answering" ? st.tension * 0.3 : 0) + (st.mode === "podium" ? 0.05 : 0);
				heads.forEach((h, i) => {
					h.a = (h.a ?? h.phase) + dt * speed; const a = h.a; // Phase integrieren: Tempowechsel ohne Sprung
					const k = Math.min(1, dt * 1.5);
					if (st.mode === "podium" && flash > 0.05) { h.pivot.rotation.z += ((h.x > 0 ? 0.35 : -0.35) * Math.min(1, Math.abs(h.x) / 6) - h.pivot.rotation.z) * k; h.pivot.rotation.x += (0.35 - h.pivot.rotation.x) * k; }
					else { h.pivot.rotation.z += (Math.sin(a) * 0.5 - h.pivot.rotation.z) * k; h.pivot.rotation.x += (0.35 + Math.cos(a * 0.8) * 0.25 - h.pivot.rotation.x) * k; }
					const hot = st.mode === "answering" ? st.tension : 0;
					h.beam.setColor(new Color(beamColors[i]).lerp(new Color(0xff2a4a), hot * hot));
					h.beam.setIntensity((st.mode === "podium" ? 0.3 : 0.45) + st.pulse * 0.3 + flash * 0.3);
				});
				(ledMat.color as Color).setHSL((st.t * 0.05) % 1, 0.9, 0.6);
				pillars.forEach((p, i) => (p.material as MeshBasicMaterial).color.setHSL((st.t * 0.08 + i * 0.12) % 1, 0.85, 0.45 + st.pulse * 0.2));
				spots.forEach(s => { s.intensity += ((st.mode === "podium" ? 18 : 0) - s.intensity) * Math.min(1, dt * 2); });
				flash = Math.max(0, flash - dt * 0.25);
				ledT += dt; if (ledT > 1 / 30) { ledT = 0; drawLed(st); }
			},
			celebrate() {
				flash = 1;
				cannons.forEach((c, i) => setTimeout(() => ctx.burst({ x: c.position.x, y: 1.0, z: c.position.z }, 260, 0.9), i * 150));
				setTimeout(() => cannons.forEach(c => ctx.burst({ x: c.position.x, y: 1.0, z: c.position.z }, 180, 0.8)), 1400);
			},
			dispose() { g.removeFromParent(); led.tex.dispose(); ctx.scene.fog = null; },
		};
	},
};
