# eetunetti.com

One page, plain HTML and CSS, served by GitHub Pages. No build step, no dependencies.

## Editing

- `index.html` — all the copy lives here. Edit text directly.
- `assets/style.css` — colours at the top under `:root` (light) and `prefers-color-scheme: dark`.
- `assets/field.js` — the background: contour lines of a slowly shifting height field, with crosses that pop onto the lines near the pointer and fade. Tunables at the top. Delete the `<canvas>` and `<script>` tags to turn it off.
- `404.html` — shown for any old or wrong URL.
- `assets/og.png` — social preview image (1200×630). Regenerate if the name or title line changes.
- `assets/fonts/` — IBM Plex Sans (variable) and Plex Mono, self-hosted, OFL licence.

Push to `main` and GitHub Pages deploys it. `.nojekyll` tells Pages to serve files as-is.
