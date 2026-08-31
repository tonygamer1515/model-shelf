# TRELLIS Shelf

A single static page for Microsoft's two open-weights 3D generators, plus a
generator widget wired straight to the public TRELLIS.2 Space API.

| Model | Task | Licence |
| --- | --- | --- |
| [`microsoft/TRELLIS.2-4B`](https://huggingface.co/microsoft/TRELLIS.2-4B) | Image-to-3D | MIT |
| [`microsoft/TRELLIS-text-xlarge`](https://huggingface.co/microsoft/TRELLIS-text-xlarge) | Text-to-3D | MIT |

Everything is fetched from the **public** Hub API — no token, no account, nothing gated.

## The generator

Upload an image and the page calls `microsoft-trellis-2.hf.space` directly from your
browser. Microsoft's GPU does the work; this site has no backend and nothing to host.

```
POST /gradio_api/upload                    -> uploaded file path
POST /gradio_api/call/start_session        -> event_id
POST /gradio_api/call/image_to_3d          -> event_id   (15 params)
GET  /gradio_api/call/image_to_3d/<id>     -> SSE stream with the result
```

CORS on the Space already allows this origin, and `auth_required` is null.

### It is not unlimited, and no client can make it unlimited

The Space runs on Hugging Face **ZeroGPU**, which reserves **120 s of quota per call**
regardless of resolution, and caps each visitor per day:

| Account | Daily quota | Roughly |
| --- | --- | --- |
| Unauthenticated | 2 minutes | ~1 asset |
| Free account | 5 minutes | ~2 assets |
| PRO | 40 minutes | ~20 assets |

The quota is charged to the *visitor*, not to the site — which is precisely why hosting
this costs nothing. The widget accepts an optional HF token (kept in `localStorage`,
sent only to huggingface.co) so a user can spend their own larger allowance.

A real quota error, verbatim from the API:

```
You have exceeded your ZeroGPU quota (120s requested vs. 176s left).
Try again in 23:59:44.
```

The API returns an HTML preview (a stack of rendered views), **not** a GLB — the GLB
comes from a follow-up call that reads `gr.State` the API never sends back. For the file,
use [the Space's own interface](https://huggingface.co/spaces/microsoft/TRELLIS.2).

## How it works

```
scripts/fetch_models.py   GETs /api/models/<repo> + raw README.md for each model
                          -> data/models.json
scripts/build_site.py     embeds that JSON into index.template.html -> index.html
scripts/smoke-test.mjs    runs the page script against a DOM stub and invokes its handlers
```

`index.html` and `data/models.json` are **build outputs and are gitignored.** Only
`index.template.html` and the scripts are committed; CI regenerates the page on every
deploy. Committing the built file makes the branch and the workflow race over what
Pages serves, and the stale copy wins.

`index.html` is self-contained: inline CSS, embedded SVG, no CDN, no fonts, no external
JS. It opens correctly from `file://` with the snapshot baked in.

## Local

```bash
python3 scripts/fetch_models.py
python3 scripts/build_site.py
node scripts/smoke-test.mjs
python3 -m http.server 8000     # then open http://localhost:8000
```

## Deploying to GitHub Pages

Already configured: **Settings → Pages → Source** is *GitHub Actions*. Pushing to `main`
triggers `.github/workflows/pages.yml`, which fetches fresh Hub data, rebuilds, smoke
tests, and publishes. There is also a weekly Monday refresh.

> Pushing `.github/workflows/*` requires a token with the `workflow` scope.
> `gh auth login --web --scopes workflow` requests it; plain `gh auth login` does not.
