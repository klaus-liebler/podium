// Leichtes 2D-Konfetti für Handys (Canvas, kein WebGL)
const COLS = ["#6d3fd6", "#0b7f74", "#f5b02a", "#d12c55", "#1f63d6", "#8cc63f", "#ffd84d", "#ffffff"];
interface Part { x: number; y: number; vx: number; vy: number; r: number; vr: number; w: number; h: number; c: string; life: number; }

let canvas: HTMLCanvasElement | null = null, ctx: CanvasRenderingContext2D | null = null;
let parts: Part[] = [], running = false;

function ensure() {
	if (canvas) return;
	canvas = document.createElement("canvas");
	canvas.id = "confetti";
	document.body.appendChild(canvas);
	ctx = canvas.getContext("2d");
	const rs = () => { canvas!.width = innerWidth * devicePixelRatio; canvas!.height = innerHeight * devicePixelRatio; };
	rs(); addEventListener("resize", rs);
}

export function confetti(n = 160, x = 0.5, y = 0.6) {
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	ensure();
	const W = canvas!.width, H = canvas!.height, d = devicePixelRatio;
	for (let i = 0; i < n; i++) {
		const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6, v = (8 + Math.random() * 12) * d;
		parts.push({ x: x * W, y: y * H, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
			w: (6 + Math.random() * 6) * d, h: (10 + Math.random() * 8) * d, c: COLS[i % COLS.length], life: 200 + Math.random() * 80 });
	}
	if (!running) { running = true; requestAnimationFrame(loop); }
}

function loop() {
	const c = ctx!, cv = canvas!, d = devicePixelRatio;
	c.clearRect(0, 0, cv.width, cv.height);
	parts = parts.filter(p => p.life > 0 && p.y < cv.height + 50);
	for (const p of parts) {
		p.vy += 0.35 * d; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life--;
		c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.scale(1, Math.cos(p.r * 2));
		c.fillStyle = p.c; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); c.restore();
	}
	if (parts.length) requestAnimationFrame(loop);
	else { running = false; c.clearRect(0, 0, cv.width, cv.height); }
}
