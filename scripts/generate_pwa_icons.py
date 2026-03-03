from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    out_dir = root / "public" / "icons"
    out_dir.mkdir(parents=True, exist_ok=True)
    icon_svg = out_dir / "icon.svg"
    if not icon_svg.exists():
        raise FileNotFoundError(f"icon.svg not found: {icon_svg}")

    rsvg = shutil.which("rsvg-convert")
    if not rsvg:
        raise RuntimeError("rsvg-convert not found (install librsvg: rsvg-convert)")

    for size, name in ((192, "icon-192.png"), (512, "icon-512.png")):
        out_path = out_dir / name
        subprocess.run(
            [rsvg, "-w", str(size), "-h", str(size), "-o", str(out_path), str(icon_svg)],
            check=True,
        )
        print(f"[pwa-icons] wrote {name} ({size}x{size})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
