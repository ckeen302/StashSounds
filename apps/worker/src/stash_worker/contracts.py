"""
The worker's view of packages/contracts. Limits come from limits.json and output shapes from the
JSON Schemas generated from the Zod contracts, so the worker and the web app cannot drift apart.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

REPO_ROOT = Path(__file__).resolve().parents[4]
CONTRACTS = REPO_ROOT / "packages" / "contracts"


@cache
def limits() -> dict[str, Any]:
    data = json.loads((CONTRACTS / "limits.json").read_text())
    data.pop("$comment", None)
    return data


@cache
def _validator(name: str) -> Draft202012Validator:
    schema = json.loads((CONTRACTS / "generated" / f"{name}.schema.json").read_text())
    return Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER)


def validate(name: str, value: Any) -> None:
    """Raises jsonschema.ValidationError if value does not match the named contract.

    Names: details.loop, details.oneshot, details.kit, details.midi, details.preset,
    midi-notes-file, job-payload, worker-result.
    """
    _validator(name).validate(value)


def is_valid(name: str, value: Any) -> bool:
    return _validator(name).is_valid(value)


@cache
def worker_reasons() -> frozenset[str]:
    """The reasons the worker may give (contracts: workerReasonSchema), read from the generated
    worker-result schema so the list is never retyped here."""
    schema = json.loads((CONTRACTS / "generated" / "worker-result.schema.json").read_text())
    flag = schema["oneOf"][0]["properties"]["flag"]["anyOf"][0]
    return frozenset(flag["properties"]["reason"]["enum"])
