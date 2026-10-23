"""Generate the PWA icons (a sun on navy) with Pillow.

Usage:  python3 scripts/make-icons.py
Writes: icons/icon-192.png, icons/icon-512.png, icons/icon-maskable-512.png

Drawn at 4x size and downsampled so the edges are smooth.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

NAVY = (15, 42, 67, 255)
AMBER = (245, 166, 35, 255)
OUT = Path(__file__).resolve().parent.parent / "icons"


def draw_icon(size: int, maskable: bool) -> Image.Image:
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), NAVY if maskable else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if not maskable:  # "any" icons get rounded corners; maskable ones are full-bleed
        d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=NAVY)

    cx = cy = s / 2
    # Keep everything inside the central 70% so launchers can crop to any mask shape.
    sun_r = s * (0.15 if maskable else 0.17)
    ray_in = s * (0.22 if maskable else 0.25)
    ray_out = s * (0.31 if maskable else 0.35)
    ray_w = s * 0.045

    d.ellipse((cx - sun_r, cy - sun_r, cx + sun_r, cy + sun_r), fill=AMBER)
    for k in range(8):
        a = math.radians(k * 45)
        x1, y1 = cx + ray_in * math.cos(a), cy + ray_in * math.sin(a)
        x2, y2 = cx + ray_out * math.cos(a), cy + ray_out * math.sin(a)
        d.line((x1, y1, x2, y2), fill=AMBER, width=int(ray_w))
        for x, y in ((x1, y1), (x2, y2)):  # round caps
            d.ellipse((x - ray_w / 2, y - ray_w / 2, x + ray_w / 2, y + ray_w / 2), fill=AMBER)

    return img.resize((size, size), Image.LANCZOS)


def save_small(img: Image.Image, path: Path) -> None:
    """Two flat colours plus anti-aliasing need very few palette entries; 32 keeps edges smooth
    while cutting file size by roughly 5x compared with 32-bit RGBA."""
    img.quantize(colors=32, method=Image.Quantize.FASTOCTREE).save(path, optimize=True)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    save_small(draw_icon(192, False), OUT / "icon-192.png")
    save_small(draw_icon(512, False), OUT / "icon-512.png")
    save_small(draw_icon(512, True), OUT / "icon-maskable-512.png")
    print("Wrote icons to", OUT)
