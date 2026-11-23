"""Object storage for the parent process: the private originals bucket and the public previews bucket.

`S3Storage` speaks the S3 API (SeaweedFS locally, Cloudflare R2 in production) with path-style
addressing. `LocalStorage` keeps objects in a folder, for tests. The child process never sees either:
it has no credentials and works only on the files the parent puts in its job folder.
"""

from __future__ import annotations

import shutil
from collections.abc import Mapping
from pathlib import Path, PurePosixPath
from typing import Any, Protocol

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

# Derived files have content-hashed names, so they never change and can be cached for good.
IMMUTABLE = "public, max-age=31536000, immutable"
BUCKETS = ("originals", "previews")
CHUNK = 1 << 20


class StorageError(Exception):
    """Storage was unreachable, an object was missing, or it was not the size expected. Retryable."""


class Storage(Protocol):
    def download(self, bucket: str, key: str, dest: Path, max_bytes: int) -> int: ...
    def upload(self, bucket: str, key: str, src: Path, content_type: str, cache_control: str | None) -> None: ...


def _check_key(bucket: str, key: str) -> None:
    parts = PurePosixPath(key).parts
    if bucket not in BUCKETS or not key or key.startswith("/") or any(p in ("", ".", "..") for p in parts):
        raise StorageError(f"refusing object {bucket}/{key!r}")


def _copy_capped(read, dest: Path, max_bytes: int) -> int:
    """Copies from read(n) into dest, failing once more than max_bytes arrive."""
    total = 0
    with dest.open("wb") as out:
        while chunk := read(min(CHUNK, max_bytes + 1 - total)):
            total += len(chunk)
            if total > max_bytes:
                break
            out.write(chunk)
    if total > max_bytes:
        dest.unlink(missing_ok=True)
        raise StorageError(f"object is larger than {max_bytes} bytes")
    return total


class LocalStorage:
    """Objects as files under root/<bucket>/<key>. Records uploads for tests."""

    def __init__(self, root: Path):
        self.root = root
        self.uploads: list[tuple[str, str, str, str | None]] = []

    def download(self, bucket: str, key: str, dest: Path, max_bytes: int) -> int:
        _check_key(bucket, key)
        src = self.root / bucket / key
        try:
            with src.open("rb") as f:
                return _copy_capped(f.read, dest, max_bytes)
        except FileNotFoundError as e:
            raise StorageError(f"object {bucket}/{key} is missing") from e

    def upload(self, bucket: str, key: str, src: Path, content_type: str, cache_control: str | None) -> None:
        _check_key(bucket, key)
        dest = self.root / bucket / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
        self.uploads.append((bucket, key, content_type, cache_control))


class S3Storage:
    def __init__(self, client: Any, buckets: Mapping[str, str]):
        self.client = client
        self.buckets = dict(buckets)

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> S3Storage:
        names = ("STASH_S3_ENDPOINT", "STASH_S3_ACCESS_KEY_ID", "STASH_S3_SECRET_ACCESS_KEY")
        missing = [n for n in names if not env.get(n)]
        if missing:
            raise SystemExit(f"stash-worker: {', '.join(missing)} not set (see .env.example).")
        config = Config(
            s3={"addressing_style": "path"},
            connect_timeout=5,
            read_timeout=60,
            retries={"max_attempts": 3, "mode": "standard"},
            # Checksums only where the API requires them: R2 and SeaweedFS do not all accept the newer defaults.
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        )
        client = boto3.client(
            "s3",
            endpoint_url=env["STASH_S3_ENDPOINT"],
            region_name=env.get("STASH_S3_REGION") or "auto",
            aws_access_key_id=env["STASH_S3_ACCESS_KEY_ID"],
            aws_secret_access_key=env["STASH_S3_SECRET_ACCESS_KEY"],
            config=config,
        )
        return cls(
            client,
            {
                "originals": env.get("STASH_BUCKET_ORIGINALS") or "originals",
                "previews": env.get("STASH_BUCKET_PREVIEWS") or "previews",
            },
        )

    def download(self, bucket: str, key: str, dest: Path, max_bytes: int) -> int:
        _check_key(bucket, key)
        try:
            obj = self.client.get_object(Bucket=self.buckets[bucket], Key=key)
            if int(obj.get("ContentLength") or 0) > max_bytes:
                obj["Body"].close()
                raise StorageError(f"object is larger than {max_bytes} bytes")
            try:
                return _copy_capped(obj["Body"].read, dest, max_bytes)
            finally:
                obj["Body"].close()
        except (ClientError, BotoCoreError, OSError) as e:
            raise StorageError(f"download of {bucket}/{key} failed: {e}") from e

    def upload(self, bucket: str, key: str, src: Path, content_type: str, cache_control: str | None) -> None:
        _check_key(bucket, key)
        extra = {"CacheControl": cache_control} if cache_control else {}
        try:
            with src.open("rb") as body:
                self.client.put_object(
                    Bucket=self.buckets[bucket],
                    Key=key,
                    Body=body,
                    ContentType=content_type,
                    ContentLength=src.stat().st_size,
                    **extra,
                )
        except (ClientError, BotoCoreError, OSError) as e:
            raise StorageError(f"upload of {bucket}/{key} failed: {e}") from e
