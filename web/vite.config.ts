import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The deployed origin for the link-preview tags in index.html (an image URL must be absolute there): SITE_URL, or on
// Vercel its production domain. Without either, the tags point at the page's own folder ("./"), which browsers
// resolve but link unfurlers may not.
const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const site = (process.env.SITE_URL || (vercel ? `https://${vercel}` : './')).replace(/\/?$/, '/');

export default defineConfig({
  root: here('.'),
  base: './',
  plugins: [react(), { name: 'site-url', transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', site) }],
  resolve: { alias: { '@engine': here('../engine/src'), '@data': here('../data') } },
  server: { fs: { allow: [here('..')] }, port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
