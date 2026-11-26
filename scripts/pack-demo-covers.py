"""Packs the demo's album covers into sprite sheets for the demo page.

The demo is published as an Artifact, which holds a limited number of files, and there is a cover
per song. Identical covers (songs on one album) collapse to one tile, and tiles go 12 by 12 on a
sheet, in the order the tabs show the songs (scripts/demo-cover-gaps.mjs --order), so a screen of
cards needs few sheets. Writes:
  presets/cover-sheets/*.jpg   the sheets
  presets/cover-sheets.json    {grid, sheets, tiles: {file: [sheet, col, row]}} for presets/covers.json,
                               which loads with the page
  samples/covers.json          its rows get their tile ("t"), so the Samples tab's covers stay off
                               the first load
Only covers some row names are packed. Run after covers change; the outputs are committed.
"""
import hashlib, json, os, subprocess, sys, tempfile
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.join(here, "..", "apps/web/src/demo/presets")
lazy_path = os.path.join(here, "..", "apps/web/src/demo/samples/covers.json")
src, out = os.path.join(root, "covers"), os.path.join(root, "cover-sheets")
TILE, GRID = 240, 12

covers = json.load(open(os.path.join(root, "covers.json")))
lazy = json.load(open(lazy_path)) if os.path.exists(lazy_path) else {}
named = {r["file"] for r in covers.values()} | {f"covers/{r['f']}" for r in lazy.values()}
missing = sorted(f for f in named if not os.path.exists(os.path.join(src, f[len("covers/") :])))
if missing:
    sys.exit(f"cover rows name files that are not in presets/covers/: {missing[:5]}")


def write_lazy():
    open(lazy_path, "w").write("{\n" + ",\n".join(f"{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}" for k, v in lazy.items()) + "\n}\n")


# The order the tabs show them, then whatever else is named. The page leaves out rows that are on no
# sheet, so every named file gets a provisional tile while the order is read.
sheets_path = os.path.join(root, "cover-sheets.json")
old_sheets = open(sheets_path).read()
json.dump({"grid": GRID, "sheets": ["covers/provisional.jpg"], "tiles": {f: [0, 0, 0] for f in named}}, open(sheets_path, "w"))
for r in lazy.values():
    r["t"] = [0, 0, 0]
write_lazy()
try:
    with tempfile.TemporaryDirectory() as tmp:
        order_file = os.path.join(tmp, "order.json")
        subprocess.run(["node", os.path.join(here, "demo-cover-gaps.mjs"), "--order", order_file], check=True, stdout=subprocess.DEVNULL)
        shown = [f for f in json.load(open(order_file)) if f in named]
except Exception:
    open(sheets_path, "w").write(old_sheets)
    raise
files = list(dict.fromkeys(shown + sorted(named)))

digest = {f: hashlib.sha256(open(os.path.join(src, f[len("covers/") :]), "rb").read()).hexdigest() for f in files}
by_hash, order = {}, []
for f in files:
    if digest[f] not in by_hash:
        by_hash[digest[f]] = len(order)
        order.append(f)
os.makedirs(out, exist_ok=True)
for old in os.listdir(out):
    os.remove(os.path.join(out, old))
per = GRID * GRID
sheets = []
for s in range(0, len(order), per):
    sheet = Image.new("RGB", (TILE * GRID, TILE * GRID), (20, 20, 22))
    for i, f in enumerate(order[s : s + per]):
        im = Image.open(os.path.join(src, f[len("covers/") :])).convert("RGB")
        side = min(im.size)  # centre-crop the odd non-square cover
        im = im.crop(((im.width - side) // 2, (im.height - side) // 2, (im.width + side) // 2, (im.height + side) // 2)).resize((TILE, TILE), Image.LANCZOS)
        sheet.paste(im, ((i % GRID) * TILE, (i // GRID) * TILE))
    tmp = os.path.join(out, "tmp.jpg")
    sheet.save(tmp, quality=82, optimize=True, progressive=True)
    # The name carries the content hash, so a changed sheet is never served from an old cache.
    name = f"sheet-{s // per}-{hashlib.sha256(open(tmp, 'rb').read()).hexdigest()[:8]}.jpg"
    os.replace(tmp, os.path.join(out, name))
    sheets.append(f"covers/{name}")


def tile(f):
    i = by_hash[digest[f]]
    return [i // per, i % GRID, (i % per) // GRID]


index = {r["file"]: tile(r["file"]) for r in covers.values()}
json.dump({"grid": GRID, "sheets": sheets, "tiles": dict(sorted(index.items()))}, open(sheets_path, "w"), indent=0)
for r in lazy.values():
    r["t"] = tile(f"covers/{r['f']}")
write_lazy()
unused = sorted(set(os.listdir(src)) - {f[len("covers/") :] for f in named})
total = sum(os.path.getsize(os.path.join(out, s[len("covers/") :])) for s in sheets)
print(f"{len(files)} covers, {len(order)} unique, {len(sheets)} sheets, {total / 1048576:.1f} MB; {len(unused)} files in covers/ that no row names", file=sys.stderr)
