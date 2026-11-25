"""Packs the preset album covers into sprite sheets for the demo page.

The demo is published as an Artifact, which holds a limited number of files, and there is a cover
per song. Identical covers (songs on one album) collapse to one tile, and tiles go 8 by 8 on a
sheet. Writes presets/cover-sheets/*.jpg and presets/cover-sheets.json ({grid, sheets, tiles: {file: [sheet, col, row]}}),
which the Cover component reads. Run after covers change; the outputs are committed.
"""
import hashlib, json, os, sys
from PIL import Image

root = os.path.join(os.path.dirname(__file__), "..", "apps/web/src/demo/presets")
src, out = os.path.join(root, "covers"), os.path.join(root, "cover-sheets")
TILE, GRID = 240, 8
files = sorted(f for f in os.listdir(src) if f.endswith(".jpg"))
by_hash, order = {}, []
for f in files:
    h = hashlib.sha256(open(os.path.join(src, f), "rb").read()).hexdigest()
    if h not in by_hash:
        by_hash[h] = len(order)
        order.append(f)
os.makedirs(out, exist_ok=True)
for old in os.listdir(out):
    os.remove(os.path.join(out, old))
per = GRID * GRID
sheets = []
for s in range(0, len(order), per):
    sheet = Image.new("RGB", (TILE * GRID, TILE * GRID), (20, 20, 22))
    for i, f in enumerate(order[s : s + per]):
        im = Image.open(os.path.join(src, f)).convert("RGB")
        side = min(im.size)  # centre-crop the odd non-square cover
        im = im.crop(((im.width - side) // 2, (im.height - side) // 2, (im.width + side) // 2, (im.height + side) // 2)).resize((TILE, TILE), Image.LANCZOS)
        sheet.paste(im, ((i % GRID) * TILE, (i // GRID) * TILE))
    tmp = os.path.join(out, "tmp.jpg")
    sheet.save(tmp, quality=82, optimize=True, progressive=True)
    # The name carries the content hash, so a changed sheet is never served from an old cache.
    name = f"sheet-{s // per}-{hashlib.sha256(open(tmp, 'rb').read()).hexdigest()[:8]}.jpg"
    os.replace(tmp, os.path.join(out, name))
    sheets.append(f"covers/{name}")
index = {}
for f in files:
    h = hashlib.sha256(open(os.path.join(src, f), "rb").read()).hexdigest()
    i = by_hash[h]
    index[f"covers/{f}"] = [i // per, i % GRID, (i % per) // GRID]
json.dump({"grid": GRID, "sheets": sheets, "tiles": index}, open(os.path.join(root, "cover-sheets.json"), "w"), indent=0, sort_keys=True)
print(f"{len(files)} covers, {len(order)} unique, {-(-len(order) // per)} sheets", file=sys.stderr)
