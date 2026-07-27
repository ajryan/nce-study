import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Stamps the built service worker with a version derived from everything else
 * in the build.
 *
 * This exists because the update prompt was dead on arrival without it. A
 * browser decides a service worker has changed by byte-comparing the fetched
 * script against the installed one — and `public/sw.js` is copied to `dist/`
 * verbatim, so it was identical on every single deploy. No new worker ever
 * installed, nothing ever reached `waiting`, and the "a new version is ready"
 * banner could never fire, however many times the app itself changed.
 *
 * The hash covers the *contents* of every emitted file rather than the asset
 * filenames alone, so an edit that changes only `index.html` still counts. It
 * is content-derived rather than a timestamp on purpose: rebuilding the same
 * source twice must produce the same worker, or every deploy would nag users
 * about an update that isn't one.
 */
function stampServiceWorkerVersion(): Plugin {
  let outDir = 'dist';
  return {
    name: 'stamp-sw-version',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    // closeBundle runs after Vite has copied publicDir, which is what puts
    // sw.js in place. Earlier hooks would race that copy.
    closeBundle() {
      const swPath = join(outDir, 'sw.js');
      if (!existsSync(swPath)) return;

      const files: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir).sort()) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) walk(full);
          else files.push(full);
        }
      };
      walk(outDir);

      const hash = createHash('sha256');
      for (const file of files) {
        if (file === swPath) continue; // it is what we are about to rewrite
        hash.update(relative(outDir, file).split(sep).join('/'));
        hash.update(readFileSync(file));
      }
      const build = hash.digest('hex').slice(0, 12);

      const source = readFileSync(swPath, 'utf8');
      const stamped = source.replace(
        /const VERSION = '[^']*';/,
        `const VERSION = 'nce-study-${build}';`,
      );
      if (stamped === source) {
        throw new Error(
          'stamp-sw-version: could not find the VERSION line in sw.js. Without it ' +
            'the update prompt silently stops working, so this is a build failure.',
        );
      }
      writeFileSync(swPath, stamped);
      console.log(`  service worker version  nce-study-${build}`);
    },
  };
}

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
      : [stampServiceWorkerVersion()],
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
