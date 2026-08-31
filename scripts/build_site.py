#!/usr/bin/env python3
"""Build site/index.html by embedding the JSON data files into index.template.html."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "index.template.html"
OUT = ROOT / "index.html"

SOURCES = {
    "__SANDBOX_JSON__": ROOT / "data" / "sandbox.json",
}


def main() -> int:
    template = TEMPLATE.read_text(encoding="utf-8")
    notes = []

    for placeholder, path in SOURCES.items():
        if placeholder not in template:
            print(f"template has no {placeholder} placeholder", file=sys.stderr)
            return 1
        if not path.exists():
            print(f"{path.name} missing — run scripts/fetch_sandbox.py first", file=sys.stderr)
            return 1
        data = json.loads(path.read_text(encoding="utf-8"))
        # `</script>` inside embedded JSON would terminate the script block early.
        template = template.replace(
            placeholder, json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
        )
        notes.append(f"{path.name}={path.stat().st_size:,}B")

    OUT.write_text(template, encoding="utf-8")
    print(f"Built {OUT} ({OUT.stat().st_size:,} bytes) from {' + '.join(notes)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
