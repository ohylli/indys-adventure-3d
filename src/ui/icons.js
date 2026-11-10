// Inline SVG icons for the UI. Hand-drawn in the game's toon style: flat fills, dark ink outlines, round joins.
// Every icon is a string of SVG markup; colours come from CSS custom properties defined in ui.css so they follow
// the palette (--ink, --cream, --red, --teal, --yellow, ...).

const INK = 'var(--ink)';
const svg = (vb, body, cls = '') =>
  `<svg class="ico ${cls}" viewBox="${vb}" aria-hidden="true" focusable="false" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

const HEART_PATH = 'M12 20.6C5.2 15.8 1.6 11.8 1.6 7.4 1.6 4.2 4.1 1.7 7.1 1.7c2 0 3.7 1 4.9 2.8 1.2-1.8 2.9-2.8 4.9-2.8 3 0 5.5 2.5 5.5 5.7 0 4.4-3.6 8.4-10.4 13.2z';

// Indy's head: white fluffy face, dark tabby cap with a widow's peak, pink inner ears and nose.
const CAT_HEAD = (s = 2) => `
  <path d="M6 3.5 13.5 11Q20 8.6 26.5 11L34 3.5Q37.4 13.5 35.6 20.5 34 31.5 20 32.6 6 31.5 4.4 20.5 2.6 13.5 6 3.5Z" fill="#fffaf2" stroke="${INK}" stroke-width="${s}"/>
  <path d="M6 3.5 13.5 11Q20 8.6 26.5 11L34 3.5Q36.2 10 35.9 15.2 29 13.4 24.6 17.2L20 21.2 15.4 17.2Q11 13.4 4.1 15.2 3.8 10 6 3.5Z" fill="#4a3f4f"/>
  <path d="M15 11.2l1.6 3.4M20 10.4v4.2M25 11.2l-1.6 3.4" stroke="#7a6e82" stroke-width="1.5" fill="none"/>
  <path d="M7.6 7.4 11.6 11.2 8.6 12.6Z M32.4 7.4 28.4 11.2 31.4 12.6Z" fill="#f59ab0"/>
  <path d="M6 3.5 13.5 11Q20 8.6 26.5 11L34 3.5Q37.4 13.5 35.6 20.5 34 31.5 20 32.6 6 31.5 4.4 20.5 2.6 13.5 6 3.5Z" fill="none" stroke="${INK}" stroke-width="${s}"/>
  <ellipse cx="13.6" cy="21" rx="2.3" ry="2.8" fill="${INK}"/><ellipse cx="26.4" cy="21" rx="2.3" ry="2.8" fill="${INK}"/>
  <circle cx="14.4" cy="20" r=".9" fill="#fff"/><circle cx="27.2" cy="20" r=".9" fill="#fff"/>
  <path d="M18.4 24.6h3.2L20 26.4Z" fill="#f2829c" stroke="${INK}" stroke-width="1"/>
  <path d="M17 27.6q1.5 1.3 3-.4 1.5 1.7 3 .4" fill="none" stroke="${INK}" stroke-width="1.2"/>`;

// Näsinneula silhouette for the altitude gauge: viewBox 0 0 60 300, ground at y = 296, antenna tip at y = 6.
export const TOWER_PATH =
  'M15 296V288H22.5L25.2 96H24L10 88V84L7 82V74L12 70V66Q30 58 48 66V70L53 74V82L50 84V88L36 96H34.8L37.5 288H45V296Z';

export const ICONS = {
  heart: svg('0 0 24 22', `
    <path d="${HEART_PATH}" fill="var(--red)" stroke="${INK}" stroke-width="2.2"/>
    <path d="M5 6.6Q5.6 4.2 8 4.1" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="2"/>`, 'ico-heart'),
  heartEmpty: svg('0 0 24 22', `
    <path d="${HEART_PATH}" fill="rgba(255,240,225,.38)" stroke="${INK}" stroke-width="2.2"/>`, 'ico-heart'),

  fish: svg('0 0 34 22', `
    <path d="M2.5 11C7 3.4 15 2.4 21.4 6.6L29.6 2.2C28.2 7 28.2 15 29.6 19.8L21.4 15.4C15 19.6 7 18.6 2.5 11Z" fill="var(--orange)" stroke="${INK}" stroke-width="2.1"/>
    <path d="M7 11C10 7 15.5 6.5 19.6 8.6" fill="none" stroke="#ffd29c" stroke-width="1.8"/>
    <path d="M13.4 6.2Q11.8 11 13.4 15.8" fill="none" stroke="${INK}" stroke-width="1.5"/>
    <circle cx="8.6" cy="10" r="1.5" fill="${INK}"/>`, 'ico-fish'),

  paw: svg('0 0 24 24', `
    <path d="M12 12.6c3.4 0 6.4 3 6.4 5.6 0 2.2-1.8 3-3.4 3-1.2 0-2-.6-3-.6s-1.8.6-3 .6c-1.6 0-3.4-.8-3.4-3 0-2.6 3-5.6 6.4-5.6Z"/>
    <ellipse cx="4.6" cy="10.6" rx="2.2" ry="2.8" transform="rotate(-18 4.6 10.6)"/>
    <ellipse cx="9" cy="5.6" rx="2.3" ry="3"/>
    <ellipse cx="15" cy="5.6" rx="2.3" ry="3"/>
    <ellipse cx="19.4" cy="10.6" rx="2.2" ry="2.8" transform="rotate(18 19.4 10.6)"/>`, 'ico-paw'),

  catHead: svg('0 0 40 36', CAT_HEAD(2.2), 'ico-cat'),

  // Nine Lives charm: a golden cat-eared medallion with a 9.
  charm: svg('0 0 36 38', `
    <path d="M18 34 8.6 35.4 12 31Z" fill="var(--red)" stroke="${INK}" stroke-width="1.8"/>
    <path d="M18 34 27.4 35.4 24 31Z" fill="var(--red)" stroke="${INK}" stroke-width="1.8"/>
    <path d="M6.4 4.6 12.4 10.4Q18 8.4 23.6 10.4L29.6 4.6Q33.6 12 33 19 32 32.4 18 32.6 4 32.4 3 19 2.4 12 6.4 4.6Z" fill="var(--yellow)" stroke="${INK}" stroke-width="2.2"/>
    <path d="M8 8.8 11 11.6M28 8.8 25 11.6" stroke="#fff2b0" stroke-width="2"/>
    <circle cx="18" cy="20.6" r="8.6" fill="#ffe27a" stroke="#d98a1c" stroke-width="1.6"/>
    <path d="M20.6 19.2a3.1 3.1 0 1 1-1-2.4c.8 1 1 2.6.4 4.6-.8 2.6-2.4 3.8-4.4 3.8" fill="none" stroke="${INK}" stroke-width="2.3"/>`, 'ico-charm'),

  pause: svg('0 0 24 24', `
    <rect x="5.5" y="4.5" width="4.6" height="15" rx="1.4" fill="currentColor" stroke="${INK}" stroke-width="1.8"/>
    <rect x="13.9" y="4.5" width="4.6" height="15" rx="1.4" fill="currentColor" stroke="${INK}" stroke-width="1.8"/>`),

  play: svg('0 0 24 24', `<path d="M7 4.6 19.4 12 7 19.4Z" fill="currentColor" stroke="${INK}" stroke-width="2"/>`),

  soundOn: svg('0 0 24 24', `
    <path d="M3 9.2h3.6L11.6 5v14l-5-4.2H3Z" fill="currentColor" stroke="${INK}" stroke-width="1.9"/>
    <path d="M15 9q1.6 3 0 6M17.8 6.6q3.2 5.4 0 10.8" fill="none" stroke="${INK}" stroke-width="2.1"/>`),
  soundOff: svg('0 0 24 24', `
    <path d="M3 9.2h3.6L11.6 5v14l-5-4.2H3Z" fill="currentColor" stroke="${INK}" stroke-width="1.9"/>
    <path d="M15 9.2l5.4 5.6M20.4 9.2 15 14.8" fill="none" stroke="${INK}" stroke-width="2.3"/>`),

  // Retro mode: a chunky pixel cat face.
  retro: svg('0 0 24 24', `
    <path d="M3 3h4v3h2v2h6V6h2V3h4v15h-2v2H5v-2H3Z" fill="currentColor" stroke="${INK}" stroke-width="1.8"/>
    <path d="M7 11h3v3H7zM14 11h3v3h-3z" fill="${INK}"/><path d="M10.5 16h3v1.6h-3z" fill="${INK}"/>`),

  restart: svg('0 0 24 24', `
    <path d="M19.2 12a7.2 7.2 0 1 1-2.6-5.5" fill="none" stroke="${INK}" stroke-width="5.4"/>
    <path d="M19.2 12a7.2 7.2 0 1 1-2.6-5.5" fill="none" stroke="currentColor" stroke-width="2.4"/>
    <path d="M20.6 3.4 20.2 9.4 14.4 8.4Z" fill="currentColor" stroke="${INK}" stroke-width="1.8"/>`),

  home: svg('0 0 24 24', `
    <path d="M3 11.4 12 3.6l9 7.8h-2.4V20H14.4v-5.2H9.6V20H5.4v-8.6Z" fill="currentColor" stroke="${INK}" stroke-width="1.9"/>`),

  clock: svg('0 0 24 24', `
    <circle cx="12" cy="13" r="8.6" fill="#fffaf0" stroke="${INK}" stroke-width="2.1"/>
    <path d="M9.6 2.6h4.8M12 2.6v1.8" stroke="${INK}" stroke-width="2.1"/>
    <path d="M12 8v5.2l3.4 2" fill="none" stroke="var(--red)" stroke-width="2.2"/>`),

  nap: svg('0 0 26 24', `
    <path d="M2.6 19.6q.6-6.6 7.2-7.6 5.4-.6 8.8 2.2 2.6-.2 3.4 1.8 1.2 3.4-2.8 4.4H4.2q-1.8 0-1.6-.8Z" fill="#fffaf2" stroke="${INK}" stroke-width="1.9"/>
    <path d="M16.6 13.6l.8-2.4 1.8 2.2" fill="#4a3f4f" stroke="${INK}" stroke-width="1.5"/>
    <path d="M17 16.8q1 .8 2 0" fill="none" stroke="${INK}" stroke-width="1.3"/>
    <path d="M14 3h4.4L14 7.6h4.6M20.4 1.4h2.8l-2.8 2.8h2.8" fill="none" stroke="var(--teal)" stroke-width="1.8"/>`),

  check: svg('0 0 24 24', `<path d="M4.6 12.6 9.6 17.4 19.6 6.6" fill="none" stroke="${INK}" stroke-width="5"/><path d="M4.6 12.6 9.6 17.4 19.6 6.6" fill="none" stroke="currentColor" stroke-width="2.4"/>`),

  star: svg('0 0 24 24', `<path d="M12 2.4l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8Z" fill="currentColor" stroke="${INK}" stroke-width="1.8"/>`),

  // Thumbstick (gamepad left stick / touch stick) and the arrow-key cluster for keycaps.
  stick: svg('0 0 24 24', `
    <circle cx="12" cy="12" r="10" fill="rgba(43,29,46,.25)" stroke="${INK}" stroke-width="1.8"/>
    <circle cx="12" cy="12" r="5.6" fill="currentColor" stroke="${INK}" stroke-width="1.8"/>
    <path d="M12 2.6 10.4 4.6h3.2ZM12 21.4l-1.6-2h3.2ZM2.6 12l2 -1.6v3.2ZM21.4 12l-2-1.6v3.2Z" fill="${INK}"/>`),
  arrows: svg('0 0 30 20', `
    <rect x="10.6" y=".8" width="8.8" height="8.4" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <rect x="1" y="10.8" width="8.8" height="8.4" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <rect x="10.6" y="10.8" width="8.8" height="8.4" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <rect x="20.2" y="10.8" width="8.8" height="8.4" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <path d="M15 3.2 12.8 6.4h4.4ZM15 16.8l-2.2-3.2h4.4ZM3.2 15l3.2-2.2v4.4ZM26.8 15l-3.2-2.2v4.4Z" fill="currentColor"/>`),

  // Small Näsinneula used as the apostrophe of the logo (antenna, pod, a stub of shaft).
  needle: svg('0 0 20 64', `
    <path d="M10 1.6V20" stroke="${INK}" stroke-width="5.2"/>
    <path d="M10 1.6V20" stroke="#fff3c8" stroke-width="2"/>
    <circle cx="10" cy="3" r="2.6" fill="var(--red)" stroke="${INK}" stroke-width="1.8"/>
    <path d="M7.8 62.4 8.4 34H8L2.4 30.8V29.4L1.2 28.6V24.2L3.2 22.4V21Q10 17.4 16.8 21V22.4L18.8 24.2V28.6L17.6 29.4V30.8L12 34H11.6L12.2 62.4Z" fill="url(#uiNeedleGrad)" stroke="${INK}" stroke-width="2.4"/>
    <path d="M1.8 25.6H18.2" stroke="${INK}" stroke-width="1.6"/>
    <path d="M4.4 27.2h2M9 27.2h2M13.6 27.2h2" stroke="#3aa8d8" stroke-width="1.6"/>`, 'ico-needle'),

  // MEOW button: a little open cat mouth with sound arcs.
  meow: svg('0 0 28 24', `
    <path d="M4 9.5q5 0 6 4.2 1-4.2 6-4.2-.6 8.6-6 9.6-5.4-1-6-9.6Z" fill="#fff" stroke="${INK}" stroke-width="2"/>
    <path d="M19.4 7.6q2.4 3.6 0 7.4M22.6 4.8q4.2 6.2 0 13" fill="none" stroke="#fff" stroke-width="2.6"/>
    <path d="M19.4 7.6q2.4 3.6 0 7.4M22.6 4.8q4.2 6.2 0 13" fill="none" stroke="${INK}" stroke-width="1" opacity=".35"/>`),

  // Ribbon tail (logo subtitle, section banner): notched end, colour from --tail.
  tail: svg('0 0 32 34', `<path d="M31 2H2.4l8.4 15-8.4 15H31Z" fill="var(--tail, #b8352e)" stroke="${INK}" stroke-width="2.6"/><path d="M31 27.4 24 32H31Z" fill="${INK}" opacity=".35"/>`, 'ico-tail'),

  // Speech-bubble cat face used on hints (smaller cat head).
  catSmall: svg('0 0 40 36', CAT_HEAD(2.6), 'ico-cat'),
};

// Rank rosette: 16-point starburst + inner disc + ribbon tails. Colours via --rk (burst) and --rk2 (tails).
function burst(cx, cy, r1, r2, n) {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 ? r2 : r1;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`;
  }
  return d + 'Z';
}
export const ROSETTE = svg('0 0 120 140', `
  <path d="M34 92 22 136 40 126 50 140 62 98Z" fill="var(--rk2)" stroke="${INK}" stroke-width="4"/>
  <path d="M86 92 98 136 80 126 70 140 58 98Z" fill="var(--rk2)" stroke="${INK}" stroke-width="4"/>
  <path d="${burst(60, 60, 57, 47, 18)}" fill="var(--rk)" stroke="${INK}" stroke-width="4.4"/>
  <circle cx="60" cy="60" r="38" fill="#fff6dc" stroke="${INK}" stroke-width="4"/>
  <circle cx="60" cy="60" r="31" fill="none" stroke="var(--rk)" stroke-width="3" stroke-dasharray="2 5.4"/>`, 'ico-rosette');

export const GAUGE_TOWER = `
<svg class="gauge-svg" viewBox="0 0 60 300" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
  <path d="M30 66V8" stroke="var(--ink)" stroke-width="6.5" stroke-linecap="round"/>
  <path d="M30 66V8" stroke="#f4ecdc" stroke-width="2.6" stroke-linecap="round"/>
  <path d="${TOWER_PATH}" fill="#f4ecdc"/>
  <g clip-path="url(#uiTowerClip)">
    <rect class="gauge-fill" x="0" y="296" width="60" height="0" fill="url(#uiGaugeFill)"/>
    <path d="M7 76.6H53" stroke="var(--ink)" stroke-width="1.6"/>
    <path d="M11 79.4h4M19 79.4h4M27 79.4h6M37 79.4h4M45 79.4h4" stroke="#3aa8d8" stroke-width="2.6"/>
  </g>
  <path d="${TOWER_PATH}" fill="none" stroke="var(--ink)" stroke-width="3" stroke-linejoin="round"/>
  <circle class="gauge-tip" cx="30" cy="7" r="4.2" fill="var(--red)" stroke="var(--ink)" stroke-width="2.4"/>
</svg>`;

// Shared gradients and clip paths, injected once into a hidden <svg> by ui.init() (ids must be unique per page).
export const DEFS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
  <linearGradient id="uiNeedleGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff6c2"/><stop offset=".4" stop-color="#ffd23f"/><stop offset="1" stop-color="#f06a28"/>
  </linearGradient>
  <clipPath id="uiTowerClip"><path d="${TOWER_PATH}"/><rect x="28.7" y="5" width="2.6" height="64"/></clipPath>
  <linearGradient id="uiGaugeFill" x1="0" y1="1" x2="0" y2="0">
    <stop offset="0" stop-color="#ff7a3a"/><stop offset=".55" stop-color="#ffc93c"/><stop offset="1" stop-color="#fff08a"/>
  </linearGradient>
</defs></svg>`;
