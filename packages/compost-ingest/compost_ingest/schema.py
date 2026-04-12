"""JSON schemas for compost-ingest input/output validation."""

from typing import Any

INPUT_SCHEMA: dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": ["observe_id", "source_uri", "mime_type", "content", "transform_policy"],
    "additionalProperties": True,
    "properties": {
        "observe_id": {
            "type": "string",
            "minLength": 1,
            "description": "Unique identifier for this observation",
        },
        "source_uri": {
            "type": "string",
            "minLength": 1,
            "description": "URI of the source file",
        },
        "mime_type": {
            "type": "string",
            "minLength": 1,
            "description": "MIME type of the content",
        },
        "content": {
            "type": "string",
            "description": "Raw content to extract from",
        },
        "transform_policy": {
            "type": "string",
            "minLength": 1,
            "description": "Policy ID controlling extraction behavior (e.g. tp-2026-04)",
        },
    },
}

OUTPUT_SCHEMA: dict[str, Any] = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "required": [
        "observe_id",
        "extractor_version",
        "transform_policy",
        "chunks",
        "facts",
        "normalized_content",
        "content_hash_raw",
        "content_hash_normalized",
    ],
    "additionalProperties": True,
    "properties": {
        "observe_id": {
            "type": "string",
            "minLength": 1,
        },
        "extractor_version": {
            "type": "string",
            "minLength": 1,
        },
        "transform_policy": {
            "type": "string",
            "minLength": 1,
        },
        "chunks": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["chunk_id", "text", "metadata"],
                "properties": {
                    "chunk_id": {"type": "string"},
                    "text": {"type": "string"},
                    "metadata": {
                        "type": "object",
                        "additionalProperties": True,
                    },
                },
            },
        },
        "facts": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["subject", "predicate", "object"],
                "properties": {
                    "subject": {"type": "string"},
                    "predicate": {"type": "string"},
                    "object": {"type": "string"},
                },
                "additionalProperties": True,
            },
        },
        "normalized_content": {
            "type": "string",
        },
        "content_hash_raw": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$",
            "description": "SHA-256 hex digest of raw content",
        },
        "content_hash_normalized": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$",
            "description": "SHA-256 hex digest of normalized content",
        },
    },
}
