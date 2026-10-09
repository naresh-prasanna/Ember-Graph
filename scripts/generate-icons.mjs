// Renders the app icons in public/ from the brand mark. Run with `npm run icons`.
import fs from 'node:fs';
import sharp from 'sharp';

const mark = (x, y, scale) => `
  <g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="#ff783b" filter="url(#glow)">
    <path d="M18 2v32M2 18h32M7 7l22 22M7 29L29 7" stroke-width="1.1" opacity=".75"/>
    <circle cx="18" cy="18" r="7" stroke-width="1.4"/>
    <circle cx="18" cy="18" r="2.2" fill="#ff783b" stroke="none"/>
  </g>`;

const icon = ({ size, radius, inset }) => {
  const scale = (size - inset * 2) / 36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="70%">
      <stop offset="0" stop-color="#1c120c"/><stop offset="1" stop-color="#08090a"/>
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
fs.writeFileSync('public/favicon.svg', icon({ size: 64, radius: 14, inset: 12 }));
const png = (svg, file) => sharp(Buffer.from(svg)).png().toFile(`public/${file}`);
await Promise.all([
  png(icon({ size: 192, radius: 40, inset: 34 }), 'pwa-192.png'),
  png(icon({ size: 512, radius: 108, inset: 92 }), 'pwa-512.png'),
  // Maskable icons are cropped to a circle: full-bleed background, mark inside the 80% safe zone.
  png(icon({ size: 512, radius: 0, inset: 136 }), 'pwa-maskable-512.png'),
  png(icon({ size: 180, radius: 0, inset: 34 }), 'apple-touch-icon.png'),
]);
console.log('icons written to public/');
