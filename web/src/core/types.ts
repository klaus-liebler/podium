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

/** Fragetypen: Auswahl, Schätzfrage (Zahl mit Toleranz), Reihenfolge */
export type QuestionKind = "choice" | "estimate" | "order";

export interface HostQuestion {
	text: string; kind?: QuestionKind; timeLimit: number; multi: boolean; correctCount: number; points: number;
	/** Reihenfolge: Elemente in Anzeigereihenfolge (gemischt) */
	options: { text: string; correct: boolean | null }[];
	unit?: string;
	/** nach der Auflösung: Reihenfolge = richtige Folge von Anzeigepositionen, Schätzfrage = richtiger Wert */
	correctOrder?: number[] | null; correctValue?: number | null; tolerance?: number;
	explanation?: string;
	/** nur für die Fernbedienung */
	notes?: string;
}

export interface EstimateStats {
	n: number; mean: number | null; median: number | null; min: number | null; max: number | null; within: number;
	values: number[]; closest: { nick: string; value: number }[];
}

export interface QuestionStat {
	text: string; kind?: QuestionKind; options: { text: string; correct: boolean }[]; distribution: number[];
	answered: number; correct: number; players: number; avgMs: number;
	skipped?: boolean; correctValue?: number | null; tolerance?: number; unit?: string; median?: number | null;
}

export interface HostState {
	role: "host"; pin: string; joinUrl: string; quizTitle: string; phase: Phase; version: number;
	questionIndex: number; questionCount: number; isLast: boolean; remainingMs: number;
	question: HostQuestion | null; answeredCount: number; connectedCount: number;
	distribution: number[] | null; correctCount: number; avgMs: number;
	players: HostPlayer[]; stats: { questions: QuestionStat[] } | null;
	hasQuiz: boolean; direct: HostDirect | null;
	estimate?: EstimateStats | null;
	/** nächste (nicht übersprungene) Frage – für die Fernbedienung */
	next?: { text: string; kind: QuestionKind } | null;
	/** 3D-Welt aus dem Quiz ("" = Leinwand entscheidet) */
	theme?: string;
	skipped?: number;
}

export interface PlayerState {
	role: "player"; pin: string; quizTitle: string; phase: Phase; version: number;
	me: { id: string; nick: string; avatar: AvatarSpec; score: number; rank: number; streak: number };
	playerCount: number; questionIndex: number; questionCount: number; remainingMs: number;
	question: {
		text: string; kind?: QuestionKind; multi: boolean; timeLimit: number; optionCount: number; options: string[]; correct: number[] | null;
		unit?: string; correctOrder?: number[] | null; correctValue?: number | null; tolerance?: number; explanation?: string;
	} | null;
	answer: { choices: number[]; number?: number | null; correct: boolean | null; points: number } | null;
	ahead: { nick: string; diff: number } | null;
	correctTotal: number;
	hasQuiz: boolean; direct: PlayerDirect | null;
}

export interface QuizSummary {
	id: number; title: string; description: string; folderId: number | null; updatedUtc: string; questionCount: number;
	shared?: boolean; lastPlayedUtc?: string | null;
}
export interface QuizFolder { id: number; name: string; pin?: string | null; }
export interface OptionDto { text: string; isCorrect: boolean; }
export interface QuestionDto {
	text: string; timeLimitSeconds: number; pointsMultiplier: number; options: OptionDto[];
	kind?: QuestionKind; explanation?: string | null; notes?: string | null;
	correctValue?: number | null; tolerance?: number | null; unit?: string | null;
}
export interface QuizDto { id: number; title: string; description: string | null; folderId?: number | null; theme?: string | null; questions: QuestionDto[]; }
export interface OpenRoom { pin: string; hostKey: string; title: string; phase: Phase; hasQuiz: boolean; players: number; createdUtc: string; joinUrl: string; }
export interface SessionSummary { id: number; quizTitle: string; startedUtc: string; finishedUtc: string | null; playerCount: number; winner: string | null; }
