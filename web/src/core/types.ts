// Zustands-Objekte, wie sie der Server (Game/Views.cs) per SignalR "state" schickt.

export type Phase = "lobby" | "intro" | "answering" | "reveal" | "scoreboard" | "podium" | "final" | "direct";

// ---------------------------------------------------------------- DirectMode
export type DirectKind = "choice" | "number" | "text";
export interface DirectSpec { text: string; kind: DirectKind; options: string[]; multi: boolean; live: boolean; min: number | null; max: number | null; unit: string; }
export interface ChoiceResults { counts: number[]; }
export interface NumberResults { values: number[]; n: number; mean?: number; median?: number; min?: number; max?: number; sd?: number; }
export interface TextResults { words: { w: string; n: number }[]; n: number; }
export type DirectResults = ChoiceResults | NumberResults | TextResults;
export interface HostDirect {
	id: number; text: string; kind: DirectKind; options: string[]; multi: boolean; live: boolean;
	min: number | null; max: number | null; unit: string; open: boolean; count: number; results: DirectResults | null;
}
export interface PlayerDirect {
	id: number; text: string; kind: DirectKind; options: string[]; multi: boolean; min: number | null; max: number | null; unit: string; open: boolean;
	mine: { choices: number[] | null; number: number | null; text: string | null } | null;
}

/** body = 3D-Figur, aid = Hilfsmittel (0 keins, 1 Brille, 2 Sonnenbrille) */
export interface AvatarSpec { shape: number; color: number; eyes: number; mouth: number; hat: number; body: number; aid: number; }

export interface HostPlayer {
	id: string; nick: string; avatar: AvatarSpec; score: number; rank: number; prevRank: number;
	connected: boolean; anon: boolean; streak: number; lastPoints: number; lastCorrect: boolean; correctTotal: number; answered: boolean;
}

export interface HostQuestion {
	text: string; timeLimit: number; multi: boolean; correctCount: number; points: number;
	options: { text: string; correct: boolean | null }[];
}

export interface QuestionStat {
	text: string; options: { text: string; correct: boolean }[]; distribution: number[];
	answered: number; correct: number; players: number; avgMs: number;
}

export interface HostState {
	role: "host"; pin: string; joinUrl: string; quizTitle: string; phase: Phase; version: number;
	questionIndex: number; questionCount: number; isLast: boolean; remainingMs: number;
	question: HostQuestion | null; answeredCount: number; connectedCount: number;
	distribution: number[] | null; correctCount: number; avgMs: number;
	players: HostPlayer[]; stats: { questions: QuestionStat[] } | null;
	hasQuiz: boolean; direct: HostDirect | null;
}

export interface PlayerState {
	role: "player"; pin: string; quizTitle: string; phase: Phase; version: number;
	me: { id: string; nick: string; avatar: AvatarSpec; score: number; rank: number; streak: number };
	playerCount: number; questionIndex: number; questionCount: number; remainingMs: number;
	question: { text: string; multi: boolean; timeLimit: number; optionCount: number; options: string[]; correct: number[] | null } | null;
	answer: { choices: number[]; correct: boolean | null; points: number } | null;
	ahead: { nick: string; diff: number } | null;
	correctTotal: number;
	hasQuiz: boolean; direct: PlayerDirect | null;
}

export interface QuizSummary { id: number; title: string; description: string; updatedUtc: string; questionCount: number; }
export interface OptionDto { text: string; isCorrect: boolean; }
export interface QuestionDto { text: string; timeLimitSeconds: number; pointsMultiplier: number; options: OptionDto[]; }
export interface QuizDto { id: number; title: string; description: string | null; questions: QuestionDto[]; }
export interface SessionSummary { id: number; quizTitle: string; startedUtc: string; finishedUtc: string | null; playerCount: number; winner: string | null; }
