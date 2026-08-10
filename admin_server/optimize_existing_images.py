from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from PIL import Image


MAX_BACKGROUND_EDGE = 2560
THUMBNAIL_EDGE = 480


def save_webp(image: Image.Image, destination: Path, quality: int) -> None:
    temporary = destination.with_suffix(".webp.tmp")
    image.save(temporary, format="WEBP", quality=quality, method=6)
    os.chmod(temporary, 0o644)
    os.replace(temporary, destination)


def main() -> None:
    parser = argparse.ArgumentParser(description="Optimize existing uploaded backgrounds")
    parser.add_argument("--site-root", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()

    settings = json.loads(args.config.read_text(encoding="utf-8"))
    thumbnail_root = args.site_root / "uploads" / "thumbnails"
    thumbnail_root.mkdir(parents=True, exist_ok=True)
    optimized = 0

    for item in settings.get("backgrounds", []):
        if item.get("source") != "upload":
            continue
        image_path = args.site_root / item["url"].lstrip("/")
        thumbnail_path = thumbnail_root / f"{item['id']}.webp"
        with Image.open(image_path) as source:
            source.load()
            image = source.convert("RGBA" if "A" in source.getbands() else "RGB")
        image.thumbnail((MAX_BACKGROUND_EDGE, MAX_BACKGROUND_EDGE), Image.Resampling.LANCZOS)
        thumbnail = image.copy()
        thumbnail.thumbnail((THUMBNAIL_EDGE, THUMBNAIL_EDGE), Image.Resampling.LANCZOS)
        save_webp(image, image_path, 84)
        save_webp(thumbnail, thumbnail_path, 76)
        item["thumbnail_url"] = f"/uploads/thumbnails/{thumbnail_path.name}"
        optimized += 1

    settings["revision"] = int(settings.get("revision", 0)) + 1
    temporary_config = args.config.with_suffix(".json.tmp")
    temporary_config.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary_config, 0o640)
    os.replace(temporary_config, args.config)
    print(f"Optimized {optimized} uploaded backgrounds")


if __name__ == "__main__":
    main()
