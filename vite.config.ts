import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Two build targets from one codebase:
//   `vite build`               -> GitHub Pages PWA  (dist/)
//   `vite build --mode single` -> one portable HTML (dist-single/nce-study.html)
//
// GitHub Pages serves project sites from /<repo>/, so the default build needs a
// base path. The single-file build is opened straight off disk, so it must use
// relative URLs instead.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';

  return {
    base: single ? './' : process.env.PAGES_BASE ?? '/nce-study/',
    plugins: single
      ? [
          viteSingleFile(),
          {
            // The portable file ships alone, so a manifest link would just 404.
            name: 'strip-manifest-for-single-file',
            transformIndexHtml(html: string) {
              return html.replace(/\s*<link rel="manifest"[^>]*>/, '');
            },
          },
        ]
      : [],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      // Inlining everything is what makes the single-file artifact portable.
      assetsInlineLimit: single ? 100_000_000 : 4096,
      cssCodeSplit: !single,
      rollupOptions: single ? { output: { inlineDynamicImports: true } } : {},
      // The bundle is large by design: all 500+ cards and their references are
      // inlined so the app works fully offline with no data fetch.
      chunkSizeWarningLimit: 1500,
    },
    define: {
      __SINGLE_FILE__: JSON.stringify(single),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
  };
});
