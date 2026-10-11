// Renders the app icons in public/. Run with `npm run icons`.
// Large icons use the painted artwork in scripts/icon-art.jpg; the favicon is a vector drawing of the
// same scene, since stars and sparks turn to noise at 16px.
import fs from 'node:fs';
import sharp from 'sharp';

const ART = 'scripts/icon-art.jpg',
  // Where the rounded square sits in the artwork, and how rounded it is (share of its width).
  ART_BOX = { left: 71, top: 64, width: 882, height: 898 },
  ART_RADIUS = 0.22,
  // The artwork's sky, top to bottom, for icons that must fill a full square.
  SKY = ['#09091a', '#151838'];

// Axes with arrowheads, a curve rising through the origin, and a star where it ends. Same drawing as the
// header mark in index.html.
const mark = (x, y, scale) => `
  <g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M24 58V9M6 40h50" stroke="#ffb46b" stroke-opacity=".75" stroke-width="3"/>
    <path d="M19.5 15 24 7l4.5 8zM50 35.5l8 4.5-8 4.5z" fill="#ffb46b" fill-opacity=".9" stroke="none"/>
    <path d="M7 51c8 0 13-4 17-11 6-11 12-25 26-27" stroke="url(#heat)" stroke-width="5" filter="url(#glow)"/>
    <circle cx="50" cy="13" r="13" fill="url(#spark)"/>
    <path d="M50 3q1.4 8.6 10 10-8.6 1.4-10 10-1.4-8.6-10-10 8.6-1.4 10-10z" fill="#fff4e4"/>
  </g>`;

const vector = ({ size, radius, inset }) => {
  const scale = (size - inset * 2) / 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${SKY[0]}"/><stop offset="1" stop-color="${SKY[1]}"/>
    </linearGradient>
    <linearGradient id="heat" x1="7" y1="51" x2="50" y2="13" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ff8a3d" stop-opacity=".55"/><stop offset=".5" stop-color="#ffa451"/>
      <stop offset="1" stop-color="#fff0df"/>
    </linearGradient>
    <radialGradient id="spark">
      <stop offset="0" stop-color="#ffb05c" stop-opacity=".95"/><stop offset="1" stop-color="#ff8a3d" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="${size / 160}" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${size}" height="${size}" rx="${radius}" fill="url(#bg)"/>${mark(inset, inset, scale)}
</svg>`;
};

// The artwork cut out with its own rounded corners. With `fill`, its corners are filled with the sky
// colours: iOS rounds the icon itself and needs it opaque.
async function painted(size, file, { fill = false } = {}) {
  const corner = `<svg width="${size}" height="${size}"><rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="${size * ART_RADIUS}" fill="#fff"/></svg>`,
    art = await sharp(ART)
      .extract(ART_BOX)
      .resize(size, size, { fit: 'fill' })
      .ensureAlpha()
      .composite([{ input: Buffer.from(corner), blend: 'dest-in' }])
      .png()
      .toBuffer(),
    base = fill
      ? Buffer.from(
          `<svg width="${size}" height="${size}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SKY[0]}"/><stop offset="1" stop-color="${SKY[1]}"/></linearGradient></defs><rect width="${size}" height="${size}" fill="url(#s)"/></svg>`,
        )
      : { create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } };
  await sharp(base)
    .composite([{ input: art }])
    .png()
    .toFile(`public/${file}`);
}

// Maskable icons are cropped by the system (often to a circle), so they take the artwork square-cut,
// edge to edge, from inside its rounded corners.
const bleed = (size, file, inset = 45) =>
  sharp(ART)
    .extract({
      left: ART_BOX.left + inset,
      top: ART_BOX.top + inset,
      width: ART_BOX.width - inset * 2,
      height: ART_BOX.height - inset * 2,
    })
    .resize(size, size, { fit: 'fill' })
    .png()
    .toFile(`public/${file}`);

fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/favicon.svg', vector({ size: 64, radius: 14, inset: 4 }));
await Promise.all([
  painted(192, 'pwa-192.png'),
  painted(512, 'pwa-512.png'),
  bleed(512, 'pwa-maskable-512.png'),
  painted(180, 'apple-touch-icon.png', { fill: true }),
]);
console.log('icons written to public/');
