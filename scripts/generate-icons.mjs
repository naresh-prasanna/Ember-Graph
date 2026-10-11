// Renders the app icons in public/ from the brand mark. Run with `npm run icons`.
import fs from 'node:fs';
import sharp from 'sharp';

// A curve on a pair of axes, heating up as it climbs and ending in a burning point. Same drawing as the
// header mark in index.html, in the default ember colours.
const mark = (x, y, scale) => `
  <g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 8v48h48" stroke="#ffffff" stroke-opacity=".42" stroke-width="4"/>
    <path d="M10 50C26 50 30 18 50 14" stroke="url(#heat)" stroke-width="6" filter="url(#glow)"/>
    <circle cx="50" cy="14" r="12" fill="url(#spark)"/>
    <circle cx="50" cy="14" r="4.5" fill="#fff0df"/>
  </g>`;

const icon = ({ size, radius, inset }) => {
  const scale = (size - inset * 2) / 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="70%">
      <stop offset="0" stop-color="#1c120c"/><stop offset="1" stop-color="#08090a"/>
    </radialGradient>
    <linearGradient id="heat" x1="10" y1="50" x2="50" y2="14" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".35"/><stop offset=".55" stop-color="#ff783b"/>
      <stop offset="1" stop-color="#fff0df"/>
    </linearGradient>
    <radialGradient id="spark">
      <stop offset="0" stop-color="#ff783b" stop-opacity=".9"/><stop offset="1" stop-color="#ff783b" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="${size / 160}" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#bg)"/>${mark(inset, inset, scale)}
</svg>`;
};

fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/favicon.svg', icon({ size: 64, radius: 14, inset: 8 }));
const png = (svg, file) => sharp(Buffer.from(svg)).png().toFile(`public/${file}`);
await Promise.all([
  png(icon({ size: 192, radius: 40, inset: 34 }), 'pwa-192.png'),
  png(icon({ size: 512, radius: 108, inset: 92 }), 'pwa-512.png'),
  // Maskable icons are cropped to a circle: full-bleed background, mark inside the 80% safe zone.
  png(icon({ size: 512, radius: 0, inset: 136 }), 'pwa-maskable-512.png'),
  png(icon({ size: 180, radius: 0, inset: 34 }), 'apple-touch-icon.png'),
]);
console.log('icons written to public/');
