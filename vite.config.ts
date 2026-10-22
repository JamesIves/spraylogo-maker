import { minify } from 'html-minifier-terser';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Minifies the built index.html. Vite bundles the scripts and styles it links
 * to but leaves the markup itself as written.
 */
function minifyHtml(): Plugin {
  return {
    name: 'minify-html',
    apply: 'build',
    enforce: 'post',
    /**
     * Runs the minifier over the finished page.
     */
    transformIndexHtml: (html) =>
      minify(html, {
        collapseWhitespace: true,
        removeComments: true,
        useShortDoctype: true,
        minifyCSS: true,
      }),
  };
}

export default defineConfig({
  // The page and its code live in src; static files in public; output in dist.
  root: 'src',
  publicDir: '../public',
  // Relative paths so the build works from any GitHub Pages sub-path.
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Lists the licences of the libraries bundled into the site.
    license: { fileName: 'licenses.md' },
  },
  plugins: [minifyHtml()],
  worker: {
    format: 'es',
  },
  test: {
    include: ['**/*.test.ts'],
  },
});
