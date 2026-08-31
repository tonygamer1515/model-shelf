#!/usr/bin/env python3
"""
Verify the free model APIs this sandbox uses, and record their real limits.

Writes site/data/sandbox.json. Every provider here has been checked for its actual
ceiling, because none of them is unlimited — that is recorded in the output rather
than left to be discovered by the user at runtime.

  * Pollinations — keyless, CORS `*`, but anonymous is 1 request / 15 s.
  * Puter.js     — no API key for the site; the visitor signs in free.

Usage:
    python3 scripts/fetch_sandbox.py [--out site/data/sandbox.json]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

UA = "ai-sandbox/1.0"
PUTER_SDK = "https://js.puter.com/v2/"
POLL_DOCS = (
    "https://raw.githubusercontent.com/pollinations/pollinations/master/APIDOCS.md"
)


def get(url: str, timeout: int = 45):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        return 0, str(err).encode()


def get_json(url: str, default):
    status, body = get(url)
    if status != 200:
        print(f"  WARN {url} -> HTTP {status}", file=sys.stderr)
        return status, default
    try:
        return status, json.loads(body)
    except json.JSONDecodeError as err:
        print(f"  WARN {url} -> bad JSON: {err}", file=sys.stderr)
        return status, default


def pollinations() -> dict:
    st_text, text_models = get_json("https://text.pollinations.ai/models", [])
    st_img, img_models = get_json("https://image.pollinations.ai/models", [])

    # Pull the real limits out of the upstream docs instead of trusting absent headers.
    st_doc, doc = get(POLL_DOCS)
    doc_text = doc.decode("utf-8", "replace") if st_doc == 200 else ""
    anon = re.search(
        r"\|\s*Anonymous\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|", doc_text
    )
    paid = re.search(
        r"\|\s*(Flower|Nectar|Blossom)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|",
        doc_text,
    )
    watermark = "watermark" in doc_text.lower()

    print(f"  pollinations text  : HTTP {st_text} -> {len(text_models)} model(s)", file=sys.stderr)
    print(f"  pollinations image : HTTP {st_img} -> {img_models}", file=sys.stderr)
    print(
        "  pollinations limits: anonymous="
        f"{anon.group(1).strip() if anon else 'unknown'}"
        f", paid tier={'yes' if paid else 'not found'}, watermark={'yes' if watermark else 'no'}",
        file=sys.stderr,
    )

    return {
        "ok": st_text == 200 and st_img == 200,
        "docs_ok": st_doc == 200,
        "anonymous_limit": anon.group(1).strip() if anon else None,
        "anonymous_models": anon.group(2).strip() if anon else None,
        "has_paid_tier": bool(paid),
        "paid_tier_name": paid.group(1) if paid else None,
        "free_images_may_be_watermarked": watermark,
        "unlimited": False,
        "text_models": [
            {
                "name": m.get("name"),
                "description": m.get("description"),
                "reasoning": bool(m.get("reasoning")),
                "tools": bool(m.get("tools")),
                "vision": bool(m.get("vision")),
                "tier": m.get("tier"),
                "aliases": m.get("aliases") or [],
            }
            for m in text_models
            if isinstance(m, dict)
        ],
        "image_models": img_models if isinstance(img_models, list) else [],
    }


def puter() -> dict:
    status, body = get(PUTER_SDK)
    text = body.decode("utf-8", "replace")
    exposes = [n for n in ("chat", "txt2img", "img2txt") if n in text]
    print(
        f"  puter sdk          : HTTP {status} -> {len(body):,} bytes, exposes {exposes}",
        file=sys.stderr,
    )
    return {
        "ok": status == 200,
        "sdk": PUTER_SDK,
        "bytes": len(body),
        "exposes": exposes,
        "advertised": "500+ models, no API key for the site",
        # The visitor signs in and their own free allowance is metered by Puter.
        "requires_visitor_signin": True,
        "unlimited": False,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent.parent / "data" / "sandbox.json"),
    )
    args = ap.parse_args()

    print("Checking free model APIs and their real limits...", file=sys.stderr)
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "pollinations": pollinations(),
        "puter": puter(),
        # Recorded explicitly so the page can state it rather than imply otherwise.
        "any_unlimited_provider": False,
    }

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size:,} bytes)", file=sys.stderr)

    if not (payload["pollinations"]["ok"] and payload["puter"]["ok"]):
        print("WARNING: a provider failed its check", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
