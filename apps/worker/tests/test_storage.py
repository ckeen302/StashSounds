"""Storage, and how the parent moves files in and out of a job folder. The child never touches storage."""

from __future__ import annotations

import base64
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
from stash_worker.files import (
    InputRejected,
    PublishError,
    loop_preview_max_bytes,
    loop_preview_needed_bytes,
    publish_outputs,
    stage_inputs,
)
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
        "s3",
        region_name="auto",
        endpoint_url="http://storage.test",
        aws_access_key_id="k",
        aws_secret_access_key="s",  # noqa: S106
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
        stub.add_response("get_object", {"Body": StreamingBody(io.BytesIO(body), len(body)), "ContentLength": 10}, None)
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

PREVIEW = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" * 64
PEAKS = bytes(range(200)) * 4  # 800 bytes


def peaks_file(item: str, data: bytes = PEAKS) -> dict:
    digest = hashlib.sha256(data).hexdigest()
    return {
        "role": "peaks",
        "bucket": "previews",
        "path": f"{item}/{digest[:32]}.peaks",
        "bytes": len(data),
        "mime": "application/octet-stream",
        "sha256": digest,
        "meta": {"points": 800, "peaks": base64.b64encode(data).decode()},
    }


def publish(tmp_path: Path, files: list[tuple[dict, bytes]], item: str, item_type: str = "loop", owner=None):
    store = LocalStorage(tmp_path / "store")
    out = tmp_path / "job" / "work" / "out"
    for f, data in files:
        write_out(tmp_path / "job", f, data)
    publish_outputs(store, {"files": [f for f, _ in files]}, out, item, item_type, owner)
    return store


def test_a_loops_preview_and_peaks_are_uploaded_immutable_with_the_parents_types(tmp_path: Path):
    item = str(uuid.uuid4())
    preview, peaks = derived(item, PREVIEW), peaks_file(item)
    store = publish(tmp_path, [(preview, PREVIEW), (peaks, PEAKS)], item, owner=os.getuid())
    assert (tmp_path / "store" / "previews" / preview["path"]).read_bytes() == PREVIEW
    assert store.uploads == [
        ("previews", preview["path"], "audio/mpeg", IMMUTABLE),
        ("previews", peaks["path"], "application/octet-stream", IMMUTABLE),
    ]


def test_the_preview_cap_comes_from_limits_and_fits_the_longest_loop():
    lim = limits()
    assert loop_preview_max_bytes() == lim["preview"]["loopMaxBytes"]
    # The limit must hold the longest loop's preview (60 s at 128 kbps, with margin), or a valid
    # preview would be refused.
    longest = lim["loop"]["maxDurationMs"] / 1000 * lim["preview"]["loopBitrateKbpsLong"] * 1000 / 8
    assert longest < loop_preview_needed_bytes() <= loop_preview_max_bytes()


@pytest.mark.parametrize(
    "case",
    [
        "missing",
        "wrong_size",
        "wrong_hash",
        "no_hash",
        "short_hash",
        "other_item",
        "dotdot",
        "originals",
        "symlink_file",
        "symlink_dir",
        "hard_link",
        "other_owner",
        "html_mime",
        "svg_name",
        "extra_folder",
        "html_bytes",
        "too_big",
        "unknown_role",
        "two_previews",
        "other_type",
        "peaks_short",
        "peaks_meta_differs",
        "peaks_meta_not_base64",
        "peaks_as_mp3",
    ],
)
def test_outputs_the_parent_does_not_expect_are_refused(tmp_path: Path, case: str):
    store = LocalStorage(tmp_path / "store")
    item = str(uuid.uuid4())
    job = tmp_path / "job"
    out = job / "work" / "out"
    data = PREVIEW
    f = derived(item, data)
    files, item_type, owner = [f], "loop", os.getuid()
    secret = tmp_path / "secret.txt"
    secret.write_bytes(data)  # same bytes, so only the link checks can catch it
    if case != "missing":
        write_out(job, f, data)
    p = out / "previews" / f["path"]
    if case == "wrong_size":
        f["bytes"] += 1
    elif case == "wrong_hash":
        f["sha256"] = "0" * 64
    elif case == "no_hash":
        f["sha256"] = None
    elif case == "short_hash":
        f["sha256"] = f["sha256"][:32]
    elif case == "other_item":
        f["path"] = f"{uuid.uuid4()}/{f['sha256'][:32]}.mp3"
        write_out(job, f, data)
    elif case == "dotdot":
        f["path"] = f"{item}/../{item}/{f['sha256'][:32]}.mp3"
    elif case == "originals":
        f["bucket"] = "originals"
        write_out(job, f, data)
    elif case == "symlink_file":
        p.unlink()
        p.symlink_to(secret)
    elif case == "symlink_dir":
        real = out / "previews" / item
        moved = tmp_path / "elsewhere"
        real.rename(moved)
        real.symlink_to(moved)
    elif case == "hard_link":
        p.unlink()
        os.link(secret, p)
    elif case == "other_owner":
        owner = os.getuid() + 1
    elif case == "html_mime":
        f["mime"] = "text/html"
    elif case == "svg_name":
        f["path"] = f"{item}/{f['sha256'][:32]}.svg"
        write_out(job, f, data)
    elif case == "extra_folder":
        f["path"] = f"{item}/x/{f['sha256'][:32]}.mp3"
        write_out(job, f, data)
    elif case == "html_bytes":
        html = b"<html><script>alert(1)</script></html>"
        f = derived(item, html)
        write_out(job, f, html)
        files = [f]
    elif case == "too_big":
        big = b"ID3" + b"\x00" * (loop_preview_max_bytes() - 2)
        f = derived(item, big)
        write_out(job, f, big)
        files = [f]
    elif case == "unknown_role":
        f["role"] = "cover"
    elif case == "two_previews":
        other = PREVIEW + b"\x00"
        g = derived(item, other)
        write_out(job, g, other)
        files = [f, g]
    elif case == "other_type":
        item_type = "oneshot"  # no processor yet, so nothing to publish
    elif case.startswith("peaks"):
        pk = peaks_file(item, PEAKS[:799] if case == "peaks_short" else PEAKS)
        if case == "peaks_meta_differs":
            pk["meta"]["peaks"] = base64.b64encode(bytes(800)).decode()
        elif case == "peaks_meta_not_base64":
            pk["meta"]["peaks"] = "not base64!"
        elif case == "peaks_as_mp3":
            pk["path"] = pk["path"].replace(".peaks", ".mp3")
        write_out(job, pk, PEAKS[:799] if case == "peaks_short" else PEAKS)
        files = [f, pk]
    with pytest.raises(PublishError):
        publish_outputs(store, {"files": files}, out, item, item_type, owner)
    assert store.uploads == []


def test_publishing_is_all_or_nothing_checked_before_any_upload(tmp_path: Path):
    store = LocalStorage(tmp_path / "store")
    item = str(uuid.uuid4())
    job = tmp_path / "job"
    good, bad = derived(item, PREVIEW), peaks_file(item)
    write_out(job, good, PREVIEW)
    write_out(job, bad, PEAKS[::-1])  # not what the result says
    with pytest.raises(PublishError):
        publish_outputs(store, {"files": [good, bad]}, job / "work" / "out", item, "loop")
    assert store.uploads == []
    assert not os.path.exists(tmp_path / "store" / "previews" / good["path"])


def test_an_input_rejection_must_be_a_file_fault_reason():
    assert InputRejected("too_large", "x").reason == "too_large"
    for reason in ("internal", "timeout", "duplicate_exact", "made_up"):
        with pytest.raises(ValueError):
            InputRejected(reason, "x")
