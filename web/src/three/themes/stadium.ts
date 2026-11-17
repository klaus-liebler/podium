// Stadion bei Flutlicht: Rasen mit Mähstreifen, Laufbahn, Ränge mit jubelndem Publikum (instanziert, La-Ola), Flutlichtmasten,
// Banner und Pokal aus dem Kenney Mini-Arena-Kit. Feuerwerk bei der Siegerehrung.
import {
	BoxGeometry, Color, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh,
	MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, RingGeometry, SpotLight, Sprite, SpriteMaterial,
	AdditiveBlending, DoubleSide, Quaternion, Vector3,
} from "three";
import { model } from "../assets.ts";
import { canvasTex, place, rng, skyDome, type ThemeCtx, type ThemeDef, type ThemeRuntime } from "./common.ts";

const A = 21, B = 14; // Ellipse der Laufbahn-Innenkante

export const stadium: ThemeDef = {
	id: "stadium", label: "Stadion", icon: "🏟️",
	bloom: 0.55, exposure: 1.05,
	cams: {
		lobby: { pos: [-1.9, 2.3, 7.6], look: [-1.9, 0.75, 0], fov: 42 },
		game: { pos: [0, 5.0, 12.5], look: [0, 2.0, -3], fov: 48 },
		podium: { pos: [0, 1.8, 6.2], look: [0, 1.1, 0], fov: 40 },
	},
	lobbyArea: { x0: -0.5, x1: 3.6, z0: -1.8, z1: 2.0 },
	seat: (i) => { const row = Math.floor(i / 12), col = i % 12; return { x: (col - 5.5) * 0.78 + (row % 2) * 0.39, z: -3 - row * 0.85, ry: 0 }; },
	crowd: (i) => { const row = Math.floor(i / 14), k = i % 14; const a = (k / 13 - 0.5) * Math.PI * 0.95, r = 2.7 + row * 0.85; return { x: Math.sin(a) * r * 1.25, z: -Math.cos(a) * r * 0.75 - 0.4, ry: -a * 0.35 }; },
	podium: { x: 0, z: 0, colors: [0xffffff, 0xffffff, 0xffffff], metal: 0.1 },
	async build(ctx: ThemeCtx): Promise<ThemeRuntime> {
		const g = new Group();
		const sky = skyDome(0x0b1640, 0x05081a, { horizon: 0x2a3a78, stars: 0.6 });
		g.add(sky.mesh);
		ctx.scene.background = new Color(0x05081a);
		ctx.scene.fog = new Fog(0x0b1230, 45, 110);

		g.add(new HemisphereLight(0x9fb0ff, 0x1e3a14, 0.6));
		const key = new DirectionalLight(0xffffff, 1.7); key.position.set(10, 16, 8); key.castShadow = true;
		key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, far: 60 }); g.add(key);

		// Rasen mit Streifen + Linien
		const turf = canvasTex(1024, 640, (x, w, h) => {
			for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? "#3f9a3a" : "#4aab42"; x.fillRect(i * w / 16, 0, w / 16 + 1, h); }
			x.strokeStyle = "rgba(255,255,255,.9)"; x.lineWidth = 6;
			x.strokeRect(30, 30, w - 60, h - 60); x.beginPath(); x.moveTo(w / 2, 30); x.lineTo(w / 2, h - 30); x.stroke();
			x.beginPath(); x.arc(w / 2, h / 2, 90, 0, Math.PI * 2); x.stroke();
			x.strokeRect(30, h / 2 - 150, 150, 300); x.strokeRect(w - 180, h / 2 - 150, 150, 300);
		});
		const field = new Mesh(new PlaneGeometry(36, 22.5), new MeshStandardMaterial({ map: turf.tex, roughness: 0.95 }));
		field.rotation.x = -Math.PI / 2; field.receiveShadow = true; g.add(field);
		const track = new Mesh(new RingGeometry(1, 1.22, 96), new MeshStandardMaterial({ color: 0xc0432f, roughness: 0.9, side: DoubleSide }));
		track.rotation.x = -Math.PI / 2; track.scale.set(A, B, 1); track.position.y = -0.01; g.add(track);
		const apron = new Mesh(new RingGeometry(1.22, 1.5, 96), new MeshStandardMaterial({ color: 0x2b6b2a, roughness: 1, side: DoubleSide }));
		apron.rotation.x = -Math.PI / 2; apron.scale.set(A, B, 1); apron.position.y = -0.02; g.add(apron);
		const under = new Mesh(new PlaneGeometry(200, 200), new MeshStandardMaterial({ color: 0x1a2a18, roughness: 1 }));
		under.rotation.x = -Math.PI / 2; under.position.y = -0.03; g.add(under);

		// Ränge (elliptisch, ansteigend) + Publikum (instanziert)
		const tiers = 9, seg = 96;
		const standMat = new MeshStandardMaterial({ color: 0x39405a, roughness: 0.8 });
		const standGeo = new BoxGeometry(1, 1, 1);
		const stands = new InstancedMesh(standGeo, standMat, tiers * seg);
		const fanGeo = new BoxGeometry(0.42, 0.62, 0.32);
		const fans = new InstancedMesh(fanGeo, new MeshStandardMaterial({ roughness: 0.7 }), tiers * seg * 2);
		const fanBase: { pos: Vector3; ry: number; phase: number; ang: number }[] = [];
		const m4 = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), fr = rng(21);
		const teamColors = [0xe63946, 0xf1faee, 0x457b9d, 0xffd166, 0x06d6a0, 0xef476f, 0x8338ec, 0xff9f1c];
		let si = 0, fi = 0;
		for (let t = 0; t < tiers; t++) {
			const ra = A * 1.62 + t * 1.1, rb = B * 1.75 + t * 1.1, y = 0.45 + t * 0.75;
			for (let k = 0; k < seg; k++) {
				const a = (k / seg) * Math.PI * 2, x = Math.cos(a) * ra, z = Math.sin(a) * rb;
				const tangent = Math.atan2(-Math.sin(a) * rb, Math.cos(a) * ra);
				const len = (2 * Math.PI * Math.sqrt((ra * ra + rb * rb) / 2)) / seg + 0.05;
				q.setFromAxisAngle(up, -tangent - Math.PI / 2);
				m4.compose(new Vector3(x, y / 2, z), q, new Vector3(len, y, 1.15)); stands.setMatrixAt(si++, m4);
				if (z > 6 && Math.abs(x) < 9 && t < 6) continue; // Lücke vorne (Kamera)
				for (let s = 0; s < 2; s++) {
					if (fr() < 0.12) continue;
					const off = (s - 0.5) * len * 0.5;
					const pos = new Vector3(x + Math.cos(tangent) * off, y + 0.31, z + Math.sin(tangent) * off);
					const ry = Math.atan2(-x, -z);
					fanBase.push({ pos, ry, phase: fr() * 6, ang: a });
					q.setFromAxisAngle(up, ry); m4.compose(pos, q, new Vector3(1, 1, 1)); fans.setMatrixAt(fi, m4);
					fans.setColorAt(fi, new Color(teamColors[Math.floor(fr() * teamColors.length)])); fi++;
				}
			}
		}
		stands.count = si; fans.count = fi;
		stands.receiveShadow = true; g.add(stands); g.add(fans);

		// Flutlichtmasten
		const glowTex = canvasTex(128, 128, (x) => { const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, "rgba(255,250,220,.6)"); gr.addColorStop(1, "rgba(255,250,220,0)"); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); });
		for (const [x, z] of [[-30, -22], [30, -22], [-30, 22], [30, 22]] as const) {
			const pole = new Mesh(new CylinderGeometry(0.25, 0.4, 20, 8), new MeshStandardMaterial({ color: 0x9aa3b5, metalness: 0.8, roughness: 0.4 }));
			pole.position.set(x, 10, z); g.add(pole);
			const panel = new Mesh(new BoxGeometry(4, 2.2, 0.4), new MeshBasicMaterial({ color: 0xfffbe8, toneMapped: false }));
			panel.position.set(x, 20.5, z); panel.lookAt(0, 0, 0); g.add(panel);
			const glow = new Sprite(new SpriteMaterial({ map: glowTex.tex, blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
			glow.position.copy(panel.position); glow.scale.setScalar(12); g.add(glow);
			const sl = new SpotLight(0xfff6e0, 300, 70, 0.5, 0.6, 1.2); sl.position.copy(panel.position); sl.target.position.set(0, 0, 0); g.add(sl, sl.target);
		}

		// Banner & Statuen (Mini Arena)
		const jobs: Promise<unknown>[] = [];
		const put = (path: string, x: number, z: number, ry: number, s: number) => jobs.push(model(path, { scale: s }).then(o => place(g, o, x, z, ry)));
		for (let i = -3; i <= 3; i++) if (i !== 0) put("arena/banner.glb", i * 3.2, -7.5, 0, 2.2);
		put("arena/statue.glb", -8, -6.5, 0.3, 2.0); put("arena/statue.glb", 8, -6.5, -0.3, 2.0);
		put("arena/column.glb", -4.5, -5.5, 0, 2.0); put("arena/column.glb", 4.5, -5.5, 0, 2.0);
		await Promise.all(jobs);

		// Anzeigetafel
		const board = canvasTex(1024, 256, () => { });
		const scoreboard = new Mesh(new PlaneGeometry(12, 3), new MeshBasicMaterial({ map: board.tex, toneMapped: false }));
		scoreboard.position.set(0, 11, -26); g.add(scoreboard);

		g.add(ctx.fireworks.points);
		ctx.scene.add(g);
		let boardT = 0, excite = 0;
		const dummy = new Object3D();
		return {
			group: g,
			update(dt, st) {
				sky.uniforms.time.value = st.t;
				const want = st.mode === "podium" ? 1 : st.mode === "answering" ? 0.3 + st.tension * 0.5 : st.mode === "reveal" ? 0.6 : 0.15;
				excite += (want - excite) * Math.min(1, dt * 1.5);
				const wave = st.mode === "podium" || st.mode === "lobby";
				for (let i = 0; i < fanBase.length; i++) {
					const f = fanBase[i];
					let jump = Math.max(0, Math.sin(st.t * (5 + excite * 4) + f.phase)) * 0.25 * excite;
					if (wave) { const w = Math.sin(f.ang * 2 - st.t * 2.2); jump += Math.max(0, w) ** 6 * 0.6; }
					dummy.position.set(f.pos.x, f.pos.y + jump, f.pos.z); dummy.rotation.set(0, f.ry, 0); dummy.updateMatrix();
					fans.setMatrixAt(i, dummy.matrix);
				}
				fans.instanceMatrix.needsUpdate = true;
				boardT += dt;
				if (boardT > 0.2) {
					boardT = 0;
					const x = board.ctx; x.fillStyle = "#05070f"; x.fillRect(0, 0, 1024, 256);
					x.font = "700 120px Fredoka, system-ui"; x.textAlign = "center"; x.textBaseline = "middle";
					x.fillStyle = st.mode === "answering" && st.tension > 0.8 ? "#ff4d6d" : "#ffd84d";
					x.fillText(st.mode === "podium" ? "SIEGEREHRUNG" : st.mode === "answering" ? "QUIZ LÄUFT" : "PODIUM", 512, 128);
					board.tex.needsUpdate = true;
				}
			},
			celebrate() { ctx.fireworks.show(0, -16, 10, 30); setTimeout(() => ctx.fireworks.show(0, -14, 8, 26), 2400); },
			dispose() { g.removeFromParent(); turf.tex.dispose(); board.tex.dispose(); glowTex.tex.dispose(); ctx.scene.fog = null; },
		};
	},
};
