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

1. Push this directory to a repository.
2. **Settings → Pages → Source** → *GitHub Actions*.
3. The workflow at `.github/workflows/pages.yml` fetches fresh data, builds, and
   publishes on every push to `main` (plus a weekly Monday refresh).

## Notes

- The benchmark tables for GLM-5.3 and the H100 timings for TRELLIS.2 are transcribed
  from the upstream model cards, with the source linked.
- Nothing is mirrored or redistributed here — every figure links back to the Hub.
