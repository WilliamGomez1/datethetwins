// Generates generic SVG placeholder portraits in public/images/placeholders/.
// Run: node scripts/make-placeholders.js
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'public', 'images', 'placeholders');
fs.mkdirSync(out, { recursive: true });

const palettes = [
  ['#F7C8B5', '#E8836B', '#7A3B2E'],
  ['#C9D8F2', '#7C97D6', '#2E3F6E'],
  ['#F5DFA8', '#E2A64B', '#6E4A16'],
  ['#CDE7D6', '#6FB38A', '#24533A'],
  ['#E6CDEB', '#B07CC0', '#4E2A5A'],
  ['#F9D3D9', '#E27D93', '#6B2537'],
];

function person(cx, baseY, scale, fill) {
  const r = 70 * scale;
  const headY = baseY - 260 * scale;
  const w = 170 * scale;
  return `
    <circle cx="${cx}" cy="${headY}" r="${r}" fill="${fill}" opacity="0.9"/>
    <path d="M ${cx - w} ${baseY} C ${cx - w} ${headY + 120 * scale}, ${cx + w} ${headY + 120 * scale}, ${cx + w} ${baseY} Z" fill="${fill}" opacity="0.9"/>`;
}

function portrait(name, [bg1, bg2, ink], label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 750" width="600" height="750" role="img" aria-label="${label}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/>
    </linearGradient>
  </defs>
  <rect width="600" height="750" fill="url(#g)"/>
  <circle cx="480" cy="120" r="140" fill="#fff" opacity="0.18"/>
  <circle cx="90" cy="640" r="110" fill="#fff" opacity="0.12"/>
  ${person(300, 750, 1.25, ink)}
  <text x="300" y="70" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="3" fill="${ink}" opacity="0.65">${label.toUpperCase()}</text>
</svg>`;
  fs.writeFileSync(path.join(out, name), svg);
}

let i = 0;
for (const twin of ['a', 'b']) {
  for (let n = 1; n <= 3; n++) {
    portrait(`twin-${twin}-${n}.svg`, palettes[i % palettes.length], 'Photo placeholder');
    i++;
  }
}
portrait('applicant.svg', palettes[4], 'Your photo');

// Hero image: the pair side by side
const [b1, b2, ink] = palettes[0];
const [c1, c2, ink2] = palettes[1];
fs.writeFileSync(path.join(out, 'pair.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800" width="1000" height="800" role="img" aria-label="Twins photo placeholder">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${b1}"/><stop offset="0.5" stop-color="${b2}"/><stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="1000" height="800" fill="url(#g)"/>
  <circle cx="820" cy="150" r="190" fill="#fff" opacity="0.16"/>
  <circle cx="140" cy="690" r="150" fill="#fff" opacity="0.12"/>
  ${person(360, 800, 1.35, ink)}
  ${person(640, 800, 1.35, ink2)}
  <text x="500" y="80" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="26" letter-spacing="4" fill="#fff" opacity="0.85">TWINS PHOTO PLACEHOLDER</text>
</svg>`);

console.log('Placeholders written to', out);
