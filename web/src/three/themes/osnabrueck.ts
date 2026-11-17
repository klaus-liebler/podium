// Osnabrück: Marktplatz mit Rathaus des Westfälischen Friedens (Freitreppe, steiles Schieferdach, Dachreiter), Marienkirche
// (Westturm mit Kupferspitze), Dom St. Peter (zwei ungleiche Westtürme, achteckiger Vierungsturm), Stadtwaage mit Treppengiebel
// und bunten Giebelhäusern. Stilisiert im Low-Poly-Look der Kenney-Kits – eigene Geometrie, keine fremden Modelle.
import {
	BoxGeometry, BufferGeometry, CircleGeometry, Float32BufferAttribute, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, ExtrudeGeometry, Fog, Group,
	HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, Quaternion, RepeatWrapping, Shape,
	SphereGeometry, Vector3, type Material,
} from "three";
import { model } from "../assets.ts";
import { canvasTex, place, rng, skyDome, type ThemeCtx, type ThemeDef, type ThemeRuntime } from "./common.ts";

// ---------------------------------------------------------------- Material & Bausteine
const mats = new Map<number, MeshStandardMaterial>();
const M = (c: number, rough = 0.9, metal = 0) => {
	const k = c * 10 + Math.round(rough * 10) + metal * 1000;
	let m = mats.get(k);
	if (!m) { m = new MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, flatShading: true }); mats.set(k, m); }
	return m;
};
const SAND = 0xd8c49a, SAND_DUNKEL = 0xc2ab7d, DOMSTEIN = 0xcdb98f, SCHIEFER = 0x3d4350, KUPFER = 0x5fa88c, FENSTER = 0x2a3140;

function mesh(geo: ConstructorParameters<typeof Mesh>[0], mat: Material, x = 0, y = 0, z = 0) {
	const m = new Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m;
}
/** Quader, Unterkante auf y */
function box(g: Object3D, w: number, h: number, d: number, mat: Material, x = 0, y = 0, z = 0) {
	const m = mesh(new BoxGeometry(w, h, d), mat, x, y + h / 2, z); g.add(m); return m;
}
/** Satteldach: First entlang x, Traufe bei y */
function gable(g: Object3D, w: number, d: number, h: number, mat: Material, x = 0, y = 0, z = 0, overhang = 0.15) {
	const s = new Shape(); s.moveTo(-d / 2 - overhang, 0); s.lineTo(d / 2 + overhang, 0); s.lineTo(0, h); s.closePath();
	const geo = new ExtrudeGeometry(s, { depth: w + overhang * 2, bevelEnabled: false });
	geo.translate(0, 0, -(w + overhang * 2) / 2); geo.rotateY(Math.PI / 2);
	const m = mesh(geo, mat, x, y, z); g.add(m); return m;
}
/** Walmdach: Traufe w×d auf Höhe y, First (Länge w-2·inset) in Höhe h darüber */
function hipRoof(g: Object3D, w: number, d: number, h: number, inset: number, mat: Material, y: number) {
	const x0 = w / 2, z0 = d / 2, xr = w / 2 - inset;
	const v = [
		[-x0, 0, z0], [x0, 0, z0], [xr, h, 0], [-xr, h, 0],     // vordere Dachfläche
		[x0, 0, -z0], [-x0, 0, -z0], [-xr, h, 0], [xr, h, 0],   // hintere Dachfläche
	];
	const p: number[] = [];
	const quad = (a: number[], b: number[], c: number[], e: number[]) => p.push(...a, ...b, ...c, ...a, ...c, ...e);
	quad(v[0], v[1], v[2], v[3]); quad(v[4], v[5], v[6], v[7]);
	p.push(x0, 0, z0, x0, 0, -z0, xr, h, 0);      // Walm rechts
	p.push(-x0, 0, -z0, -x0, 0, z0, -xr, h, 0);   // Walm links
	const geo = new BufferGeometry(); geo.setAttribute("position", new Float32BufferAttribute(p, 3)); geo.computeVertexNormals();
	const m = mesh(geo, mat, 0, y, 0); g.add(m); return m;
}
/** Pyramiden-/Turmdach (4- oder 8-seitig) */
function spire(g: Object3D, r: number, h: number, mat: Material, x = 0, y = 0, z = 0, seg = 4) {
	const geo = new ConeGeometry(r, h, seg); if (seg === 4) geo.rotateY(Math.PI / 4);
	const m = mesh(geo, mat, x, y + h / 2, z); g.add(m);
	const ball = mesh(new SphereGeometry(Math.max(0.06, r * 0.08), 8, 6), M(0xe8c45a, 0.4, 0.6), x, y + h + 0.05, z); g.add(ball);
	return m;
}
/** Fenster auf der Vorderseite (+z) einer Wand bei z; gotisch = spitz, romanisch = rund */
function windows(g: Object3D, count: number, width: number, y: number, z: number, w: number, h: number, kind: "rect" | "round" | "gothic" = "rect", cx = 0) {
	const s = new Shape();
	if (kind === "rect") { s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); }
	else if (kind === "round") { s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - w / 2); s.absarc(0, h - w / 2, w / 2, 0, Math.PI, false); }
	else { s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h - w * 0.9); s.quadraticCurveTo(w / 2, h - w * 0.2, 0, h); s.quadraticCurveTo(-w / 2, h - w * 0.2, -w / 2, h - w * 0.9); }
	s.closePath();
	const geo = new ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false });
	for (let i = 0; i < count; i++) {
		const x = cx + (count === 1 ? 0 : -width / 2 + (i + 0.5) * (width / count));
		const m = new Mesh(geo, M(FENSTER, 0.3, 0.2)); m.position.set(x, y, z); g.add(m);
		const sill = new Mesh(new BoxGeometry(w * 1.25, 0.06, 0.1), M(0xece2c8)); sill.position.set(x, y - 0.02, z + 0.04); g.add(sill);
	}
}
/** Treppengiebel als Fassadenscheibe (Vorderseite bei z) */
function steppedGable(g: Object3D, w: number, h: number, steps: number, mat: Material, y: number, z: number, x = 0) {
	const s = new Shape(); const sw = w / (steps * 2 + 1), sh = h / (steps + 1);
	s.moveTo(-w / 2, 0);
	let cx = -w / 2, cy = 0;
	for (let i = 0; i < steps; i++) { cy += sh; s.lineTo(cx, cy); cx += sw; s.lineTo(cx, cy); }
	cy += sh; s.lineTo(cx, cy); s.lineTo(-cx, cy);
	for (let i = 0; i < steps; i++) { cy -= sh; s.lineTo(-cx, cy + sh); s.lineTo(-cx, cy); cx += sw; }
	s.lineTo(w / 2, 0); s.closePath();
	const geo = new ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false });
	const m = mesh(geo, mat, x, y, z - 0.3); g.add(m); return m;
}

// ---------------------------------------------------------------- Gebäude (lokal: Front zeigt nach +z, Mitte bei x=0, Boden y=0)
function rathaus() {
	const g = new Group();
	const W = 7.2, D = 4.6, H = 6.2;
	box(g, W, H, D, M(SAND));
	box(g, W + 0.2, 0.6, D + 0.2, M(SAND_DUNKEL));                               // Sockel
	box(g, W + 0.1, 0.18, D + 0.1, M(SAND_DUNKEL), 0, H - 0.18);                 // Traufgesims
	// steiles Walmdach
	hipRoof(g, W + 0.3, D + 0.3, 5.2, 1.1, M(SCHIEFER, 0.7), H);
	// Dachgauben
	for (let i = -1; i <= 1; i++) { box(g, 0.7, 0.8, 0.8, M(SCHIEFER, 0.7), i * 1.8, H + 1.0, D / 2 - 0.9); windows(g, 1, 0.7, H + 1.15, D / 2 - 0.48, 0.35, 0.45); gable(g, 0.8, 0.9, 0.5, M(SCHIEFER, 0.7), i * 1.8, H + 1.8, D / 2 - 0.9).rotation.y = Math.PI / 2; }
	// Dachreiter mit Kupferhelm
	box(g, 0.7, 1.2, 0.7, M(SAND), 0, H + 4.6, 0);
	spire(g, 0.6, 2.4, M(KUPFER, 0.6, 0.3), 0, H + 5.8, 0, 8);
	// Fassade: zwei Reihen hoher gotischer Fenster, Portal, Figurennischen
	windows(g, 5, W - 1.2, 1.4, D / 2, 0.75, 1.9, "gothic");
	windows(g, 5, W - 1.2, 3.7, D / 2, 0.75, 1.9, "gothic");
	const portal = new Shape(); portal.moveTo(-0.7, 0); portal.lineTo(0.7, 0); portal.lineTo(0.7, 1.4); portal.absarc(0, 1.4, 0.7, 0, Math.PI, false); portal.closePath();
	g.add(mesh(new ExtrudeGeometry(portal, { depth: 0.05, bevelEnabled: false }), M(0x4a3426, 0.8), 0, 0.6, D / 2));
	for (let i = 0; i < 4; i++) { const x = -W / 2 + 0.6 + (i + 0.5) * ((W - 1.2) / 5) + (W - 1.2) / 10; box(g, 0.22, 0.6, 0.2, M(0xe9dcc0), x, 3.05, D / 2 + 0.05); }
	// Freitreppe
	for (let i = 0; i < 5; i++) box(g, 4.2 - i * 0.25, 0.12, 0.45, M(SAND_DUNKEL), 0, i * 0.12, D / 2 + 2.25 - i * 0.45);
	box(g, 3.0, 0.6, 0.9, M(SAND_DUNKEL), 0, 0, D / 2 + 0.45);
	return g;
}

function kirche(opts: { w: number; d: number; h: number; roof: number; stone: number; win: "gothic" | "round" }) {
	const g = new Group();
	box(g, opts.w, opts.h, opts.d, M(opts.stone));
	gable(g, opts.d, opts.w, opts.roof, M(SCHIEFER, 0.7), 0, opts.h).rotation.y = Math.PI / 2;
	// Seitenfenster (beide Längsseiten)
	for (const sx of [-1, 1]) {
		const side = new Group(); side.rotation.y = sx * Math.PI / 2; side.position.x = sx * opts.w / 2;
		windows(side, Math.round(opts.d / 2), opts.d - 1.5, 1.2, 0, 0.7, opts.h * 0.62, opts.win);
		g.add(side);
	}
	return g;
}

function marienkirche() {
	const g = kirche({ w: 6, d: 11, h: 6, roof: 4.2, stone: SAND_DUNKEL, win: "gothic" });
	// Westturm (vorne, +z) mit hoher Kupferspitze
	const t = new Group(); t.position.z = 6.4; g.add(t);
	box(t, 2.6, 11, 2.6, M(SAND_DUNKEL));
	box(t, 2.8, 0.25, 2.8, M(SAND), 0, 11);
	windows(t, 1, 1, 7.5, 1.3, 0.8, 2.0, "gothic");
	windows(t, 1, 1, 3.5, 1.3, 0.9, 2.4, "gothic");
	const clock = mesh(new CylinderGeometry(0.55, 0.55, 0.08, 24), M(0xf4ecd6, 0.5), 0, 10.0, 1.34); clock.rotation.x = Math.PI / 2; t.add(clock);
	const zeiger = mesh(new BoxGeometry(0.05, 0.4, 0.03), M(0x222222), 0, 10.15, 1.4); t.add(zeiger);
	spire(t, 1.55, 8.5, M(KUPFER, 0.6, 0.3), 0, 11.25, 0, 8);
	return g;
}

function dom() {
	const g = kirche({ w: 6.5, d: 15, h: 7, roof: 4.6, stone: DOMSTEIN, win: "round" });
	// Querhaus
	box(g, 12, 6.8, 4.5, M(DOMSTEIN), 0, 0, -1.5);
	gable(g, 12, 4.5, 4.4, M(SCHIEFER, 0.7), 0, 6.8, -1.5);
	// achteckiger Vierungsturm
	const v = mesh(new CylinderGeometry(1.7, 1.8, 3.2, 8), M(DOMSTEIN), 0, 7 + 3.2 / 2 + 2.4, -1.5); g.add(v);
	spire(g, 1.9, 4.2, M(KUPFER, 0.6, 0.3), 0, 7 + 2.4 + 3.2, -1.5, 8);
	// Westwerk: großer Südturm (rechts) und schlanker Nordturm (links) – typisch ungleich
	const west = 8.3;
	box(g, 7.2, 8, 2.2, M(DOMSTEIN), 0, 0, west - 0.8);
	box(g, 3.6, 13.5, 3.6, M(DOMSTEIN), 1.9, 0, west);            // Südturm, massig
	spire(g, 2.7, 5.2, M(KUPFER, 0.6, 0.3), 1.9, 13.5, west);
	box(g, 2.3, 15.5, 2.3, M(DOMSTEIN), -2.4, 0, west);           // Nordturm, schlank
	spire(g, 1.75, 4.6, M(KUPFER, 0.6, 0.3), -2.4, 15.5, west);
	windows(g, 1, 1, 2.0, west + 1.8, 1.4, 3.0, "round", 1.9);    // Rosette/Portal-Bereich
	windows(g, 1, 1, 9.5, west + 1.8, 0.9, 1.6, "round", 1.9);
	windows(g, 1, 1, 11.0, west + 1.16, 0.6, 1.4, "round", -2.4);
	const rose = mesh(new CylinderGeometry(0.8, 0.8, 0.06, 20), M(FENSTER, 0.3, 0.2), 1.9, 6.6, west + 1.82); rose.rotation.x = Math.PI / 2; g.add(rose);
	return g;
}

function stadtwaage() {
	const g = new Group();
	box(g, 4, 5, 6, M(SAND));
	gable(g, 6, 4, 3.6, M(0x8e4a3a, 0.8), 0, 5).rotation.y = Math.PI / 2;
	steppedGable(g, 4, 3.6, 3, M(SAND), 5, 3.02);
	windows(g, 3, 3.2, 1.0, 3, 0.6, 1.2, "rect");
	windows(g, 3, 3.2, 3.0, 3, 0.6, 1.2, "rect");
	windows(g, 2, 1.8, 5.8, 3.02, 0.4, 0.8, "rect");
	return g;
}

const HAUS_FARBEN = [0xe8b4a0, 0xf2dc9b, 0xb9d3c4, 0xd7c4e6, 0xf0c48a, 0xc7dbe8, 0xe8a8a8, 0xf3ead2];
function giebelhaus(i: number, w = 2.3) {
	const g = new Group(); const r = rng(100 + i);
	const h = 4.2 + r() * 1.6, d = 4, c = HAUS_FARBEN[i % HAUS_FARBEN.length];
	box(g, w, h, d, M(c));
	gable(g, d, w, 2.6, M(r() < 0.5 ? 0x8e4a3a : SCHIEFER, 0.8), 0, h).rotation.y = Math.PI / 2;
	if (r() < 0.6) steppedGable(g, w, 2.6, 2, M(c), h, d / 2 + 0.02);
	else { const s = new Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, 2.6); s.closePath(); g.add(mesh(new ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false }), M(c), 0, h, d / 2 - 0.08)); }
	const rows = Math.floor((h - 1.2) / 1.25);
	for (let k = 0; k < rows; k++) windows(g, 2, w - 0.6, 1.4 + k * 1.25, d / 2, 0.45, 0.8, "rect");
	windows(g, 1, 1, h + 0.7, d / 2 + 0.06, 0.35, 0.6, "rect");
	box(g, w * 0.7, 1.0, 0.06, M(0x3b2c24), 0, 0.05, d / 2 + 0.01);           // Laden/Eingang
	box(g, w * 0.8, 0.08, 0.5, M(r() < 0.5 ? 0xc0392b : 0x2e7d5b, 0.6), 0, 1.15, d / 2 + 0.25); // Markise
	return g;
}

export const osnabrueck: ThemeDef = {
	id: "osnabrueck", label: "Osnabrück", icon: "⛪",
	bloom: 0.3, exposure: 1.05,
	cams: {
		lobby: { pos: [-1.9, 2.4, 7.8], look: [-1.9, 1.4, 0], fov: 44 },
		game: { pos: [0, 4.5, 13], look: [0, 3.2, -4], fov: 48 },
		podium: { pos: [0, 1.9, 6.3], look: [0, 1.25, 0], fov: 42 },
	},
	lobbyArea: { x0: -0.5, x1: 3.6, z0: -1.8, z1: 2.0 },
	seat: (i) => { const row = Math.floor(i / 12), col = i % 12; return { x: (col - 5.5) * 0.78 + (row % 2) * 0.39, z: -2.6 - row * 0.8, ry: 0 }; },
	crowd: (i) => { const row = Math.floor(i / 14), k = i % 14; const a = (k / 13 - 0.5) * Math.PI * 0.95, r = 2.7 + row * 0.85; return { x: Math.sin(a) * r * 1.25, z: -Math.cos(a) * r * 0.6 - 0.2, ry: -a * 0.35 }; },
	podium: { x: 0, z: 0, colors: [0xe9c75a, 0xd3d8e0, 0xc98a55], metal: 0.55 },
	async build(ctx: ThemeCtx): Promise<ThemeRuntime> {
		const g = new Group();
		const sky = skyDome(0x4f95db, 0xa9d2f5, { horizon: 0xeaf4ff });
		g.add(sky.mesh);
		ctx.scene.background = new Color(0xa9d2f5);
		ctx.scene.fog = new Fog(0xdcebf7, 45, 130);
		g.add(new HemisphereLight(0xdfeeff, 0x8a7d66, 1.0));
		const sun = new DirectionalLight(0xfff0d6, 2.1); sun.position.set(10, 16, 9); sun.castShadow = true;
		sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, far: 80 }); g.add(sun);

		// Kopfsteinpflaster (Marktplatz) und Umgebung
		const pflaster = canvasTex(512, 512, (x, w) => {
			x.fillStyle = "#9a9081"; x.fillRect(0, 0, w, w);
			const r = rng(5);
			for (let yy = 0; yy < w; yy += 16) for (let xx = (yy / 16) % 2 ? 8 : 0; xx < w; xx += 16) {
				const v = 140 + r() * 50; x.fillStyle = `rgb(${v},${v - 8},${v - 20})`;
				x.beginPath(); x.roundRect(xx + 1, yy + 1, 14, 14, 4); x.fill();
			}
		});
		pflaster.tex.wrapS = pflaster.tex.wrapT = RepeatWrapping; pflaster.tex.repeat.set(14, 14);
		const boden = new Mesh(new PlaneGeometry(90, 90), new MeshStandardMaterial({ map: pflaster.tex, roughness: 0.95 }));
		boden.rotation.x = -Math.PI / 2; boden.receiveShadow = true; g.add(boden);
		const platz = new Mesh(new CircleGeometry(4.2, 48), new MeshStandardMaterial({ color: 0xb8ad98, roughness: 0.9 }));
		platz.rotation.x = -Math.PI / 2; platz.position.y = 0.01; platz.receiveShadow = true; g.add(platz);

		// Wahrzeichen
		const r1 = rathaus(); place(g, r1, 0.5, -10.5, 0);
		const mk = marienkirche(); place(g, mk, -8.5, -15.5, 0.25);
		const d = dom(); place(g, d, 9.5, -21, -0.35);
		const sw = stadtwaage(); place(g, sw, 7.3, -9.5, -0.25);
		// Giebelhäuser rechts (Blick zum Platz) und links
		for (let i = 0; i < 6; i++) place(g, giebelhaus(i), 11.5, -4.5 + i * 2.45, -Math.PI / 2);
		for (let i = 0; i < 5; i++) place(g, giebelhaus(i + 6), -12, -1.5 + i * 2.45, Math.PI / 2);
		for (let i = 0; i < 4; i++) place(g, giebelhaus(i + 11, 2.2), -5.5 + i * 2.3 + (i > 1 ? 9.5 : 0), 9.5 + (i % 2) * 0.3, Math.PI);

		// Häuserkulisse im Hintergrund (instanziert: Körper + Dächer)
		const N = 70, r = rng(77);
		const koerper = new InstancedMesh(new BoxGeometry(1, 1, 1), M(0xffffff), N);
		const daecher = new InstancedMesh(new ConeGeometry(0.75, 1, 4), M(0x8e4a3a, 0.8), N);
		const m4 = new Matrix4(), q = new Quaternion(), col = new Color();
		let n = 0;
		for (let k = 0; k < N * 3 && n < N; k++) {
			const a = r() * Math.PI * 2, dist = 26 + r() * 22, x = Math.sin(a) * dist, z = Math.cos(a) * dist - 6;
			if (z > 8) continue;
			const w = 3 + r() * 3, h = 4 + r() * 6, dd = 4 + r() * 3, ry = -a + (r() - 0.5) * 0.4;
			q.setFromAxisAngle(new Vector3(0, 1, 0), ry);
			m4.compose(new Vector3(x, h / 2, z), q, new Vector3(w, h, dd)); koerper.setMatrixAt(n, m4);
			koerper.setColorAt(n, col.setHex(HAUS_FARBEN[n % HAUS_FARBEN.length]).multiplyScalar(0.92));
			q.setFromAxisAngle(new Vector3(0, 1, 0), ry + Math.PI / 4);
			m4.compose(new Vector3(x, h + 1.4, z), q, new Vector3(w * 0.95, 2.8, dd * 0.95)); daecher.setMatrixAt(n, m4);
			n++;
		}
		koerper.count = daecher.count = n; koerper.castShadow = daecher.castShadow = true;
		g.add(koerper, daecher);

		// Bäume, Bänke, Laternen, Wimpelketten
		const jobs: Promise<unknown>[] = [];
		for (const [x, z] of [[-6.5, -5.5], [6.2, -5.8], [-8.5, 4.5], [8.6, 5.2], [-15, -4], [16, 1]] as const)
			jobs.push(model("nature/tree_oak.glb", { scale: 2.6 }).then(o => place(g, o, x, z, x)));
		for (const [x, z, ry] of [[-4.6, 3.6, 0.4], [4.8, 3.4, -0.4]] as const)
			jobs.push(model("city-suburban/planter.glb", { scale: 3 }).then(o => place(g, o, x, z, ry)));
		await Promise.all(jobs);
		for (const [x, z] of [[-4.5, -3], [4.5, -3], [-5.5, 2.5], [5.5, 2.5]] as const) {
			box(g, 0.1, 2.6, 0.1, M(0x2b2f36, 0.5, 0.6), x, 0, z);
			box(g, 0.32, 0.4, 0.32, M(0xfff1c4, 0.4), x, 2.6, z);
			spire(g, 0.28, 0.3, M(0x2b2f36, 0.5, 0.6), x, 3.0, z);
		}
		const wimpel: Mesh[] = [];
		const wimpelGeo = new ConeGeometry(0.16, 0.36, 3); wimpelGeo.rotateX(Math.PI);
		for (const [ax, az, bx, bz] of [[-4.5, -3, 4.5, -3], [-5.5, 2.5, -4.5, -3], [5.5, 2.5, 4.5, -3]] as const) {
			for (let k = 1; k < 12; k++) {
				const t = k / 12, x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = 2.85 - Math.sin(t * Math.PI) * 0.6;
				const w = new Mesh(wimpelGeo, M(k % 2 ? 0xd62828 : 0xf8f4ea, 0.7)); w.position.set(x, y - 0.18, z); w.material.side = DoubleSide;
				g.add(w); wimpel.push(w);
			}
		}

		// Schild
		const schild = canvasTex(512, 128, (x, w, h) => {
			x.fillStyle = "#f6f1e3"; x.fillRect(0, 0, w, h); x.strokeStyle = "#7b1e1e"; x.lineWidth = 10; x.strokeRect(5, 5, w - 10, h - 10);
			x.font = "600 50px Fredoka, system-ui"; x.fillStyle = "#7b1e1e"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("Markt · Osnabrück", w / 2, h / 2 + 2);
		});
		const sm = new Mesh(new PlaneGeometry(2.6, 0.65), new MeshStandardMaterial({ map: schild.tex, roughness: 0.6 }));
		sm.position.set(-6.2, 2.2, -1.5); sm.rotation.y = 0.6; g.add(sm);
		box(g, 0.08, 2.2, 0.08, M(0x444a55, 0.5, 0.5), -6.2 - Math.cos(0.6) * 1.2, 0, -1.5 + Math.sin(0.6) * 1.2);
		box(g, 0.08, 2.2, 0.08, M(0x444a55, 0.5, 0.5), -6.2 + Math.cos(0.6) * 1.2, 0, -1.5 - Math.sin(0.6) * 1.2);

		g.add(ctx.fireworks.points);
		ctx.scene.add(g);
		return {
			group: g,
			update(dt, st) {
				sky.uniforms.time.value = st.t;
				for (let i = 0; i < wimpel.length; i++) wimpel[i].rotation.x = Math.sin(st.t * 2.4 + i * 0.7) * 0.25;
				void dt;
			},
			celebrate() {
				ctx.fireworks.show(0, -14, 8, 22);
				setTimeout(() => ctx.fireworks.show(-10, -16, 5, 10), 1500);
				setTimeout(() => ctx.fireworks.show(12, -20, 5, 10), 2600);
			},
			dispose() { g.removeFromParent(); pflaster.tex.dispose(); schild.tex.dispose(); ctx.scene.fog = null; },
		};
	},
};
