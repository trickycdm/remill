/**
 * check-contrast.mjs — WCAG 2.1 contrast audit for the Overprint token table.
 *
 * Manual tool for tuning the palette in src/tailwind.css (the CI gate is the
 * axe sweep in e2e). Run with:  node scripts/check-contrast.mjs
 *
 * Prints every text/background pairing the design system promises, per theme,
 * with its ratio and the AA verdict it must meet:
 *   body  = 4.5:1 (normal text)     large = 3:1 (18px+ / 14px bold, UI)
 *
 * Update TOKENS when tuning; the table here mirrors src/tailwind.css and the
 * PAIRS list encodes the pairings DESIGN_SYSTEM.md guarantees.
 */

const TOKENS = {
  light: {
    canvas: '#f6f1e3',
    surface: '#fbf8ee',
    'surface-raised': '#fffdf6',
    hover: '#ece5d2',
    ink: '#23364a',
    'ink-muted': '#4a5c6e',
    'ink-subtle': '#566778',
    accent: '#0078bf',
    'accent-fg': '#ffffff',
    'accent-text': '#00639c',
    'accent-soft': '#ddeaf3',
    pop: '#ef2c9b',
    'pop-text': '#b8156e',
    'pop-soft': '#fbe3ef',
    overlap: '#5348b8',
    ring: '#0078bf',
    success: '#22703f',
    'success-soft': '#e2efe2',
    warning: '#8a5a10',
    'warning-soft': '#f4e8cd',
    danger: '#b02e21',
    'danger-soft': '#f8e0da',
    'danger-solid': '#b02e21',
    info: '#0f6f86',
    'info-soft': '#dcebee',
  },
  dark: {
    canvas: '#191c30',
    surface: '#232741',
    'surface-raised': '#2a2f4e',
    hover: '#2e3452',
    ink: '#f2ecdd',
    'ink-muted': '#bcb9c4',
    'ink-subtle': '#a3a0b2',
    accent: '#4dd8e6',
    'accent-fg': '#10233c',
    'accent-text': '#4dd8e6',
    'accent-soft': '#14364a',
    pop: '#ff48b0',
    'pop-text': '#ff77c4',
    'pop-soft': '#3d1a30',
    overlap: '#a89cf0',
    ring: '#4dd8e6',
    success: '#5fca8a',
    'success-soft': '#143424',
    warning: '#e0a94e',
    'warning-soft': '#3a2f18',
    danger: '#f08a7e',
    'danger-soft': '#3f1c20',
    'danger-solid': '#c03a2b',
    info: '#59b6d0',
    'info-soft': '#12333f',
  },
};

/** [foreground, background, min ratio, note] — the system's promised pairings. */
const PAIRS = [
  ['ink', 'canvas', 4.5, 'body text on app background'],
  ['ink', 'surface', 4.5, 'body text on cards'],
  ['ink', 'surface-raised', 4.5, 'body text on dialogs'],
  ['ink-muted', 'canvas', 4.5, 'secondary text'],
  ['ink-muted', 'surface', 4.5, 'secondary text on cards'],
  ['ink-muted', 'accent-soft', 4.5, 'meta text on tinted bands'],
  ['ink-subtle', 'canvas', 4.5, 'meta/placeholder'],
  ['ink-subtle', 'surface', 4.5, 'meta on cards'],
  ['ink-subtle', 'hover', 4.5, 'meta inside a hovered row (axe reads hover state)'],
  ['ink-muted', 'hover', 4.5, 'secondary text inside a hovered row'],
  ['ink', 'hover', 4.5, 'body text inside a hovered row'],
  ['accent-fg', 'accent', 4.5, 'text on accent fill (buttons)'],
  ['accent-text', 'canvas', 4.5, 'links/labels on canvas'],
  ['accent-text', 'surface', 4.5, 'links/labels on cards'],
  ['accent-text', 'accent-soft', 4.5, 'accent text on its own wash'],
  ['pop-text', 'canvas', 4.5, 'pink as text (rare, events)'],
  ['pop-text', 'surface', 4.5, 'pink text on cards'],
  ['pop-text', 'pop-soft', 4.5, 'pink text on pink wash'],
  ['pop', 'canvas', 3.0, 'pink as LARGE/bold/graphic only'],
  ['overlap', 'canvas', 3.0, 'violet mark (graphic)'],
  ['ring', 'canvas', 3.0, 'focus ring vs canvas (non-text)'],
  ['ring', 'surface', 3.0, 'focus ring vs cards'],
  ['success', 'surface', 4.5, 'status text'],
  ['success', 'success-soft', 4.5, 'status text on wash'],
  ['warning', 'surface', 4.5, 'status text'],
  ['warning', 'warning-soft', 4.5, 'status text on wash'],
  ['danger', 'surface', 4.5, 'status text'],
  ['danger', 'danger-soft', 4.5, 'status text on wash'],
  ['#ffffff', 'danger-solid', 4.5, 'white on destructive fill'],
  ['info', 'surface', 4.5, 'status text'],
  ['info', 'info-soft', 4.5, 'status text on wash'],
];

function srgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
}
const lum = (hex) => {
  const [r, g, b] = srgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

let failures = 0;
for (const theme of ['light', 'dark']) {
  const t = TOKENS[theme];
  const resolve = (name) => (name.startsWith('#') ? name : t[name]);
  console.log(`\n━━ ${theme.toUpperCase()} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  for (const [fg, bg, min, note] of PAIRS) {
    const r = ratio(resolve(fg), resolve(bg));
    const ok = r >= min;
    if (!ok) failures++;
    console.log(
      `${ok ? '  ✓' : '  ✗'} ${r.toFixed(2).padStart(6)} (min ${min})  ${fg} on ${bg}  · ${note}${ok ? '' : '   ← FAIL'}`,
    );
  }
}
console.log(failures ? `\n${failures} pairing(s) FAIL — tune before P1 merges.` : '\nAll pairings pass.');
process.exit(failures ? 1 : 0);
