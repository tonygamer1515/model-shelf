#!/usr/bin/env python3
"""
Fetch live metadata + README cards for the tracked models from the Hugging Face Hub.

Writes site/data/models.json, which index.html embeds as static data so the page works
offline, and then optionally refreshes in the browser from the same public API.

No authentication required: every endpoint used here is public and read-only.

Usage:
    python3 scripts/fetch_models.py [--out site/data/models.json]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://huggingface.co/api/models/{repo}"
RAW_README = "https://huggingface.co/{repo}/raw/main/README.md"

MODELS = [
    {
        "repo": "zai-org/GLM-5.3",
        "role": "Agentic coding LLM",
        "blurb": (
            "Post-training refresh of the GLM-5.2 base. Open-weights SOTA on "
            "Terminal Bench 3.0 and Agents' Last Exam."
        ),
        "accent": "#5b8cff",
    },
    {
        "repo": "microsoft/TRELLIS.2-4B",
        "role": "Image-to-3D generator",
        "blurb": (
            "Flow-matching transformer over the field-free O-Voxel structure. "
            "Up to 1536^3 resolution with PBR materials."
        ),
        "accent": "#37d0a0",
    },
    {
        "repo": "microsoft/TRELLIS-text-xlarge",
        "role": "Text-to-3D generator",
        "blurb": (
            "XL text-conditioned TRELLIS checkpoint from the Structured 3D Latents paper."
        ),
        "accent": "#f0a44a",
    },
]

UA = "hf-model-showcase/1.0 (+https://github.com)"


def get(url: str, timeout: int = 45) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        return 0, str(err).encode()


def fetch_one(entry: dict) -> dict:
    repo = entry["repo"]
    status, body = get(API.format(repo=repo))
    meta = json.loads(body) if status == 200 else {}

    card_status, card = get(RAW_README.format(repo=repo))
    card_text = card.decode("utf-8", "replace").strip() if card_status == 200 else ""

    record = {
        "repo": repo,
        "role": entry["role"],
        "blurb": entry["blurb"],
        "accent": entry["accent"],
        "url": f"https://huggingface.co/{repo}",
        "ok": status == 200,
        "http_status": status,
        "pipeline_tag": meta.get("pipeline_tag"),
        "library_name": meta.get("library_name"),
        "license": (meta.get("cardData") or {}).get("license")
        or next((t.split("license:", 1)[1] for t in meta.get("tags", []) if t.startswith("license:")), None),
        "downloads": meta.get("downloads"),
        "likes": meta.get("likes"),
        "last_modified": meta.get("lastModified"),
        "revision": meta.get("sha"),
        "params": (meta.get("safetensors") or {}).get("total"),
        "tags": [t for t in meta.get("tags", []) if not t.startswith("region:")][:16],
        "readme": card_text,
    }
    print(
        f"  {repo:<34} api={status} readme={card_status} "
        f"params={record['params']} downloads={record['downloads']}",
        file=sys.stderr,
    )
    return record


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent.parent / "data" / "models.json"),
    )
    args = parser.parse_args()

    print("Fetching from the Hugging Face Hub (public API, read-only)...", file=sys.stderr)
    models = [fetch_one(entry) for entry in MODELS]

    failures = [m["repo"] for m in models if not m["ok"]]
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "https://huggingface.co/api/models",
        "models": models,
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Wrote {out} ({out.stat().st_size:,} bytes)", file=sys.stderr)
    if failures:
        print(f"WARNING: failed to fetch: {', '.join(failures)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
