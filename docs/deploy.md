# Deploying 24×100 (Vercel)

The site is static: the app and a static JSON API (`/api/lots/<pin>.json`, `/api/blocks/<id>.json`,
`/api/city/summary.json`). No server, no database, no keys: nothing on Vercel calls a model. `vercel.json` holds
the settings, so the dashboard needs no build configuration.

| Setting | Value (from `vercel.json`) |
|---|---|
| Install | `npm ci` |
| Build | `npm run build` (the static API, then the site) |
| Output | `web/dist` (about 11,300 files, 53 MB) |
| Framework preset | Other |
| Environment variables | none needed; `SITE_URL` optional (link previews, below). Don't add `GOOGLE_API_KEY` (only the offline extraction uses it) |

The app routes by query string only (`/?view=lot&block=10K&lot=25`), so no rewrites are needed.

## Steps (dashboard)

1. **Import.** At vercel.com, choose Add New → Project → Import Git Repository, and pick `LeeSinLiang/24x100`. If
   it isn't listed, give the Vercel GitHub app access to the repository. A private repository works too.
2. **Check the settings.** Leave the root directory as the repository root, and leave Build and Output empty (they
   come from `vercel.json`). Under Settings → General → Node.js Version, pick 22.x or newer (Vite 8 needs Node
   20.19+ or 22.12+).
3. **Deploy.** Click Deploy; the build takes under a minute.
4. **Check the site** from a checkout, with Chrome installed:
   ```bash
   npm run smoke -- https://<your-project>.vercel.app/
   ```
   It opens the city view (6 districts, 428 too narrow), the what-if (196), lot 25 (4 ft), the builder's quote
   ($140/sf → WORTH PRICING THE SITE, $51k), the letters and the static API, and fails on any console error or
   failed request. The numbers come from `film/facts.json`, so it checks the site against what the film says.

Link previews (Slack, iMessage, social) need an absolute image URL. On Vercel the build takes the production
domain from `VERCEL_PROJECT_PRODUCTION_URL` (a system variable Vercel sets); elsewhere set `SITE_URL` (for example
`https://24x100.example/`) for the build. Without either the tags point at `./og.png`, which browsers resolve but
unfurlers may not.

## After the first green CI run on GitHub

`.github/workflows/ci.yml` has run step by step on a fresh local clone (macOS, Node 26), not yet on GitHub's
ubuntu-latest. Once the Actions tab shows it green, add the badge under the README's title:

```markdown
[![CI](https://github.com/LeeSinLiang/24x100/actions/workflows/ci.yml/badge.svg)](https://github.com/LeeSinLiang/24x100/actions/workflows/ci.yml)
```

If it's red, the likely suspect is the runner's Chrome (the no-score and trust-scan steps drive it through
Playwright's `chrome` channel); the typecheck, vitest, pytest and build steps don't touch a browser.

## One command instead

From the repository root, after `npx vercel login`:

```bash
npx vercel --prod
```

The first run asks to link a project; accept the defaults. `.vercelignore` keeps `.env`, caches and local
pipeline files out of the upload.

## What a clean clone builds

`npm run build` in a fresh clone produces exactly the site built on the machine that ran the pipeline. This was
checked on 27 Sep: the static API was byte-identical, and the city, lot, what-if, letter and review screens and
an outline inset all loaded with no errors.

- `scripts/build-city.ts` keeps the committed `data/city/lots.json` when the pipeline's work file isn't there.
- `scripts/build-api.ts` reads the lot outlines from the committed `data/city/outlines.json`.

To refresh the data, run the pipeline locally (`npm run rebuild`), commit, and push; Vercel redeploys on push.
