# Model Shelf

A single static page covering three open-weights models from the Hugging Face Hub:

| Model | Task | Licence |
| --- | --- | --- |
| [`zai-org/GLM-5.3`](https://huggingface.co/zai-org/GLM-5.3) | Text generation / agentic coding | Custom (Z.ai) |
| [`microsoft/TRELLIS.2-4B`](https://huggingface.co/microsoft/TRELLIS.2-4B) | Image-to-3D | MIT |
| [`microsoft/TRELLIS-text-xlarge`](https://huggingface.co/microsoft/TRELLIS-text-xlarge) | Text-to-3D | MIT |

Everything on the page is fetched from the **public** Hub API — no token, no account,
nothing gated.

## How it works

```
scripts/fetch_models.py   GETs /api/models/<repo> + raw README.md for each model
                          -> data/models.json
scripts/build_site.py     embeds that JSON into index.template.html -> index.html
```

`index.html` and `data/models.json` are **build outputs and are gitignored.** Only
`index.template.html` and the scripts are committed; CI regenerates the page on every
deploy. Committing the built file makes the branch and the workflow race over what
Pages serves, and the stale copy wins.

`index.html` is fully self-contained: inline CSS, embedded SVG, no CDN, no fonts, no
external JS. It opens correctly from `file://` with the snapshot baked in, and when
served over HTTP it quietly re-checks download/like counts against the Hub.

## Local

```bash
python3 scripts/fetch_models.py
python3 scripts/build_site.py
python3 -m http.server 8000     # then open http://localhost:8000
```

## Deploying to GitHub Pages

Already configured for this repo: **Settings → Pages → Source** is set to *GitHub
Actions*. Pushing to `main` triggers `.github/workflows/pages.yml`, which fetches fresh
Hub data, rebuilds, and publishes. There is also a weekly Monday refresh.

Because the page is built by CI, `index.html` does not exist in the repository — only
in the published site and in your local build.

> Note: pushing `.github/workflows/*` requires a token with the `workflow` scope.
> `gh auth login --web --scopes workflow` requests it; the default `gh auth login`
> does not.

## Notes

- The benchmark tables for GLM-5.3 and the H100 timings for TRELLIS.2 are transcribed
  from the upstream model cards, with the source linked.
- Nothing is mirrored or redistributed here — every figure links back to the Hub.
