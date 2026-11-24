// Szenen-Vorschau (Admin): spielt eine Runde lokal durch – ohne Server, mit 20 Beispielteilnehmenden –
// und liefert dieselben HostState-Objekte wie der SignalR-Hub. So lässt sich jede 3D-Welt samt Musik schnell ansehen.
import type { AvatarSpec, EstimateStats, HostPlayer, HostQuestion, HostState, Phase, QuestionKind } from "../core/types.ts";
import { rng } from "../three/themes/common.ts";
import { randomAvatar } from "../core/avatar.ts";

const NAMES = ["Mia", "Ben", "Emma", "Paul", "Hannah", "Leon", "Sofia", "Finn", "Lina", "Elias", "Ella", "Noah", "Clara", "Luis",
	"Marie", "Jonas", "Lea", "Felix", "Ida", "Anton"];
/** Reihenfolge: options in richtiger Reihenfolge, shown = Anzeigereihenfolge; Schätzfrage: value ± tol */
interface SimQ { text: string; kind?: QuestionKind; options: string[]; correct: number[]; secs: number; shown?: number[]; value?: number; tol?: number; unit?: string; explanation?: string; notes?: string; }
const QUESTIONS: SimQ[] = [
	{ text: "Welcher Planet ist der größte in unserem Sonnensystem?", options: ["Mars", "Jupiter", "Saturn", "Erde"], correct: [1], secs: 15,
		explanation: "Jupiter hat gut den **11-fachen Durchmesser** der Erde.", notes: "Überleitung: Gasriesen" },
	{ text: "Welche dieser Tiere sind Säugetiere?", options: ["Delfin", "Hai", "Fledermaus", "Pinguin"], correct: [0, 2], secs: 15 },
	{ text: "Wie viele Knochen hat ein erwachsener Mensch?", kind: "estimate", options: [], correct: [], secs: 20, value: 206, tol: 10, unit: "",
		explanation: "Babys haben noch rund 300 Knochen – viele wachsen später zusammen." },
	{ text: "Ordne die Planeten nach ihrer Entfernung zur Sonne (nah → fern).", kind: "order", options: ["Merkur", "Venus", "Erde", "Mars"], correct: [], secs: 20, shown: [2, 0, 3, 1] },
	{ text: "Wie viele Beine hat eine Spinne?", options: ["6", "8", "10"], correct: [1], secs: 12 },
];
const INTRO_MS = 4000;
const seqOf = (q: SimQ) => q.options.map((_, k) => q.shown!.indexOf(k));

interface P { id: string; nick: string; avatar: AvatarSpec; score: number; prevRank: number; streak: number; lastPoints: number; lastCorrect: boolean; correctTotal: number; answered: boolean; skill: number; choice: number; ms: number; num: number | null; right: boolean; }

export class PreviewSim {
	private r = rng(42);
	private players: P[] = [];
	private phase: Phase = "lobby";
	private version = 0;
	private q = 0;
	private deadline = 0;
	private timers: number[] = [];
	private joinTimer = 0;
	private dist: number[] = [];
	private history: { q: number; dist: number[]; correct: number; avgMs: number }[] = [];

	constructor(private emit: (s: HostState) => void, private count = 20) { }

	start() {
		// Teilnehmende treten nacheinander bei (wie im echten Warteraum)
		this.joinTimer = window.setInterval(() => {
			if (this.players.length >= this.count) { clearInterval(this.joinTimer); return; }
			this.addPlayer(); this.send();
		}, 180);
		this.send();
	}
	private addPlayer() {
		const i = this.players.length;
		this.players.push({
			id: "p" + i, nick: NAMES[i % NAMES.length], avatar: { ...randomAvatar(), aid: this.r() < 0.15 ? 1 : 0 },
			score: 0, prevRank: i + 1, streak: 0, lastPoints: 0, lastCorrect: false, correctTotal: 0, answered: false, skill: 0.35 + this.r() * 0.6, choice: -1, ms: 0,
			num: null, right: false,
		});
	}
	stop() { this.clearTimers(); clearInterval(this.joinTimer); }

	/** Aufrufe der Leinwand, die sonst an den Hub gehen */
	invoke(method: string, ...args: unknown[]): unknown {
		switch (method) {
			case "HostNext": this.next(); break;
			case "HostFinish": this.go("podium"); break;
			case "HostSkip": {
				const to = this.q + (this.phase === "scoreboard" ? 2 : 1);
				if (to >= QUESTIONS.length) this.go("podium"); else { this.q = to; this.go("intro"); }
				break;
			}
			case "HostKick": this.players = this.players.filter(p => p.id !== args[0]); this.send(); break;
			case "HostDirectStart": return "In der Vorschau nicht verfügbar.";
		}
		return null;
	}

	private clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
	private later(ms: number, fn: () => void) { this.timers.push(window.setTimeout(fn, ms)); }

	private next() {
		const order: Partial<Record<Phase, () => void>> = {
			lobby: () => this.go("intro"),
			intro: () => this.go("answering"),
			answering: () => this.go("reveal"),
			reveal: () => this.go(this.q >= QUESTIONS.length - 1 ? "podium" : "scoreboard"),
			scoreboard: () => { this.q++; this.go("intro"); },
			podium: () => this.go("final"),
			final: () => { this.q = 0; this.history = []; this.players.forEach(p => { p.score = 0; p.streak = 0; p.correctTotal = 0; p.lastPoints = 0; }); this.go("lobby"); },
		};
		order[this.phase]?.();
	}

	/** Direkt in eine Phase springen (Vorschau-Leiste) */
	go(phase: Phase) {
		clearInterval(this.joinTimer);
		while (this.players.length < this.count) this.addPlayer();
		this.clearTimers();
		if ((phase === "podium" || phase === "final" || phase === "scoreboard") && !this.history.length) this.fakePlayedRounds();
		this.phase = phase;
		this.version++;
		const qd = QUESTIONS[this.q];
		if (phase === "intro") { this.deadline = performance.now() + INTRO_MS; this.later(INTRO_MS, () => this.go("answering")); }
		if (phase === "answering") {
			const total = qd.secs * 1000;
			this.deadline = performance.now() + total;
			this.dist = qd.options.map(() => 0);
			for (const p of this.players) {
				p.answered = false;
				this.pick(p, qd);
				p.ms = 1500 + this.r() * (total - 2500);
				this.later(p.ms, () => { p.answered = true; if (p.choice >= 0) this.dist[p.choice]++; this.send(); if (this.players.every(x => x.answered)) this.later(600, () => this.go("reveal")); });
			}
			this.later(total, () => this.go("reveal"));
		}
		if (phase === "reveal") this.score(qd);
		this.send();
	}

	/** simulierte Antwort je nach Fragetyp (Treffer abhängig vom „Können“) */
	private pick(p: P, q: SimQ) {
		const right = this.r() < p.skill;
		p.right = right; p.choice = -1; p.num = null;
		if (q.kind === "estimate") p.num = Math.round(q.value! + (right ? 1 : 4) * (this.r() * 2 - 1) * (q.tol || 5) * (right ? 0.9 : 1));
		else if (q.kind !== "order") p.choice = right ? q.correct[Math.floor(this.r() * q.correct.length)] : this.wrongOf(q);
	}
	private hit(p: P, q: SimQ) {
		if (!p.answered) return false;
		if (q.kind === "estimate") return p.num != null && Math.abs(p.num - q.value!) <= (q.tol ?? 0);
		if (q.kind === "order") return p.right;
		return q.correct.includes(p.choice);
	}
	private wrongOf(q: SimQ) {
		const wrong = q.options.map((_, i) => i).filter(i => !q.correct.includes(i));
		return wrong[Math.floor(this.r() * wrong.length)];
	}
	private ranked() { return [...this.players].sort((a, b) => b.score - a.score); }
	private score(q: SimQ) {
		const before = this.ranked(); before.forEach((p, i) => { p.prevRank = i + 1; });
		const answered = this.players.filter(p => p.answered);
		for (const p of this.players) {
			const ok = this.hit(p, q);
			p.lastCorrect = ok; p.lastPoints = ok ? Math.round(1000 * (1 - p.ms / (q.secs * 1000) / 2)) : 0;
			p.score += p.lastPoints; p.streak = ok ? p.streak + 1 : 0; if (ok) p.correctTotal++;
		}
		const correct = answered.filter(p => p.lastCorrect).length;
		this.history[this.q] = { q: this.q, dist: [...this.dist], correct, avgMs: answered.reduce((a, p) => a + p.ms, 0) / Math.max(1, answered.length) };
	}
	/** Beim direkten Sprung zu Zwischenstand/Siegerehrung: Punkte für alle Fragen erfinden */
	private fakePlayedRounds() {
		for (let qi = 0; qi < QUESTIONS.length; qi++) {
			const q = QUESTIONS[qi];
			this.dist = q.options.map(() => 0);
			for (const p of this.players) {
				p.answered = true; p.ms = 1500 + this.r() * (q.secs * 1000 - 2500);
				this.pick(p, q); if (p.choice >= 0) this.dist[p.choice]++;
			}
			this.q = qi; this.score(q);
		}
	}

	private send() {
		const qd = QUESTIONS[this.q];
		const ranked = this.ranked();
		const players: HostPlayer[] = ranked.map((p, i) => ({
			id: p.id, nick: p.nick, avatar: p.avatar, score: p.score, rank: i + 1, prevRank: p.prevRank, connected: true, anon: false,
			streak: p.streak, lastPoints: p.lastPoints, lastCorrect: p.lastCorrect, correctTotal: p.correctTotal, answered: this.phase === "answering" && p.answered,
		}));
		const reveal = this.phase === "reveal";
		const kind = qd.kind ?? "choice";
		const shown = kind === "order" ? qd.shown!.map(i => qd.options[i]) : qd.options;
		const question: HostQuestion = {
			text: qd.text, kind, timeLimit: qd.secs, multi: kind === "choice" && qd.correct.length > 1, correctCount: qd.correct.length, points: 1,
			options: shown.map((t, i) => ({ text: t, correct: reveal && kind === "choice" ? qd.correct.includes(i) : null })),
			unit: qd.unit ?? "", tolerance: qd.tol ?? 0, notes: qd.notes ?? "",
			correctOrder: reveal && kind === "order" ? seqOf(qd) : null,
			correctValue: reveal && kind === "estimate" ? qd.value : null,
			explanation: reveal ? qd.explanation ?? "" : "",
		};
		const h = this.history[this.q];
		const answered = this.players.filter(p => p.answered).length;
		const join = location.origin + location.pathname + "#/join/123456";
		const nq = QUESTIONS[this.q + 1];
		this.emit({
			role: "host", pin: "123456", joinUrl: join, quizTitle: "Vorschau", phase: this.phase, version: this.version,
			questionIndex: this.q, questionCount: QUESTIONS.length, isLast: this.q >= QUESTIONS.length - 1,
			remainingMs: Math.max(0, this.deadline - performance.now()),
			question: ["intro", "answering", "reveal"].includes(this.phase) ? question : null,
			answeredCount: answered, connectedCount: this.players.length,
			distribution: reveal && kind === "choice" ? (h?.dist ?? this.dist) : null, correctCount: reveal ? (h?.correct ?? 0) : 0, avgMs: h?.avgMs ?? 0,
			estimate: reveal && kind === "estimate" ? this.estimate(qd) : null,
			next: nq ? { text: nq.text, kind: nq.kind ?? "choice" } : null,
			players,
			stats: this.phase === "final" ? {
				questions: QUESTIONS.map((q, i) => ({
					text: q.text, kind: q.kind ?? "choice", options: q.options.map((t, j) => ({ text: t, correct: q.kind === "order" || q.correct.includes(j) })),
					distribution: q.kind ? [] : this.history[i]?.dist ?? q.options.map(() => 0), answered: this.players.length,
					correct: this.history[i]?.correct ?? 0, players: this.players.length, avgMs: this.history[i]?.avgMs ?? 0,
					correctValue: q.value ?? null, tolerance: q.tol ?? 0, unit: q.unit ?? "", median: q.value ?? null,
				})),
			} : null,
			hasQuiz: true, direct: null,
		});
	}

	private estimate(q: SimQ): EstimateStats {
		const est = this.players.filter(p => p.answered && p.num != null);
		const v = est.map(p => p.num!).sort((a, b) => a - b);
		const n = v.length;
		return {
			n, values: v, within: est.filter(p => Math.abs(p.num! - q.value!) <= (q.tol ?? 0)).length,
			mean: n ? v.reduce((a, b) => a + b, 0) / n : null, median: n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : null,
			min: n ? v[0] : null, max: n ? v[n - 1] : null,
			closest: [...est].sort((a, b) => Math.abs(a.num! - q.value!) - Math.abs(b.num! - q.value!)).slice(0, 3).map(p => ({ nick: p.nick, value: p.num! })),
		};
	}
}
