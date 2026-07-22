import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import glsl from 'vite-plugin-glsl';

// Dev (`npm run dev`): serves the sandbox pages — index.html (dots) and
//   garden.html (garden) — for iterating on each scene in isolation.
// Build (`npm run build`): bundles js/index-page.js (both scenes layered) into
//   Django's static dir so the Index template can load it with {% static %}.
export default defineConfig(({ command }) => {
  const isBuild = command === 'build';
  return {
    plugins: [glsl()],
    // In the built bundle, asset URLs (t1.png, the garden jpg, …) are prefixed
    // with this so they resolve under Django's static route.
    base: isBuild ? '/static/alphabetcity/index/' : '/',
    build: isBuild
      ? {
          outDir: fileURLToPath(new URL('../alphabetcity/static/alphabetcity/index', import.meta.url)),
          emptyOutDir: true,
          rollupOptions: {
            input: fileURLToPath(new URL('./js/index-page.js', import.meta.url)),
            output: {
              entryFileNames: 'index-bundle.js',
              inlineDynamicImports: true,
              assetFileNames: 'assets/[name][extname]',
            },
          },
        }
      : {},
  };
});
