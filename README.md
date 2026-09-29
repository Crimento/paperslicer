# Paperslicer

**One scene. Every screen.** A browser-only, physical-size-aware wallpaper slicer for mixed-monitor setups. Built with Vue 3, TypeScript, Vite, Tailwind CSS 4, and daisyUI 5; deployable to GitHub Pages. No uploads, backend, account, analytics, external fonts, or runtime CDN dependencies.

## Run locally

Use Node 24 LTS. The complete toolchain, including tests, supports Node 22 (22.12+), Node 24, or Node 26+.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Start with the built-in generated landscape, or choose/drop a JPEG or PNG.

## Workflow

1. **Your desk:** add up to eight monitors, enter native pixel dimensions and diagonal size, and drag them into place. The example is a 27-inch 1920×1080 monitor beside a 34-inch 3440×1440 ultrawide.
2. Physical size is calculated from the diagonal and **actual pixel aspect ratio**, not labels such as “2K” or “21:9.” Enable **Use measured active area** for exact dimensions. Measure the lit panel, without bezels, in its unrotated orientation.
3. Set orientation and use physical X/Y coordinates for precise placement. Leave physical gaps for bezels or space between screens. Top/center/bottom alignment buttons align the screens vertically.
4. **Your wallpaper:** drag the image, scroll to scale around the pointer, or enter a scale percentage. Use cover/contain actions and edge/center alignment buttons. The separate **View** zoom changes only the editor, not the wallpaper.
5. Export and download one native-resolution PNG per monitor. Assign each file to its corresponding monitor in your OS wallpaper settings; do not use the OS’s combined “span” mode.

**Keyboard:** focus a screen or the wallpaper canvas and use arrow keys to move 1 mm; Shift+arrow moves 10 mm. Hold Shift while dragging to bypass snapping. Snapping uses an 8 CSS-pixel threshold at the current editor zoom.

Monitor settings, background color, and the snapping preference are saved in local storage. Images and their composition are session-only and must be reopened after a reload. The app does not detect physical monitor dimensions or apply desktop wallpaper automatically.

## Interface and theme

The interface uses daisyUI buttons, cards, inputs, selectors, toggles, range controls, badges, alerts, progress, and a native-dialog modal. Tailwind handles responsive layout; custom CSS is limited to the theme, page background, and SVG drafting guides.

The custom **ultraviolet** theme lives in `src/style.css`, with **`#9400D3` as primary**, dark plum surfaces, and lavender secondary accents. `index.html` selects it with `data-theme="ultraviolet"`. Change the semantic theme tokens rather than individual component colors. The wallpaper’s background color is independent of the UI theme, so a restyle does not change existing exports or saved settings.

All styling is compiled locally through `@tailwindcss/vite`; there are no browser/CDN styling dependencies or remote fonts.

## Geometry

The shared workspace is measured in **millimeters**, not combined native pixels:

- Each monitor has a physical rectangle and an independent native output resolution.
- The image has one uniform transform in mm per original source pixel.
- Export intersects each physical monitor rectangle with the image, maps that region back to original source pixels, and resamples it to the monitor’s native output pixels.
- Negative coordinates, portrait orientation, mixed pixel densities, gaps, and partially uncovered monitors are supported. Uncovered regions and transparent PNG pixels are composited over the selected background.

This keeps features the same physical size across different-density screens. It models flat, axis-aligned panels; it does not perform perspective correction for angled or curved displays.

## Image processing and limits

- JPEG and PNG only; actual file signatures are checked. SVG and other formats are intentionally deferred.
- Up to **150 MiB**, **120 megapixels**, and **32,768 px per side** for source images.
- Up to **40 megapixels** and **16,384 px per side** per output (includes 8K UHD).
- JPEG dimension-header inspection is limited to the first **1 MiB**; unusually large leading metadata is rejected with guidance to re-save the image.
- The preview’s longest side is at most **2048 px**. Export always decodes the original file and renders each monitor separately—there is no giant combined output canvas.
- A module worker and `OffscreenCanvas` handle processing when supported. A main-thread canvas fallback is provided. Decoded originals are released after preview generation/export, and object URLs are revoked when no longer needed.
- **These limits reduce risk; they do not guarantee a given image fits available memory.** Even thumbnail generation may require a full decode. A 120 MP RGBA buffer alone is approximately 480 MB, and browsers may allocate additional copies. Resize particularly large sources externally if the browser runs out of memory.
- Browser decoders handle JPEG EXIF orientation; the app uses decoded oriented dimensions consistently for preview and export. Extremely large/complex/animated PNGs are not an intended use case. TIFF and FITS are not supported.

## Validation

```sh
npm run test       # Pure geometry, image pipeline, settings, and validation tests
npm run build      # Vue/TypeScript checking and production build
npm run check      # Unit tests + production build
```

End-to-end tests use a project-local Playwright Chromium install:

```sh
PLAYWRIGHT_BROWSERS_PATH=.playwright npx playwright install chromium --only-shell
npm run test:e2e
```

Alternatively, use an existing Chromium installation (adjust the executable path for your system):

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e
```

On minimal Linux systems, Playwright may also require system libraries (`npx playwright install-deps chromium`). Browser tests start and stop their own local Vite development and production-preview servers. They cover monitor editing/persistence, dragging, wallpaper scaling, separate view zoom, mixed-DPI pixel output, background fill, original-size PNG downloads, EXIF-oriented JPEGs, fallback processing, rejected SVGs, mobile layout, and the built app/worker under a GitHub Pages-style `/paperslicer/` subpath.

## GitHub Pages

The **NodeJS build** workflow in `.github/workflows/deploy.yml` follows a branch-based deployment with `peaceiris/actions-gh-pages@v4`:

1. Push the repository to GitHub with `main` as its default branch. The initial successful build creates the `gh-pages` branch.
2. In **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then **`gh-pages` → `/ (root)`**. This replaces the earlier **GitHub Actions** Pages source setting.
3. Subsequent pushes to `main` rebuild and publish the site. Pull requests targeting `main` run checks only; they never publish.

The build job uses **Node 22.x**, npm caching, `npm ci`, and `npm run check` (unit tests, type checking, and the production build). A separate deployment job downloads the built `dist/` artifact and publishes it to `gh-pages`. Only this push-to-main job has `contents: write`; the PR/build job is read-only. No personal access token is needed—GitHub supplies `GITHUB_TOKEN`. Repository or organization policies must permit the workflow to push to `gh-pages`.

Vite uses a relative asset base, so both repository subpaths and custom-domain roots work without editing a repository name into the build. Browser tests exercise the production app and its worker under `/paperslicer/`. There is no client-side router requiring a Pages fallback.

## Code map

- `src/App.vue` — daisyUI application shell, state, persistence, import/export orchestration.
- `src/style.css` — Tailwind/daisyUI setup, ultraviolet theme, and SVG drafting guides.
- `src/components/MonitorLayout.vue` — physical layout editor, keyboard movement, snapping guides.
- `src/components/MonitorSettings.vue` — native/physical dimensions and placement controls.
- `src/components/WallpaperComposer.vue` — preview mask, image transforms, view zoom.
- `src/lib/geometry.ts` — framework-independent physical geometry and export mapping.
- `src/lib/image.ts`, `image.worker.ts`, `image-processing.ts` — local image decoding, previews, and sequential native-resolution export.
- `src/lib/image-headers.ts` — format/dimension preflight and memory-related limits.
- `src/lib/settings.ts` — defaults and validation of persisted monitor profiles.

## Deliberately deferred

SVG input, ZIP downloads, named/importable monitor profiles, undo/redo, additional image formats, tiled decoders for images beyond browser memory limits, and perspective correction. The current export is a set of individual PNG download links.
