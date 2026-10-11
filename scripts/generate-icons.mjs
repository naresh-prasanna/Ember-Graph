// Renders every icon in public/ from the painted artwork in scripts/icon-art.jpg: the app icons, the
// browser tab icon and the logo in the header. Run with `npm run icons`.
import sharp from 'sharp';

const ART = 'scripts/icon-art.jpg',
  // Where the rounded square sits in the artwork, and how rounded it is (share of its width).
  ART_BOX = { left: 71, top: 64, width: 882, height: 898 },
  ART_RADIUS = 0.22,
  // The artwork's sky, top to bottom, for icons that must fill a full square.
  SKY = ['#15142a', '#07030f'],
  // A 256-colour palette keeps the 512px icons, which every install downloads, a fraction of their size.
  PNG = { palette: true, quality: 92, effort: 10, compressionLevel: 9 };

// The artwork cut out with its own rounded corners. With `fill`, its corners are filled with the sky
// colours: iOS rounds the icon itself and needs it opaque.
async function painted(size, file, { fill = false } = {}) {
  const corner = `<svg width="${size}" height="${size}"><rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="${size * ART_RADIUS}" fill="#fff"/></svg>`,
    resized = sharp(ART).extract(ART_BOX).resize(size, size, { fit: 'fill', kernel: 'lanczos3' }),
    // Shrunk to a few dozen pixels, the curve and axes go soft without a little sharpening.
    art = await (size <= 128 ? resized.sharpen({ sigma: 0.6 }) : resized)
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
    .png(PNG)
    .toFile(`public/${file}`);
}

// Maskable icons can be cropped to a circle holding only the middle 80%, which would cut off the star in
// the corner. The scene shrinks into that circle over a blurred copy of its own sky, with feathered edges.
async function bleed(size, file, { inset = 45, scale = 0.74 } = {}) {
  const square = sharp(ART).extract({
      left: ART_BOX.left + inset,
      top: ART_BOX.top + inset,
      width: ART_BOX.width - inset * 2,
      height: ART_BOX.height - inset * 2,
    }),
    inner = Math.round(size * scale),
    feather = Math.round(inner * 0.06),
    edge = `<svg width="${inner}" height="${inner}"><defs><filter id="f"><feGaussianBlur stdDeviation="${feather / 2}"/></filter></defs><rect x="${feather}" y="${feather}" width="${inner - feather * 2}" height="${inner - feather * 2}" rx="${feather * 2}" fill="#fff" filter="url(#f)"/></svg>`,
    sky = await square
      .clone()
      .resize(size, size, { fit: 'fill' })
      .blur(size / 40)
      .modulate({ brightness: 0.55 })
      .png()
      .toBuffer(),
    scene = await square
      .clone()
      .resize(inner, inner, { fit: 'fill' })
      .ensureAlpha()
      .composite([{ input: Buffer.from(edge), blend: 'dest-in' }])
      .png()
      .toBuffer(),
    at = Math.round((size - inner) / 2);
  await sharp(sky)
    .composite([{ input: scene, left: at, top: at }])
    .png(PNG)
    .toFile(`public/${file}`);
}

await Promise.all([
  painted(32, 'favicon-32.png'),
  painted(64, 'favicon-64.png'),
  painted(96, 'logo-96.png'),
  painted(192, 'pwa-192.png'),
  painted(512, 'pwa-512.png'),
  bleed(512, 'pwa-maskable-512.png'),
  painted(180, 'apple-touch-icon.png', { fill: true }),
]);
console.log('icons written to public/');
