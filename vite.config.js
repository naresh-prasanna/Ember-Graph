import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Build only: the dev server injects its own inline scripts. Inline style attributes come from matrix and colour markup.
const csp = {
  name: 'ember-csp',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html) {
      const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
        m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
      );
      const policy = [
        "default-src 'self'",
        `script-src 'self' ${hashes.join(' ')}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ');
      return html.replace(
        '<meta charset="utf-8" />',
        `$&\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  },
};

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  plugins: [
    csp,
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Ember Graph',
        short_name: 'Ember',
        description:
          'Graph functions, implicit curves, polar and parametric plots, regressions, surfaces and fractals.',
        theme_color: '#08090a',
        background_color: '#08090a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
