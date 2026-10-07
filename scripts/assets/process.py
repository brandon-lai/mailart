"""
Steps 3-5 of the asset pipeline: cut out, tag, normalize.

    .venv/bin/python scripts/assets/process.py          # everything accepted in review.json
    .venv/bin/python scripts/assets/process.py --only met_283172

Reads assets/raw/<category>/<id>.jpg + .source.json for every id accepted in
scripts/assets/review.json, and writes:

  assets/library/masters/<kind>s/<asset id>.png|jpg   normalized, cap 1600 px (gitignored)
  apps/web/public/lib/<kind>s/<asset id>.webp         what pages and the renderer load
  assets/library/processed.json                        input to manifest.ts

Background removal uses rembg's default general-purpose model (u2net, Apache
2.0). No model with a non-commercial licence is used.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "assets/raw"
MASTERS = ROOT / "assets/library/masters"
WEB = ROOT / "apps/web/public/lib"
OUT = ROOT / "assets/library/processed.json"
# sourceId#pieceIndex -> asset id. Committed, so ids never move between runs
# (review.json refers to assets by id).
IDS = ROOT / "assets/library/ids.json"

CUT_KINDS = {"figure", "animal", "botanical", "insect"}
PREFIX = {"figure": "fig", "bust": "bust", "animal": "ani", "botanical": "bot", "insect": "ins", "vignette": "vig", "ephemera": "eph"}
MASTER_CAP = 1600
WEB_CAP = 900


def tone_of(rgb: np.ndarray, alpha: np.ndarray | None) -> str:
    """bw / sepia / color from saturation and hue of the visible pixels."""
    img = Image.fromarray(rgb).convert("HSV")
    hsv = np.asarray(img).astype(np.float32) / 255.0
    mask = alpha > 0.5 if alpha is not None else np.ones(hsv.shape[:2], bool)
    # Ignore paper-white and near-black: they say nothing about the tone.
    v = hsv[..., 2]
    mask &= (v > 0.12) & (v < 0.92)
    if mask.sum() < 50:
        return "bw"
    s = hsv[..., 1][mask]
    h = hsv[..., 0][mask]
    sat = float(np.percentile(s, 75))
    if sat < 0.1:
        return "bw"
    warm = float(((h > 0.02) & (h < 0.16)).mean())
    hue_spread = float(np.std(h))
    if sat < 0.42 and warm > 0.75 and hue_spread < 0.12:
        return "sepia"
    return "color"


def head_box(alpha: np.ndarray, frac: float, max_aspect: float) -> dict | None:
    """Top of the alpha mask down `frac` of the figure height, centred on the mask in that band."""
    m = alpha > 0.5
    rows = np.where(m.any(axis=1))[0]
    if len(rows) == 0:
        return None
    top, bottom = int(rows[0]), int(rows[-1])
    fh = bottom - top + 1
    bh = max(8, int(round(fh * frac)))
    band = m[top : top + bh]
    ys, xs = np.nonzero(band)
    if len(xs) == 0:
        return None
    # Groups (fashion plates with two or three people): keep only the column run
    # that holds the topmost pixel, i.e. the tallest person's head.
    cols = band.any(axis=0)
    first_x = int(np.nonzero(m[top])[0].mean())
    gap = 4  # columns of empty space that separate two people
    lo_x = first_x
    while lo_x > 0 and cols[max(0, lo_x - gap):lo_x].any():
        lo_x -= 1
    hi_x = first_x
    while hi_x < len(cols) - 1 and cols[hi_x + 1:hi_x + 1 + gap].any():
        hi_x += 1
    keep = (xs >= lo_x) & (xs <= hi_x)
    xs = xs[keep]
    cx = float(xs.mean())
    lo, hi = np.percentile(xs, [4, 96])
    w = min(float(hi - lo), bh * max_aspect)
    w = max(w, bh * 0.45)
    x = max(0.0, cx - w / 2)
    return {"x": round(x), "y": top, "w": round(w), "h": bh}


def trim(img: Image.Image) -> Image.Image:
    bbox = img.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    return img.crop(bbox) if bbox else img


def cap(img: Image.Image, n: int) -> Image.Image:
    if max(img.size) <= n:
        return img
    img = img.copy()
    img.thumbnail((n, n), Image.LANCZOS)
    return img


def save(img: Image.Image, kind: str, aid: str, cut: bool) -> tuple[str, int, int]:
    master = cap(img, MASTER_CAP)
    d = MASTERS / f"{kind}s"
    d.mkdir(parents=True, exist_ok=True)
    if cut:
        master.save(d / f"{aid}.png", optimize=True)
    else:
        master.convert("RGB").save(d / f"{aid}.jpg", quality=88)
    web = cap(master, WEB_CAP)
    wd = WEB / f"{kind}s"
    wd.mkdir(parents=True, exist_ok=True)
    web.save(wd / f"{aid}.webp", quality=80, method=6)
    return f"{kind}s/{aid}.webp", web.size[0], web.size[1]


def recompute_heads():
    """Re-derive figure head boxes from the saved cut-outs, without re-running rembg."""
    data = json.loads(OUT.read_text())
    for e in data:
        if e["kind"] != "figure":
            continue
        a = np.asarray(Image.open(WEB / e["file"]).getchannel("A")).astype(np.float32) / 255.0
        hb = head_box(a, 1 / 7, 1.15)
        if hb:
            e["headBox"] = hb
    OUT.write_text(json.dumps(data, indent=1))
    print("head boxes recomputed")


def main():
    if "--heads" in sys.argv:
        return recompute_heads()
    from rembg import new_session, remove

    review = json.loads((ROOT / "scripts/assets/review.json").read_text())
    accept: dict = review["accept"]
    rejected_masks = set(review.get("maskReject", []))
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    session = new_session("u2net")

    prev = {}
    if OUT.exists():
        for e in json.loads(OUT.read_text()):
            prev.setdefault(e["sourceId"], []).append(e)

    ids: dict[str, str] = json.loads(IDS.read_text()) if IDS.exists() else {}
    counters: dict[str, int] = {}
    for v in ids.values():
        pre, num = v.split("_")
        counters[pre] = max(counters.get(pre, 0), int(num))

    def alloc(src: str, piece: int, kind: str) -> str:
        key = f"{src}#{piece}"
        if key not in ids:
            pre = PREFIX[kind]
            counters[pre] = counters.get(pre, 0) + 1
            ids[key] = f"{pre}_{counters[pre]:04d}"
        return ids[key]

    out = []
    for src_id in sorted(accept):
        kind, pose, *flags = accept[src_id] + [None] * (3 - len(accept[src_id]))
        flags = [f for f in flags if f]
        if src_id in rejected_masks:
            continue
        # Stable ids: allocate in sorted source order.
        found = None
        for cat in ["figure", "bust", "animal", "botanical", "vignette", "ephemera"]:
            if (RAW / cat / f"{src_id}.jpg").exists():
                found = cat
                break
        if not found:
            print("missing", src_id)
            continue
        source = json.loads((RAW / found / f"{src_id}.source.json").read_text())
        if only and src_id != only:
            out.extend(prev.get(src_id, []))
            continue
        if not only and src_id in prev and all((WEB / e["file"]).exists() for e in prev[src_id]):
            # Already processed; keep ids stable.
            out.extend(prev[src_id])
            continue

        img = Image.open(RAW / found / f"{src_id}.jpg").convert("RGB")
        work = cap(img, 1024)
        entries = []
        if kind in CUT_KINDS:
            cut = remove(work, session=session)  # RGBA at working size
            # Re-apply the mask to the full-resolution image.
            mask = cut.getchannel("A").resize(img.size, Image.LANCZOS)
            full = img.copy()
            full.putalpha(mask)
            pieces = [full]
            if "split" in flags:
                a = np.asarray(mask) > 100
                a = ndimage.binary_dilation(a, iterations=6)
                lab, n = ndimage.label(a)
                pieces = []
                total = a.size
                for i, sl in enumerate(ndimage.find_objects(lab), start=1):
                    area = int((lab[sl] == i).sum())
                    if area < total * 0.006:
                        continue
                    piece = full.crop((sl[1].start, sl[0].start, sl[1].stop, sl[0].stop))
                    own = (lab[sl] == i)
                    pa = np.asarray(piece.getchannel("A")).copy()
                    pa[~own] = 0
                    piece.putalpha(Image.fromarray(pa))
                    pieces.append(piece)
            kept = 0  # piece index counts kept pieces only, so ids match earlier runs
            for piece in pieces:
                piece = trim(piece)
                if min(piece.size) < 40:
                    continue
                pi = kept
                kept += 1
                arr = np.asarray(piece)
                alpha = arr[..., 3].astype(np.float32) / 255.0
                coverage = float((alpha > 0.5).mean())
                aid = alloc(src_id, pi, kind)
                file, w, h = save(piece, kind, aid, True)
                e = {
                    "id": aid,
                    "sourceId": src_id,
                    "kind": kind,
                    "file": file,
                    "w": w,
                    "h": h,
                    "cutout": True,
                    "tone": tone_of(arr[..., :3], alpha),
                    "coverage": round(coverage, 3),
                    "source": source,
                }
                if pose:
                    e["pose"] = pose
                if kind == "figure":
                    hb = head_box((np.asarray(piece.resize((w, h)).getchannel("A")).astype(np.float32) / 255.0), 1 / 7, 1.15)
                    if hb:
                        e["headBox"] = hb
                entries.append(e)
        else:
            aid = alloc(src_id, 0, kind)
            rgba = img.convert("RGBA")
            file, w, h = save(rgba, kind, aid, False)
            e = {"id": aid, "sourceId": src_id, "kind": kind, "file": file, "w": w, "h": h, "cutout": False,
                 "tone": tone_of(np.asarray(img), None), "source": source}
            if kind == "bust":
                # The sitter's mask locates the head for stamp crops; the image stays rectangular.
                cut = remove(cap(img, 640), session=session)
                a = np.asarray(cut.getchannel("A").resize((w, h))).astype(np.float32) / 255.0
                hb = head_box(a, 0.4, 0.95) if (a > 0.5).mean() > 0.04 else None
                e["headBox"] = hb or {"x": round(w * 0.2), "y": round(h * 0.08), "w": round(w * 0.6), "h": round(h * 0.45)}
            entries.append(e)
        out.extend(entries)
        print(f"{src_id:>12} -> {', '.join(x['id'] + '(' + x['tone'] + ')' for x in entries)}", flush=True)

    OUT.write_text(json.dumps(out, indent=1))
    IDS.write_text(json.dumps(ids, indent=0, sort_keys=True))
    by = {}
    for e in out:
        by[e["kind"]] = by.get(e["kind"], 0) + 1
    print(by)


if __name__ == "__main__":
    main()
