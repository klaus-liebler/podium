// Gestaltbare Avatare als SVG-String (auch als Textur für die 3D-Welt). Ein Avatar ist {shape, color, eyes, mouth, hat} – jeweils ein Index.
// Die SVGs entstehen ausschließlich aus Zahlen-Indizes, enthalten also nie Benutzereingaben.
import type { AvatarSpec } from "./types.ts";

  const INK = '#2b1d3a';
  export const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#b197fc', '#f783ac', '#a9e34b'];
  const SHAPE_NAMES = ['Kugel', 'Ei', 'Würfel', 'Geist', 'Katze'];
  const EYE_NAMES = ['Punkte', 'Glubsch', 'Müde', 'Sonnenbrille', 'Verliebt', 'Zwinker', 'Zyklop'];
  const MOUTH_NAMES = ['Lächeln', 'Grinsen', 'Staunen', 'Zunge', 'Katzenmaul', 'Schief'];
  const HAT_NAMES = ['Ohne', 'Partyhut', 'Krone', 'Mütze', 'Kopfhörer', 'Propeller', 'Blume', 'Hörner'];

  function shade(hex: string, f: number) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const t = f < 0 ? 0 : 255, p = Math.abs(f);
    r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function body(shape: number, c: string) {
    const dark = shade(c, -0.25);
    const st = `fill="${c}" stroke="${dark}" stroke-width="3"`;
    switch (shape) {
      case 1: return `<ellipse cx="50" cy="57" rx="29" ry="37" ${st}/>`;
      case 2: return `<rect x="17" y="25" width="66" height="66" rx="18" ${st}/>`;
      case 3: return `<path d="M17,58 a33,33 0 0 1 66,0 v30 q-5.5,-7 -11,0 t-11,0 t-11,0 t-11,0 t-11,0 t-11,0 z" ${st}/>`;
      case 4: return `<path d="M24,44 L21,12 L45,30 Z M76,44 L79,12 L55,30 Z" ${st} stroke-linejoin="round"/>
                      <path d="M27,38 L26,20 L38,30 Z M73,38 L74,20 L62,30 Z" fill="${shade(c, 0.45)}"/>
                      <circle cx="50" cy="60" r="32" ${st}/>`;
      default: return `<circle cx="50" cy="58" r="33" ${st}/>`;
    }
  }

  function eyes(i: number) {
    const W = '#fff';
    switch (i) {
      case 1: return `<circle cx="37" cy="51" r="10" fill="${W}" stroke="${INK}" stroke-width="2"/><circle cx="63" cy="51" r="10" fill="${W}" stroke="${INK}" stroke-width="2"/>
                      <circle cx="40" cy="54" r="4.5" fill="${INK}"/><circle cx="60" cy="48" r="4.5" fill="${INK}"/>`;
      case 2: return `<path d="M30,52 q7,6 14,0 M56,52 q7,6 14,0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      case 3: return `<rect x="25" y="44" width="22" height="14" rx="5" fill="${INK}"/><rect x="53" y="44" width="22" height="14" rx="5" fill="${INK}"/>
                      <path d="M47,49 h6" stroke="${INK}" stroke-width="3"/><path d="M29,48 l5,0" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/><path d="M57,48 l5,0" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/>`;
      case 4: { const h = (x: number) => `<path transform="translate(${x},50)" d="M0,4 C-8,-3 -4,-9 0,-4 C4,-9 8,-3 0,4 Z" fill="#ff3b6b" stroke="${INK}" stroke-width="1.5"/>`;
        return h(37) + h(63); }
      case 5: return `<circle cx="37" cy="51" r="6.5" fill="${W}"/><circle cx="38" cy="52" r="3.5" fill="${INK}"/>
                      <path d="M56,53 q7,-7 14,0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      case 6: return `<circle cx="50" cy="49" r="14" fill="${W}" stroke="${INK}" stroke-width="2"/><circle cx="50" cy="50" r="7" fill="#3bc9db"/><circle cx="50" cy="50" r="3.5" fill="${INK}"/><circle cx="47" cy="46" r="2" fill="#fff"/>`;
      default: return `<circle cx="38" cy="51" r="6.5" fill="${W}"/><circle cx="62" cy="51" r="6.5" fill="${W}"/>
                       <circle cx="39" cy="52" r="3.5" fill="${INK}"/><circle cx="63" cy="52" r="3.5" fill="${INK}"/>`;
    }
  }

  function mouth(i: number) {
    switch (i) {
      case 1: return `<path d="M37,66 h26 q0,13 -13,13 q-13,0 -13,-13 z" fill="${INK}"/><rect x="40" y="66" width="20" height="4" fill="#fff"/>`;
      case 2: return `<ellipse cx="50" cy="72" rx="5" ry="6.5" fill="${INK}"/>`;
      case 3: return `<path d="M39,67 q11,12 22,0 z" fill="${INK}"/><path d="M45,71 q5,10 10,0 z" fill="#ff8fab"/>`;
      case 4: return `<path d="M41,68 q4.5,6 9,0 q4.5,6 9,0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      case 5: return `<path d="M41,72 q9,3 18,-4" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      default: return `<path d="M39,67 q11,11 22,0" stroke="${INK}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
    }
  }

  function hat(i: number, top: number) {
    const t = `transform="translate(0,${top - 25})"`;
    switch (i) {
      case 1: return `<g ${t}><path d="M37,31 L50,1 L63,31 Z" fill="#7950f2" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
              <path d="M41,22 L59,22 M44.5,13 L55.5,13" stroke="#ffd43b" stroke-width="3"/><circle cx="50" cy="2" r="4" fill="#ff6b6b" stroke="${INK}" stroke-width="1.5"/></g>`;
      case 2: return `<g ${t}><path d="M32,31 L32,11 L41,20 L50,6 L59,20 L68,11 L68,31 Z" fill="#ffd43b" stroke="#b8860b" stroke-width="2" stroke-linejoin="round"/>
              <circle cx="50" cy="24" r="3.5" fill="#ff3b6b"/><circle cx="39" cy="26" r="2.2" fill="#4dabf7"/><circle cx="61" cy="26" r="2.2" fill="#4dabf7"/></g>`;
      case 3: return `<g ${t}><path d="M22,38 q28,-40 56,0 z" fill="#ff922b" stroke="${INK}" stroke-width="2"/><rect x="20" y="31" width="60" height="10" rx="5" fill="#e8590c" stroke="${INK}" stroke-width="2"/>
              <circle cx="50" cy="8" r="6" fill="#fff" stroke="${INK}" stroke-width="2"/></g>`;
      case 4: return `<g ${t}><path d="M19,56 a31,34 0 0 1 62,0" stroke="${INK}" stroke-width="5" fill="none"/>
              <rect x="10" y="46" width="13" height="22" rx="6" fill="#ff3b6b" stroke="${INK}" stroke-width="2"/><rect x="77" y="46" width="13" height="22" rx="6" fill="#ff3b6b" stroke="${INK}" stroke-width="2"/></g>`;
      case 5: return `<g ${t}><path d="M30,31 a20,17 0 0 1 40,0 z" fill="#4dabf7" stroke="${INK}" stroke-width="2"/><path d="M30,31 a20,17 0 0 1 20,-17 v17z" fill="#ff6b6b"/>
              <path d="M50,14 v-7" stroke="${INK}" stroke-width="2.5"/><g class="av-prop" style="transform-origin:50px 6px">
              <ellipse cx="41" cy="6" rx="9" ry="3" fill="#ffd43b" stroke="${INK}" stroke-width="1.5"/><ellipse cx="59" cy="6" rx="9" ry="3" fill="#69db7c" stroke="${INK}" stroke-width="1.5"/></g></g>`;
      case 6: return `<g ${t}><g transform="translate(70,28)">${[0, 72, 144, 216, 288].map(a => `<ellipse rx="5" ry="8" transform="rotate(${a}) translate(0,-7)" fill="#f783ac" stroke="${INK}" stroke-width="1.2"/>`).join('')}
              <circle r="4.5" fill="#ffd43b" stroke="${INK}" stroke-width="1.2"/></g></g>`;
      case 7: return `<g ${t}><path d="M30,32 q-10,-14 -4,-26 q4,14 14,20 z" fill="#f1f3f5" stroke="${INK}" stroke-width="2"/><path d="M70,32 q10,-14 4,-26 q-4,14 -14,20 z" fill="#f1f3f5" stroke="${INK}" stroke-width="2"/></g>`;
      default: return '';
    }
  }

  export function norm(a?: Partial<AvatarSpec> | null): AvatarSpec {
    a = a || {};
    const m = (v: number | undefined, n: number) => (((v ?? 0) | 0) % n + n) % n;
    return {
      shape: m(a.shape, SHAPE_NAMES.length), color: m(a.color, COLORS.length), eyes: m(a.eyes, EYE_NAMES.length),
      mouth: m(a.mouth, MOUTH_NAMES.length), hat: m(a.hat, HAT_NAMES.length), body: m(a.body, BODY_COUNT), aid: m(a.aid, AID_NAMES.length)
    };
  }

  export function avatarSvg(spec: Partial<AvatarSpec> | null | undefined, cls = ''): string {
    const a = norm(spec);
    const c = COLORS[a.color];
    const top = a.shape === 1 ? 20 : a.shape === 4 ? 28 : 25;
    // Bei Ei/Katze sitzt das Gesicht leicht anders
    const fy = a.shape === 4 ? 3 : 0;
    return `<svg class="avatar ${cls}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="50" cy="95" rx="26" ry="4" fill="rgba(0,0,0,.18)"/>
      ${body(a.shape, c)}
      <ellipse cx="38" cy="${38 + fy}" rx="9" ry="5" fill="#fff" opacity=".35" transform="rotate(-20 38 ${38 + fy})"/>
      <g transform="translate(0,${fy})">${eyes(a.eyes)}${mouth(a.mouth)}</g>
      <ellipse cx="29" cy="${64 + fy}" rx="5" ry="3" fill="#ff8fab" opacity=".45"/><ellipse cx="71" cy="${64 + fy}" rx="5" ry="3" fill="#ff8fab" opacity=".45"/>
      ${hat(a.hat, top)}
    </svg>`;
  }

  export function randomAvatar(): AvatarSpec {
    const r = (n: number) => Math.floor(Math.random() * n);
    return { shape: r(SHAPE_NAMES.length), color: r(COLORS.length), eyes: r(EYE_NAMES.length), mouth: r(MOUTH_NAMES.length), hat: r(HAT_NAMES.length), body: r(BODY_COUNT), aid: 0 };
  }

/** Anzahl der 3D-Figuren (muss zu CHARACTER_FILES in three/figure.ts passen) und ihre Vorschaubilder */
export const BODY_FILES = [
  "character-female-a", "character-male-a", "character-female-b", "character-male-b", "character-female-c", "character-male-c",
  "character-female-d", "character-male-d", "character-female-e", "character-male-e", "character-female-f", "character-male-f",
  "character-male-g", "character-worker", "character-knight", "character-soldier", "character-raider", "character-robot",
  "character-alien", "character-zombie",
];
const BODY_COUNT = BODY_FILES.length;
export const AID_NAMES = ['Keins', 'Brille', 'Sonnenbrille'];
export const bodyPreview = (i: number) => `models/characters/previews/${BODY_FILES[((i % BODY_COUNT) + BODY_COUNT) % BODY_COUNT]}.png`;

/** Teile der 3D-Figur, die auf dem Handy gewählt werden (color = Farbe des Namensschilds) */
export const FIGURE_PARTS: { key: keyof AvatarSpec; label: string; names: string[] }[] = [
  { key: 'body', label: 'Figur', names: BODY_FILES.map((_, i) => `Figur ${i + 1} von ${BODY_FILES.length}`) },
  { key: 'hat', label: 'Kopfbedeckung', names: HAT_NAMES },
  { key: 'aid', label: 'Hilfsmittel', names: AID_NAMES },
  { key: 'color', label: 'Farbe Namensschild', names: COLORS.map((_, i) => 'Farbe ' + (i + 1)) },
];

/** @deprecated 2D-Avatar-Teile (nicht mehr in der Oberfläche) */
export const AVATAR_PARTS: { key: keyof AvatarSpec; label: string; names: string[] }[] = [
  { key: 'shape', label: 'Form', names: SHAPE_NAMES },
  { key: 'color', label: 'Farbe', names: COLORS.map((_, i) => 'Farbe ' + (i + 1)) },
  { key: 'eyes', label: 'Augen', names: EYE_NAMES },
  { key: 'mouth', label: 'Mund', names: MOUTH_NAMES },
  { key: 'hat', label: 'Extra', names: HAT_NAMES },
];
