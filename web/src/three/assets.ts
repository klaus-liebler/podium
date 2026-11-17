// Laden der CC0-Modelle (Kenney, public/models) mit Cache.
// Ältere Kenney-Kits nutzen "unlit"-Materialien -> werden in beleuchtete Standard-Materialien umgewandelt.
import { Color, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Material, type Object3D } from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();
const converted = new WeakMap<Material, Material>();

export const MODELS = "models/";

export function loadGltf(path: string): Promise<GLTF> {
	let p = cache.get(path);
	if (!p) { p = loader.loadAsync(MODELS + path); cache.set(path, p); }
	return p;
}

function litMaterial(m: Material): Material {
	const hit = converted.get(m);
	if (hit) return hit;
	let out: Material = m;
	if (m instanceof MeshBasicMaterial) {
		out = new MeshStandardMaterial({ color: new Color().copy(m.color), map: m.map, roughness: 0.75, metalness: 0.05, transparent: m.transparent, opacity: m.opacity });
	} else if (m instanceof MeshStandardMaterial) {
		m.roughness = Math.max(m.roughness, 0.55);
	}
	converted.set(m, out);
	return out;
}

/** Bereitet ein geladenes Modell vor: Schatten, beleuchtete Materialien. */
export function prepare(o: Object3D, shadows = true): Object3D {
	o.traverse(c => {
		if (c instanceof Mesh) {
			c.castShadow = shadows; c.receiveShadow = true;
			c.material = Array.isArray(c.material) ? c.material.map(litMaterial) : litMaterial(c.material);
		}
	});
	return o;
}

/** Statisches Modell (geteilte Geometrie/Materialien). */
export async function model(path: string, opts: { scale?: number; shadows?: boolean } = {}): Promise<Object3D> {
	const g = await loadGltf(path);
	const o = prepare(g.scene.clone(true), opts.shadows ?? true);
	if (opts.scale) o.scale.setScalar(opts.scale);
	return o;
}
