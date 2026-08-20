import { defineConfig } from 'vite';

// This app is deployed under /3d/ alongside the static PWA at the site
// root (see /build.mjs), so asset URLs Vite generates need that prefix.
export default defineConfig({
  base: '/3d/',
});
