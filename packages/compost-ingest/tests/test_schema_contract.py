"""Contract tests for compost_ingest: input/output schema compliance."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import jsonschema
import pytest

from compost_ingest.cli import run_extraction
from compost_ingest.schema import INPUT_SCHEMA, OUTPUT_SCHEMA

FIXTURES = Path(__file__).parent / "fixtures"
TRANSFORM_POLICY: str = "tp-2026-04"


def _make_payload(fixture_name: str) -> dict:
    content = (FIXTURES / fixture_name).read_text(encoding="utf-8")
    return {
        "observe_id": f"test-{fixture_name}",
        "source_uri": f"file://fixtures/{fixture_name}",
        "mime_type": "text/markdown",
        "content": content,
        "transform_policy": TRANSFORM_POLICY,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def assert_valid_output(output: dict) -> None:
    jsonschema.validate(instance=output, schema=OUTPUT_SCHEMA)


def assert_valid_input(payload: dict) -> None:
    jsonschema.validate(instance=payload, schema=INPUT_SCHEMA)


# ---------------------------------------------------------------------------
# Fixture-driven schema contract tests
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("fixture_name", [
    "simple-note.md",
    "technical-doc.md",
    "short-note.md",
])
def test_fixture_produces_valid_output(fixture_name: str) -> None:
    payload = _make_payload(fixture_name)
    assert_valid_input(payload)
    output = run_extraction(payload)
    assert_valid_output(output)


@pytest.mark.parametrize("fixture_name", [
    "simple-note.md",
    "technical-doc.md",
    "short-note.md",
])
def test_output_contains_required_fields(fixture_name: str) -> None:
    payload = _make_payload(fixture_name)
    output = run_extraction(payload)

    assert output["observe_id"] == f"test-{fixture_name}"
    assert isinstance(output["chunks"], list)
    assert isinstance(output["facts"], list)
    assert isinstance(output["content_hash_raw"], str) and len(output["content_hash_raw"]) == 64
    assert isinstance(output["content_hash_normalized"], str) and len(output["content_hash_normalized"]) == 64
    assert isinstance(output["normalized_content"], str)
    assert isinstance(output["extractor_version"], str)


@pytest.mark.parametrize("fixture_name", [
    "simple-note.md",
    "technical-doc.md",
    "short-note.md",
])
def test_chunks_have_expected_structure(fixture_name: str) -> None:
    payload = _make_payload(fixture_name)
    output = run_extraction(payload)

    for chunk in output["chunks"]:
        assert "chunk_id" in chunk
        assert "text" in chunk
        assert "metadata" in chunk
        assert isinstance(chunk["text"], str)
        assert isinstance(chunk["metadata"], dict)
        assert "heading_path" in chunk["metadata"]
        assert isinstance(chunk["metadata"]["heading_path"], list)


# ---------------------------------------------------------------------------
# Content hash determinism
# ---------------------------------------------------------------------------

def test_hashes_are_deterministic() -> None:
    payload = _make_payload("simple-note.md")
    out1 = run_extraction(payload)
    out2 = run_extraction(payload)
    assert out1["content_hash_raw"] == out2["content_hash_raw"]
    assert out1["content_hash_normalized"] == out2["content_hash_normalized"]


def test_hashes_differ_for_different_content() -> None:
    out1 = run_extraction(_make_payload("simple-note.md"))
    out2 = run_extraction(_make_payload("technical-doc.md"))
    assert out1["content_hash_raw"] != out2["content_hash_raw"]


# ---------------------------------------------------------------------------
# Invalid input
# ---------------------------------------------------------------------------

def test_missing_required_fields_exit_1() -> None:
    """CLI must exit 1 when required fields are missing."""
    bad_payload = {"observe_id": "x"}  # missing source_uri, mime_type, content, transform_policy

    result = subprocess.run(
        [sys.executable, "-m", "compost_ingest", "extract"],
        input=json.dumps(bad_payload),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert "validation" in result.stderr.lower() or "error" in result.stderr.lower()


def test_invalid_json_exit_1() -> None:
    result = subprocess.run(
        [sys.executable, "-m", "compost_ingest", "extract"],
        input="not valid json{{",
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

def test_empty_content_valid_schema() -> None:
    payload = {
        "observe_id": "empty-test",
        "source_uri": "file://empty.md",
        "mime_type": "text/markdown",
        "content": "",
        "transform_policy": "tp-2026-04",
    }
    output = run_extraction(payload)
    assert_valid_output(output)
    assert output["chunks"] == []
    # facts may also be empty
    assert isinstance(output["facts"], list)
    # hashes still present
    assert len(output["content_hash_raw"]) == 64
    assert len(output["content_hash_normalized"]) == 64


def test_simple_note_has_facts() -> None:
    payload = _make_payload("simple-note.md")
    output = run_extraction(payload)
    # simple-note.md has 3 headings with body paragraphs -> expect >=1 fact
    assert len(output["facts"]) >= 1
    for fact in output["facts"]:
        assert fact["predicate"] == "discusses"
        assert fact["subject"]
        assert fact["object"]


def test_technical_doc_chunk_count() -> None:
    payload = _make_payload("technical-doc.md")
    output = run_extraction(payload)
    # technical-doc has multiple paragraphs; expect >1 chunk
    assert len(output["chunks"]) > 1


def test_short_note_single_chunk() -> None:
    payload = _make_payload("short-note.md")
    output = run_extraction(payload)
    # short-note is small; all text fits in one pass
    texts = [c["text"] for c in output["chunks"]]
    assert any("Quick Note" in t or "Remember" in t for t in texts)


def test_cli_success_exit_0() -> None:
    payload = _make_payload("simple-note.md")
    result = subprocess.run(
        [sys.executable, "-m", "compost_ingest", "extract"],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    out = json.loads(result.stdout)
    assert_valid_output(out)
