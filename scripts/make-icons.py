"""Generate every icon the app needs (a sun on navy) with Pillow.

Usage:  python3 scripts/make-icons.py
Writes into icons/:
  icon-192.png, icon-512.png            "any" icons: rounded square, transparent corners
  icon-maskable-192.png, -512.png       full-bleed and fully opaque, artwork inside the maskable safe zone
  apple-touch-icon.png                  180x180, fully opaque (iOS paints transparency black)
  favicon-32.png                        browser tab icon for browsers without SVG favicons
  shortcut-quote-96.png, shortcut-jobs-96.png, shortcut-stock-96.png
                                        long-press menu entries on the installed app

Everything is drawn at 4x size and downsampled so the edges are smooth, then reduced to a small
palette (two flat colours plus anti-aliasing need very few) to keep the offline cache small.
The script fails loudly if a maskable icon's artwork leaves the safe zone.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

NAVY = (15, 42, 67, 255)
AMBER = (245, 166, 35, 255)
OUT = Path(__file__).resolve().parent.parent / "icons"
SCALE = 4
SAFE_RADIUS = 0.40  # maskable spec: important content must sit inside a circle of 40% of the width


def canvas(size, background, rounded):
    s = size * SCALE
    if rounded:
        img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        ImageDraw.Draw(img).rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.22), fill=NAVY)
    else:
        img = Image.new("RGBA", (s, s), background)
    return img, ImageDraw.Draw(img), s


def draw_sun(d, s, sun_r, ray_in, ray_out, ray_w):
    cx = cy = s / 2
    d.ellipse((cx - s * sun_r, cy - s * sun_r, cx + s * sun_r, cy + s * sun_r), fill=AMBER)
    w = s * ray_w
    for k in range(8):
        a = math.radians(k * 45)
        x1, y1 = cx + s * ray_in * math.cos(a), cy + s * ray_in * math.sin(a)
        x2, y2 = cx + s * ray_out * math.cos(a), cy + s * ray_out * math.sin(a)
        d.line((x1, y1, x2, y2), fill=AMBER, width=int(w))
        for x, y in ((x1, y1), (x2, y2)):  # round caps
            d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=AMBER)


def sun_icon(size, kind):
    """kind: any | maskable | apple | tiny"""
    if kind == "any":
        img, d, s = canvas(size, NAVY, rounded=True)
        draw_sun(d, s, 0.17, 0.25, 0.35, 0.045)
    elif kind == "maskable":
        img, d, s = canvas(size, NAVY, rounded=False)
        # Whole drawing (rays plus round caps) stays inside r = 0.3325 < 0.40.
        draw_sun(d, s, 0.15, 0.22, 0.31, 0.045)
    elif kind == "apple":
        img, d, s = canvas(size, NAVY, rounded=False)  # iOS rounds the corners itself
        draw_sun(d, s, 0.17, 0.25, 0.35, 0.05)
    else:  # tiny: fewer, thicker details so it still reads at 32 px
        img, d, s = canvas(size, NAVY, rounded=True)
        draw_sun(d, s, 0.22, 0.33, 0.43, 0.085)
    return img.resize((size, size), Image.LANCZOS)


def glyph_base(size=96):
    img, d, s = canvas(size, NAVY, rounded=True)
    return img, d, s


def shortcut_quote():
    """Calculator: display bar and a 3 x 3 key grid."""
    img, d, s = glyph_base()
    u = s / 96
    d.rounded_rectangle((26 * u, 16 * u, 70 * u, 80 * u), radius=6 * u, outline=AMBER, width=int(4 * u))
    d.rounded_rectangle((33 * u, 23 * u, 63 * u, 36 * u), radius=2 * u, fill=AMBER)
    for row in range(3):
        for col in range(3):
            x, y = (33 + col * 11) * u, (44 + row * 11) * u
            d.rounded_rectangle((x, y, x + 8 * u, y + 8 * u), radius=2 * u, fill=AMBER)
    return img.resize((96, 96), Image.LANCZOS)


def shortcut_jobs():
    """Clipboard with three lines of work."""
    img, d, s = glyph_base()
    u = s / 96
    d.rounded_rectangle((24 * u, 22 * u, 72 * u, 80 * u), radius=6 * u, outline=AMBER, width=int(4 * u))
    d.rounded_rectangle((36 * u, 14 * u, 60 * u, 28 * u), radius=4 * u, fill=AMBER)
    for i in range(3):
        y = (42 + i * 12) * u
        d.rounded_rectangle((33 * u, y, 63 * u, y + 5 * u), radius=2 * u, fill=AMBER)
    return img.resize((96, 96), Image.LANCZOS)


def shortcut_stock():
    """Carton: lid line and a tape strip down the middle."""
    img, d, s = glyph_base()
    u = s / 96
    d.rounded_rectangle((18 * u, 28 * u, 78 * u, 76 * u), radius=5 * u, outline=AMBER, width=int(4 * u))
    d.rectangle((18 * u, 40 * u, 78 * u, 44 * u), fill=AMBER)
    d.rectangle((42 * u, 28 * u, 54 * u, 52 * u), fill=AMBER)
    return img.resize((96, 96), Image.LANCZOS)


def save_small(img, path, colors=32):
    img.quantize(colors=colors, method=Image.Quantize.FASTOCTREE).save(path, optimize=True)


def check_safe_zone(path):
    """Every pixel that differs from the navy background must lie inside the maskable safe circle."""
    img = Image.open(path).convert("RGBA").convert("RGB")
    w, h = img.size
    cx, cy = w / 2, h / 2
    worst = 0.0
    for y in range(h):
        for x in range(w):
            r, g, b = img.getpixel((x, y))
            if abs(r - NAVY[0]) + abs(g - NAVY[1]) + abs(b - NAVY[2]) > 30:  # artwork, not background
                worst = max(worst, math.hypot(x + 0.5 - cx, y + 0.5 - cy) / w)
    assert worst <= SAFE_RADIUS, f"{path.name}: artwork reaches {worst:.3f} of the width, limit {SAFE_RADIUS}"
    return worst


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    save_small(sun_icon(192, "any"), OUT / "icon-192.png")
    save_small(sun_icon(512, "any"), OUT / "icon-512.png")
    save_small(sun_icon(192, "maskable").convert("RGB"), OUT / "icon-maskable-192.png")
    save_small(sun_icon(512, "maskable").convert("RGB"), OUT / "icon-maskable-512.png")
    save_small(sun_icon(180, "apple").convert("RGB"), OUT / "apple-touch-icon.png")
    save_small(sun_icon(32, "tiny"), OUT / "favicon-32.png", colors=16)
    save_small(shortcut_quote(), OUT / "shortcut-quote-96.png")
    save_small(shortcut_jobs(), OUT / "shortcut-jobs-96.png")
    save_small(shortcut_stock(), OUT / "shortcut-stock-96.png")
    for name in ("icon-maskable-192.png", "icon-maskable-512.png"):
        print(f"{name}: artwork reaches {check_safe_zone(OUT / name):.3f} of the width (limit {SAFE_RADIUS})")
    print("Wrote icons to", OUT)
