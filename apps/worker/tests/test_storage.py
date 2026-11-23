"""Storage, and how the parent moves files in and out of a job folder. The child never touches storage."""

from __future__ import annotations

import hashlib
import io
import os
import uuid
from pathlib import Path

import boto3
import pytest
from botocore.response import StreamingBody
from botocore.stub import Stubber

from stash_worker.contracts import limits
from stash_worker.files import InputRejected, PublishError, publish_outputs, stage_inputs
from stash_worker.storage import IMMUTABLE, LocalStorage, S3Storage, StorageError


def job_input(item: str, owner: str, files: list[dict]) -> dict:
    return {
        "jobId": str(uuid.uuid4()),
        "attempt": 1,
        "itemId": item,
        "ownerId": owner,
        "type": "loop",
        "title": "x",
        "files": files,
    }


def original(item: str, owner: str, size: int, role: str = "original") -> dict:
    return {
        "id": str(uuid.uuid4()),
        "role": role,
        "bucket": "originals",
        "path": f"{owner}/{item}/{role}.wav",
        "bytes": size,
        "mime": "audio/wav",
        "fileName": None,
    }


def derived(item: str, data: bytes, role: str = "preview", bucket: str = "previews", path: str | None = None) -> dict:
    digest = hashlib.sha256(data).hexdigest()
    return {
        "role": role,
        "bucket": bucket,
        "path": path or f"{item}/{digest[:32]}.mp3",
        "bytes": len(data),
        "mime": "audio/mpeg",
        "sha256": digest,
        "meta": {},
    }


def write_out(job: Path, f: dict, data: bytes) -> None:
    p = job / "work" / "out" / f["bucket"] / f["path"]
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


# -- LocalStorage ------------------------------------------------------------------------------


def test_local_storage_round_trip_and_size_cap(tmp_path: Path):
    s = LocalStorage(tmp_path / "store")
    src = tmp_path / "a.bin"
    src.write_bytes(b"x" * 100)
    s.upload("previews", "item/a.bin", src, "application/octet-stream", IMMUTABLE)
    assert s.download("previews", "item/a.bin", tmp_path / "b.bin", max_bytes=100) == 100
    assert (tmp_path / "b.bin").read_bytes() == b"x" * 100
    with pytest.raises(StorageError, match="larger"):
        s.download("previews", "item/a.bin", tmp_path / "c.bin", max_bytes=99)
    with pytest.raises(StorageError, match="missing"):
        s.download("previews", "item/none", tmp_path / "d.bin", max_bytes=99)
    with pytest.raises(StorageError):
        s.upload("previews", "../escape", src, "x", None)


# -- S3Storage, against botocore's Stubber --------------------------------------------------------


def s3_client():
    return boto3.client(
        "s3", region_name="auto", endpoint_url="http://storage.test", aws_access_key_id="k", aws_secret_access_key="s"
    )


def test_s3_download_streams_into_the_file_and_caps_its_size(tmp_path: Path):
    client = s3_client()
    s = S3Storage(client, {"originals": "orig-bucket", "previews": "prev-bucket"})
    body = b"RIFF" + b"\x00" * 96
    with Stubber(client) as stub:
        stub.add_response(
            "get_object",
            {"Body": StreamingBody(io.BytesIO(body), len(body)), "ContentLength": len(body)},
            {"Bucket": "orig-bucket", "Key": "o/i/original.wav"},
        )
        assert s.download("originals", "o/i/original.wav", tmp_path / "in", max_bytes=100) == 100
        stub.add_response(
            "get_object",
            {"Body": StreamingBody(io.BytesIO(body), len(body)), "ContentLength": len(body)},
            {"Bucket": "orig-bucket", "Key": "o/i/original.wav"},
        )
        with pytest.raises(StorageError, match="larger"):
            s.download("originals", "o/i/original.wav", tmp_path / "in2", max_bytes=99)
        stub.add_client_error("get_object", service_error_code="NoSuchKey", http_status_code=404)
        with pytest.raises(StorageError):
            s.download("originals", "o/i/missing.wav", tmp_path / "in3", max_bytes=99)
        stub.assert_no_pending_responses()
    assert (tmp_path / "in").read_bytes() == body


def test_s3_download_stops_reading_past_the_cap_even_if_the_length_lies(tmp_path: Path):
    client = s3_client()
    s = S3Storage(client, {"originals": "o", "previews": "p"})
    body = b"y" * 5000
    with Stubber(client) as stub:
        stub.add_response(
            "get_object", {"Body": StreamingBody(io.BytesIO(body), len(body)), "ContentLength": 10}, None
        )
        with pytest.raises(StorageError, match="larger"):
            s.download("originals", "k", tmp_path / "f", max_bytes=1000)


def test_s3_upload_sends_type_and_cache_headers(tmp_path: Path):
    client = s3_client()
    s = S3Storage(client, {"originals": "orig-bucket", "previews": "prev-bucket"})
    src = tmp_path / "p.mp3"
    src.write_bytes(b"ID3" + b"\x00" * 10)
    with Stubber(client) as stub:
        stub.add_response(
            "put_object",
            {},
            {
                "Bucket": "prev-bucket",
                "Key": "item/abc.mp3",
                "Body": stub_any(),
                "ContentType": "audio/mpeg",
                "CacheControl": IMMUTABLE,
                "ContentLength": 13,
            },
        )
        s.upload("previews", "item/abc.mp3", src, "audio/mpeg", IMMUTABLE)
        stub.assert_no_pending_responses()


def stub_any():
    from botocore.stub import ANY

    return ANY


def test_s3_storage_from_settings_uses_path_style():
    s = S3Storage.from_env(
        {
            "STASH_S3_ENDPOINT": "http://127.0.0.1:9000",
            "STASH_S3_REGION": "auto",
            "STASH_S3_ACCESS_KEY_ID": "a",
            "STASH_S3_SECRET_ACCESS_KEY": "b",
            "STASH_BUCKET_ORIGINALS": "originals",
            "STASH_BUCKET_PREVIEWS": "previews",
        }
    )
    assert s.client.meta.config.s3["addressing_style"] == "path"
    assert s.buckets == {"originals": "originals", "previews": "previews"}
    with pytest.raises(SystemExit, match="STASH_S3_ENDPOINT"):
        S3Storage.from_env({})


# -- staging inputs ----------------------------------------------------------------------------


def test_inputs_are_staged_by_file_id_within_their_limits(tmp_path: Path):
    store = LocalStorage(tmp_path / "store")
    item, owner = str(uuid.uuid4()), str(uuid.uuid4())
    f = original(item, owner, 10)
    src = tmp_path / "src"
    src.write_bytes(b"0123456789")
    store.upload("originals", f["path"], src, "audio/wav", None)
    in_dir = tmp_path / "work" / "in"
    stage_inputs(store, job_input(item, owner, [f]), in_dir)
    assert (in_dir / f["id"]).read_bytes() == b"0123456789"


def test_an_input_over_its_type_limit_is_too_large_without_downloading(tmp_path: Path):
    class NoDownload(LocalStorage):
        def download(self, *a, **kw):
            raise AssertionError("must not download")

    item, owner = str(uuid.uuid4()), str(uuid.uuid4())
    f = original(item, owner, limits()["loop"]["maxBytes"] + 1)
    with pytest.raises(InputRejected) as e:
        stage_inputs(NoDownload(tmp_path), job_input(item, owner, [f]), tmp_path / "in")
    assert e.value.reason == "too_large"


def test_a_stored_object_bigger_than_its_row_is_refused(tmp_path: Path):
    store = LocalStorage(tmp_path / "store")
    item, owner = str(uuid.uuid4()), str(uuid.uuid4())
    f = original(item, owner, 10)
    src = tmp_path / "src"
    src.write_bytes(b"x" * 11)
    store.upload("originals", f["path"], src, "audio/wav", None)
    with pytest.raises(StorageError):
        stage_inputs(store, job_input(item, owner, [f]), tmp_path / "in")


# -- publishing outputs ------------------------------------------------------------------------


def test_outputs_named_in_the_result_are_uploaded_immutable(tmp_path: Path):
    store = LocalStorage(tmp_path / "store")
    item = str(uuid.uuid4())
    data = b"ID3 preview bytes"
    f = derived(item, data)
    write_out(tmp_path / "job", f, data)
    publish_outputs(store, {"files": [f]}, tmp_path / "job" / "work" / "out", item)
    assert (tmp_path / "store" / "previews" / f["path"]).read_bytes() == data
    assert store.uploads == [("previews", f["path"], "audio/mpeg", IMMUTABLE)]


@pytest.mark.parametrize(
    "case", ["missing", "wrong_size", "wrong_hash", "no_hash", "other_item", "dotdot", "originals", "symlink_file", "symlink_dir"]
)
def test_outputs_that_do_not_match_the_result_are_refused(tmp_path: Path, case: str):
    store = LocalStorage(tmp_path / "store")
    item = str(uuid.uuid4())
    job = tmp_path / "job"
    out = job / "work" / "out"
    data = b"ID3 preview bytes"
    f = derived(item, data)
    secret = tmp_path / "secret.txt"
    secret.write_bytes(data)  # same bytes, so only the symlink check can catch it
    if case != "missing":
        write_out(job, f, data)
    if case == "wrong_size":
        f["bytes"] += 1
    elif case == "wrong_hash":
        f["sha256"] = "0" * 64
    elif case == "no_hash":
        f["sha256"] = None
    elif case == "other_item":
        f["path"] = f"{uuid.uuid4()}/x.mp3"
        write_out(job, f, data)
    elif case == "dotdot":
        f["path"] = f"{item}/../{item}/x.mp3"
    elif case == "originals":
        f["bucket"] = "originals"
        write_out(job, f, data)
    elif case == "symlink_file":
        p = out / "previews" / f["path"]
        p.unlink()
        p.symlink_to(secret)
    elif case == "symlink_dir":
        real = out / "previews" / item
        moved = tmp_path / "elsewhere"
        real.rename(moved)
        real.symlink_to(moved)
    with pytest.raises(PublishError):
        publish_outputs(store, {"files": [f]}, out, item)
    assert store.uploads == []


def test_publishing_is_all_or_nothing_checked_before_any_upload(tmp_path: Path):
    store = LocalStorage(tmp_path / "store")
    item = str(uuid.uuid4())
    job = tmp_path / "job"
    good, bad = derived(item, b"good"), derived(item, b"bad", role="peaks", path=f"{item}/bad.peaks")
    write_out(job, good, b"good")
    write_out(job, bad, b"bad!")
    with pytest.raises(PublishError):
        publish_outputs(store, {"files": [good, bad]}, job / "work" / "out", item)
    assert store.uploads == []
    assert not os.path.exists(tmp_path / "store" / "previews" / good["path"])
