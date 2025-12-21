from __future__ import annotations

import struct
import zlib
from pathlib import Path


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    length = struct.pack("!I", len(data))
    crc = zlib.crc32(kind + data) & 0xFFFFFFFF
    return length + kind + data + struct.pack("!I", crc)


def rgba_to_png(width: int, height: int, rgba: bytes) -> bytes:
    if len(rgba) != width * height * 4:
        raise ValueError("invalid rgba buffer size")
    # PNG scanlines: each row starts with filter=0, then raw RGBA bytes.
    raw = b"".join(b"\x00" + rgba[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    compressed = zlib.compress(raw, level=9)

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack("!IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return signature + _png_chunk(b"IHDR", ihdr) + _png_chunk(b"IDAT", compressed) + _png_chunk(b"IEND", b"")


def make_icon(size: int) -> bytes:
    w = h = int(size)
    bg = (0x0B, 0x0F, 0x14, 0xFF)
    berry = (0xFF, 0x4D, 0x4D, 0xFF)
    leaf = (0x2E, 0xCC, 0x71, 0xFF)
    highlight = (0xFF, 0xFF, 0xFF, 0x55)

    cx = (w - 1) / 2.0
    cy = (h - 1) / 2.0
    r = w * 0.33
    lr = w * 0.10
    hr = w * 0.10

    # Pre-allocate RGBA.
    buf = bytearray(w * h * 4)

    def put(x: int, y: int, col: tuple[int, int, int, int]) -> None:
        i = (y * w + x) * 4
        buf[i : i + 4] = bytes(col)

    for y in range(h):
        dy = (y - cy) + 0.5
        for x in range(w):
            dx = (x - cx) + 0.5
            col = bg

            # Main berry circle.
            if dx * dx + dy * dy <= r * r:
                col = berry

            # Leaf (small green circle) near the top.
            ldx = (x - cx) + 0.5
            ldy = (y - (cy - r * 0.95)) + 0.5
            if ldx * ldx + ldy * ldy <= lr * lr:
                col = leaf

            # Highlight (semi-transparent circle) on top-left of berry.
            hdx = (x - (cx - r * 0.35)) + 0.5
            hdy = (y - (cy - r * 0.35)) + 0.5
            if hdx * hdx + hdy * hdy <= hr * hr and col == berry:
                col = highlight

            put(x, y, col)

    # Alpha blend highlight onto berry pixels.
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * 4
            a = buf[i + 3]
            if a == 0x55:  # highlight marker
                # Underlay is berry.
                sr, sg, sb, sa = 0xFF, 0xFF, 0xFF, 0x55
                dr, dg, db, da = berry
                alpha = sa / 255.0
                out = (
                    int(dr * (1 - alpha) + sr * alpha),
                    int(dg * (1 - alpha) + sg * alpha),
                    int(db * (1 - alpha) + sb * alpha),
                    da,
                )
                buf[i : i + 4] = bytes(out)

    return rgba_to_png(w, h, bytes(buf))


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    out_dir = root / "public" / "icons"
    out_dir.mkdir(parents=True, exist_ok=True)

    for size, name in (
        (192, "icon-192.png"),
        (512, "icon-512.png"),
    ):
        data = make_icon(size)
        (out_dir / name).write_bytes(data)
        print(f"[pwa-icons] wrote {name} ({size}x{size})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
