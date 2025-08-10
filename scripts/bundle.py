#!/usr/bin/env python3
"""
Bundle the extension directory into a ZIP that can be drag-and-dropped
into chrome://extensions (Developer mode).

Usage:
  python scripts/bundle.py                # bundles ./extension -> ./dist/<name>-<version>.zip
  python scripts/bundle.py -s path/to/ext # custom source (must contain manifest.json)
  python scripts/bundle.py -o outdir      # custom output directory
  python scripts/bundle.py -n custom.zip  # custom zip filename
"""
import argparse
import json
import re
import sys
import zipfile
from pathlib import Path


def sanitize(name: str) -> str:
    # Safe filename: lowercase and replace spaces/odd chars with '-'
    return re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-").lower()


def bundle(src_dir: Path, out_dir: Path, zip_name: str | None):
    manifest_path = src_dir / "manifest.json"
    if not manifest_path.exists():
        print(f"Error: {manifest_path} not found", file=sys.stderr)
        sys.exit(2)

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    base_name = sanitize(manifest.get("name", "extension"))
    version = manifest.get("version", "0.0.0")

    out_dir.mkdir(parents=True, exist_ok=True)
    zip_path = out_dir / (zip_name or f"{base_name}-{version}.zip")

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in src_dir.rglob("*"):
            if path.is_dir():
                continue
            rel = path.relative_to(src_dir)
            # Skip common junk files
            if rel.name in (".DS_Store",):
                continue
            zf.write(path, arcname=rel.as_posix())

    print(zip_path.resolve())


def main():
    parser = argparse.ArgumentParser(
        description="Bundle a Chromium extension into a ZIP suitable for drag & drop into chrome://extensions"
    )
    parser.add_argument(
        "-s",
        "--src",
        default="extension",
        help="Source directory containing manifest.json (default: extension)",
    )
    parser.add_argument(
        "-o",
        "--out",
        default="dist",
        help="Output directory for the zip (default: dist)",
    )
    parser.add_argument(
        "-n",
        "--name",
        default=None,
        help="Override the zip file name (e.g., my-ext.zip)",
    )
    args = parser.parse_args()

    src_dir = Path(args.src).resolve()
    out_dir = Path(args.out).resolve()
    bundle(src_dir, out_dir, args.name)


if __name__ == "__main__":
    main()
