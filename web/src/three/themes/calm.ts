// Ruhige Bühne: für Grundschulen und neurodivergente Kinder. Abstrakt, gedämpfte Farben, nichts bewegt sich –
// keine Lichteffekte, kein Konfetti, kein Feuerwerk, feste Kamera. Die Figuren stehen von Anfang an auf festen Plätzen
// einer runden Bühne und warten ruhig; zur Siegerehrung wachsen die Podeste langsam und die drei Besten gleiten hinauf.
import {
	CircleGeometry, Color, CylinderGeometry, DirectionalLight, Group, HemisphereLight, Mesh, MeshStandardMaterial,
	SphereGeometry, TorusGeometry, ConeGeometry,
} from "three";
import { skyDome, type Cam, type Spot, type ThemeCtx, type ThemeDef, type ThemeRuntime } from "./common.ts";

const CAM: Cam = { pos: [0, 6.4, 11.5], look: [0, 0.4, 0.8], fov: 42 };
const PER_ROW = 12, GAP = 0.75, ROW_GAP = 0.85;

/** Fester Platz Nr. i: Reihen von der Mitte nach außen füllen, unabhängig von der Gesamtzahl (nichts rückt nach) */
function seat(i: number): Spot {
	const row = Math.floor(i / PER_ROW), k = i % PER_ROW, m = Math.floor(k / 2);
	const x = (k % 2 ? -1 : 1) * (GAP / 2 + m * GAP);
	return { x, z: -row * ROW_GAP, ry: 0 };
}

export const calm: ThemeDef = {
	id: "calm", label: "Ruhige Bühne", icon: "🌙",
	calm: true,
	bloom: 0, exposure: 1.0,
	cams: { lobby: CAM, game: CAM, podium: CAM },
	lobbyArea: { x0: -4, x1: 4, z0: -3.4, z1: 0 },
	seat: (i) => seat(i),
	crowd: (i) => seat(i),
	podium: { x: 0, z: 3.4, colors: [0xe2c46f, 0xc9ced6, 0xcf9a72], metal: 0.15 },
	async build(ctx: ThemeCtx): Promise<ThemeRuntime> {
		const g = new Group();
		const sky = skyDome(0x4b6378, 0x34495a, { horizon: 0x8aa0ae });
		g.add(sky.mesh);
		ctx.scene.background = new Color(0x34495a);
		ctx.scene.fog = null;

		g.add(new HemisphereLight(0xf2efe6, 0x55606a, 1.1));
		const key = new DirectionalLight(0xfff4e6, 1.2); key.position.set(3, 10, 6); key.castShadow = true;
		key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 6;
		Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9 }); g.add(key);

		const mat = (color: number, rough = 0.9) => new MeshStandardMaterial({ color, roughness: rough, metalness: 0 });

		// Boden und runde Bühne
		const floor = new Mesh(new CircleGeometry(60, 64), mat(0x5d7384));
		floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
		const stage = new Mesh(new CylinderGeometry(5.8, 5.95, 0.14, 96), mat(0xe6dcc8, 0.85));
		stage.position.y = -0.07 + 0.001; stage.receiveShadow = true; g.add(stage);
		const rim = new Mesh(new TorusGeometry(5.88, 0.05, 8, 128), mat(0xc8b99c));
		rim.rotation.x = Math.PI / 2; rim.position.y = 0.0; g.add(rim);

		// Ruhige, abstrakte Formen im Hintergrund (statisch)
		const shapes: [Mesh, number, number, number][] = [
			[new Mesh(new SphereGeometry(2.6, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x9fb8ad)), -9, -10, 0],
			[new Mesh(new SphereGeometry(1.7, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xd8b4a0)), -5.5, -13, 0],
			[new Mesh(new ConeGeometry(1.6, 4.2, 48), mat(0xb7a9cf)), 7.5, -11, 2.1],
			[new Mesh(new SphereGeometry(3.2, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xa9c0cf)), 11, -15, 0],
			[new Mesh(new CylinderGeometry(1.1, 1.1, 2.4, 48), mat(0xe3cf9f)), 4, -14, 1.2],
			[new Mesh(new SphereGeometry(1.2, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xb9cdb0)), -12, -6, 0],
			[new Mesh(new ConeGeometry(1.2, 3.0, 48), mat(0xc9b6a6)), 12, -6, 1.5],
		];
		for (const [m, x, z, y] of shapes) { m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); }

		ctx.scene.add(g);
		return {
			group: g,
			update() { /* bewusst nichts: keine Bewegung */ },
			celebrate() { /* keine Effekte */ },
			dispose() { g.removeFromParent(); },
		};
	},
};
