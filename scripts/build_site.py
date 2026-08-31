#!/usr/bin/env python3
"""Build site/index.html by embedding data/models.json into index.template.html."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "index.template.html"
DATA = ROOT / "data" / "models.json"
OUT = ROOT / "index.html"


def main() -> int:
    if not DATA.exists():
        print("data/models.json missing — run scripts/fetch_models.py first", file=sys.stderr)
        return 1

    payload = json.loads(DATA.read_text(encoding="utf-8"))
    # </script> inside embedded JSON would terminate the script block early.
    embedded = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

    template = TEMPLATE.read_text(encoding="utf-8")
    if "__MODELS_JSON__" not in template:
        print("template has no __MODELS_JSON__ placeholder", file=sys.stderr)
        return 1

    OUT.write_text(template.replace("__MODELS_JSON__", embedded), encoding="utf-8")
    print(f"Built {OUT} ({OUT.stat().st_size:,} bytes) with {len(payload['models'])} models", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
