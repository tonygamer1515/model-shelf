# AI Sandbox

A static page that calls model APIs costing nothing, from the browser. No backend, no
signup, no key stored anywhere.

**Live:** https://tonygamer1515.github.io/model-shelf/

## The honest headline

**There is no unlimited free model API.** Every candidate was tested and each has a
ceiling, so the page publishes them instead of implying otherwise:

| Provider | Cost | Account | Ceiling |
| --- | --- | --- | --- |
| Pollinations image | $0 | none | 1 request / 15 s, basic models, free images may be watermarked |
| Pollinations text | $0 | none | same 1 req / 15 s |
| Puter.js | $0 for this site | visitor signs in free | 500+ models, Puter meters the visitor |
| HF ZeroGPU Spaces | $0 | none | 120 s reserved per call, ~2 min/day for guests |
| OpenRouter `:free` | $0/token | free key | 20 req/min, 50 req/day — excluded here by choice |
| DeepInfra | paid | key required | 401 without a key; not usable free |
| Groq / Cerebras / Together / Gemini | paid or capped | key required | 401/403 without credentials |

The three real options are: a free hosted API (always rate-limited), self-hosting open
weights (unmetered, but you buy the hardware), or a paid API.

## What it does

- **Chat & code** — Pollinations keyless by default, or Puter for the long tail of models.
- **Image** — Pollinations `sana`, keyless, with size and seed controls.
- Client-side throttling that respects the 15 s anonymous ceiling instead of hammering it.
- Speech, audio and video are **not** offered: no keyless API was found, and nothing is faked.

## How it works

```
scripts/fetch_sandbox.py   checks each provider live and parses the real limits out of
                           the upstream docs -> data/sandbox.json
scripts/build_site.py      embeds that JSON into index.template.html -> index.html
scripts/smoke-test.mjs     runs the page script against a DOM stub and drives its handlers
```

`fetch_sandbox.py` reads Pollinations' `APIDOCS.md` for the tier table rather than
trusting absent `x-ratelimit-*` headers — that mistake produced a false "no rate limit"
claim once already.

`index.html` and `data/sandbox.json` are **build outputs and are gitignored.** CI
regenerates them on every deploy; committing them makes the branch and the workflow race
over what Pages serves.

`index.html` is self-contained: inline CSS, embedded SVG, no CDN, no fonts. The Puter SDK
is loaded only if the visitor picks that provider.

## Local

```bash
python3 scripts/fetch_sandbox.py
python3 scripts/build_site.py
node scripts/smoke-test.mjs        # ~30 s: it exercises the real 15 s throttle twice
python3 -m http.server 8000
```

## Deploying

Already configured: **Settings → Pages → Source** is *GitHub Actions*. Pushing to `main`
runs `.github/workflows/pages.yml`, which re-verifies the providers, rebuilds, smoke tests
and publishes. Weekly refresh on Mondays.

> Pushing `.github/workflows/*` needs a token with the `workflow` scope.
> `gh auth login --web --scopes workflow` requests it; plain `gh auth login` does not.
