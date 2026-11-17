import { defineConfig } from "vite";
import path from "node:path";
import { visualizer } from "rollup-plugin-visualizer";
import { singleFileFirmwareAssetPlugin } from "@klaus-liebler/vite-firmware-single-file";

// Baut die komplette Oberfläche (Dozentenbereich, Leinwand, Handy) als EINE minimierte index.html
// (JS+CSS inline, Three.js tree-geshaked) plus index.html.br direkt nach ../wwwroot, von wo ASP.NET sie ausliefert.
// Die Musik liegt in public/music und wird unverändert mitkopiert (zu groß zum Inlinen).
// Im Dev-Server (npm run dev) gehen /api und /hub (SignalR, WebSocket) an das laufende ASP.NET-Backend.
const BACKEND = process.env.KLHOOT_BACKEND ?? "http://localhost:5158";

export default defineConfig(({ mode }) => {
	const isAnalyze = mode === "analyze";
	return {
		plugins: [
			isAnalyze && visualizer({ filename: "./stats.html", template: "treemap", gzipSize: true, brotliSize: true, open: true }),
			!isAnalyze && singleFileFirmwareAssetPlugin("index.html.br"),
		].filter(Boolean),
		build: {
			target: "esnext",
			outDir: path.join(import.meta.dirname, "..", "wwwroot"),
			emptyOutDir: true,
		},
		server: {
			host: true,
			port: 5173,
			proxy: {
				"/api": { target: BACKEND, changeOrigin: true },
				"/hub": { target: BACKEND, changeOrigin: true, ws: true },
			},
		},
	};
});
