"""CLI entry point for compost-ingest.

Usage:
    python -m compost_ingest extract

Reads JSON from stdin, writes JSON to stdout.
Exit 0 on success, 1 on error (error message on stderr).
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from typing import Any

import jsonschema

from compost_ingest import __version__
from compost_ingest.extractors.markdown import extract_chunks, extract_facts
from compost_ingest.schema import INPUT_SCHEMA, OUTPUT_SCHEMA


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

def normalize_content(raw: str) -> str:
    """Strip boilerplate, collapse whitespace, strip HTML."""
    # Strip basic HTML tags
    text = re.sub(r"<[^>]+>", "", raw)
    # Strip leading/trailing whitespace per line
    lines = [line.strip() for line in text.splitlines()]
    # Collapse runs of 3+ blank lines to 2 (one blank line)
    collapsed: list[str] = []
    blank_run = 0
    for line in lines:
        if line == "":
            blank_run += 1
            if blank_run <= 1:
                collapsed.append(line)
        else:
            blank_run = 0
            collapsed.append(line)
    return "\n".join(collapsed).strip()


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------

def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Core extraction
# ---------------------------------------------------------------------------

def run_extraction(payload: dict[str, Any]) -> dict[str, Any]:
    content: str = payload["content"]
    normalized = normalize_content(content)

    chunks = extract_chunks(content)
    facts = extract_facts(content)

    return {
        "observe_id": payload["observe_id"],
        "extractor_version": __version__,
        "transform_policy": payload["transform_policy"],
        "chunks": [
            {"chunk_id": c.chunk_id, "text": c.text, "metadata": c.metadata}
            for c in chunks
        ],
        "facts": [
            {"subject": f.subject, "predicate": f.predicate, "object": f.object}
            for f in facts
        ],
        "normalized_content": normalized,
        "content_hash_raw": sha256_hex(content),
        "content_hash_normalized": sha256_hex(normalized),
    }


# ---------------------------------------------------------------------------
# CLI dispatch
# ---------------------------------------------------------------------------

def main() -> None:
    args = sys.argv[1:]
    if not args or args[0] != "extract":
        print("Usage: python -m compost_ingest extract", file=sys.stderr)
        sys.exit(1)

    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"Invalid JSON on stdin: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        jsonschema.validate(instance=payload, schema=INPUT_SCHEMA)
    except jsonschema.ValidationError as exc:
        print(f"Input validation error: {exc.message}", file=sys.stderr)
        sys.exit(1)

    try:
        output = run_extraction(payload)
    except Exception as exc:  # noqa: BLE001
        print(f"Extraction error: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        jsonschema.validate(instance=output, schema=OUTPUT_SCHEMA)
    except jsonschema.ValidationError as exc:
        print(f"Output validation error (bug): {exc.message}", file=sys.stderr)
        sys.exit(1)

    json.dump(output, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.exit(0)
