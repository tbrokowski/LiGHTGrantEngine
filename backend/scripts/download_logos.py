"""
Download official funder logos from Wikimedia Commons and official CDNs.

Usage (from repo root):
    cd backend
    python scripts/download_logos.py

Logos are saved to frontend/public/logos/{slug}.{ext}
"""
import os
import sys
import time
import requests

# Resolve path to frontend/public/logos from backend/scripts/
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
OUTPUT_DIR = os.path.join(REPO_ROOT, "frontend", "public", "logos")

# slug → (url, output_filename)
# Sources: Wikimedia Commons (public domain) and official brand CDNs
# Wikimedia URL format: https://upload.wikimedia.org/wikipedia/commons/{md5[0]}/{md5[0:2]}/{filename}
LOGO_SOURCES: dict[str, tuple[str, str]] = {
    # ── US Government (public domain) ────────────────────────────────────────
    "nih": (
        "https://upload.wikimedia.org/wikipedia/commons/4/43/NIH_logo.svg",
        "nih.svg",
    ),
    "nsf": (
        # hash confirmed from File:NSF.svg page
        "https://upload.wikimedia.org/wikipedia/commons/1/12/NSF.svg",
        "nsf.svg",
    ),
    "usaid": (
        "https://upload.wikimedia.org/wikipedia/commons/1/17/USAID-Identity.svg",
        "usaid.svg",
    ),
    # ── Foundations (Wikimedia Commons) ──────────────────────────────────────
    "gates-foundation": (
        "https://upload.wikimedia.org/wikipedia/commons/6/66/Bill_%26_Melinda_Gates_Foundation_logo.svg",
        "gates-foundation.svg",
    ),
    "wellcome": (
        "https://upload.wikimedia.org/wikipedia/commons/5/58/Wellcome_Trust_logo.svg",
        "wellcome.svg",
    ),
    "ford-foundation": (
        # hash confirmed from File:Logo_of_the_Ford_Foundation.svg page
        "https://upload.wikimedia.org/wikipedia/commons/2/2d/Logo_of_the_Ford_Foundation.svg",
        "ford-foundation.svg",
    ),
    "macarthur": (
        "https://upload.wikimedia.org/wikipedia/commons/7/73/MacArth_primary_logo_stacked.svg",
        "macarthur.svg",
    ),
    "chan-zuckerberg": (
        "https://upload.wikimedia.org/wikipedia/commons/5/55/Chan_Zuckerberg_Initiative_logo.svg",
        "chan-zuckerberg.svg",
    ),
    # ── International organisations (Wikimedia Commons) ──────────────────────
    "ukri": (
        "https://upload.wikimedia.org/wikipedia/commons/e/e4/UK_Research_and_Innovation_logo.svg",
        "ukri.svg",
    ),
    "world-bank": (
        "https://upload.wikimedia.org/wikipedia/commons/8/87/The_World_Bank_logo.svg",
        "world-bank.svg",
    ),
    "global-fund": (
        "https://upload.wikimedia.org/wikipedia/commons/c/cb/The_Global_Fund_logo.svg",
        "global-fund.svg",
    ),
    "horizon-europe": (
        "https://upload.wikimedia.org/wikipedia/commons/a/a0/HorizonEurope.svg",
        "horizon-europe.svg",
    ),
    "ted": (
        "https://upload.wikimedia.org/wikipedia/commons/9/9f/TED_wordmark.svg",
        "ted.svg",
    ),
    "who": (
        "https://upload.wikimedia.org/wikipedia/commons/2/29/WHO_logo.png",
        "who.png",
    ),
    "unicef": (
        "https://upload.wikimedia.org/wikipedia/commons/e/ed/UNICEF_Logo.svg",
        "unicef.svg",
    ),
    "undp": (
        "https://upload.wikimedia.org/wikipedia/commons/2/29/UNDP_logo.svg",
        "undp.svg",
    ),
    # ── Official CDN sources ──────────────────────────────────────────────────
    "edctp": (
        "https://www.edctp.org/app/uploads/2017/01/03-Red_EDCTP.jpg",
        "edctp.jpg",
    ),
    "grants-gov": (
        "https://simpler.grants.gov/img/logo.svg",
        "grants-gov.svg",
    ),
}

HEADERS = {
    "User-Agent": "LiGHTGrantEngine/1.0 (logo-downloader; research tool)",
}


def _fetch_with_retry(url: str, max_retries: int = 4) -> requests.Response:
    """GET url with exponential backoff on 429 rate-limit responses."""
    delay = 2.0
    for attempt in range(max_retries):
        resp = requests.get(url, headers=HEADERS, timeout=20)
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", delay))
            wait = max(retry_after, delay)
            print(f"    [429] rate-limited, waiting {wait:.0f}s…")
            time.sleep(wait)
            delay *= 2
            continue
        return resp
    resp.raise_for_status()
    return resp


def download_logos(output_dir: str, force: bool = False) -> None:
    os.makedirs(output_dir, exist_ok=True)

    success = 0
    skipped = 0
    failed = 0

    for slug, (url, filename) in LOGO_SOURCES.items():
        dest = os.path.join(output_dir, filename)

        if os.path.exists(dest) and not force:
            print(f"  [skip]    {filename} (already exists)")
            skipped += 1
            continue

        try:
            resp = _fetch_with_retry(url)
            resp.raise_for_status()

            # Basic content check — must not be an HTML page
            content_type = resp.headers.get("content-type", "")
            if "text/html" in content_type and b"<!DOCTYPE" in resp.content[:200]:
                print(f"  [WARN]    {slug}: got HTML response (logo page, not asset) — skipping")
                failed += 1
                continue

            with open(dest, "wb") as f:
                f.write(resp.content)

            size_kb = len(resp.content) / 1024
            print(f"  [ok]      {filename}  ({size_kb:.1f} KB)  ← {url[:70]}")
            success += 1
            time.sleep(1.5)  # be polite to Wikimedia

        except requests.exceptions.HTTPError as e:
            print(f"  [FAIL]    {slug}: HTTP {e.response.status_code} — {url}")
            failed += 1
        except Exception as e:
            print(f"  [FAIL]    {slug}: {e}")
            failed += 1

    print(f"\nDone: {success} downloaded, {skipped} skipped, {failed} failed")
    print(f"Output: {output_dir}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Download funder logos to frontend/public/logos/")
    parser.add_argument("--force", action="store_true", help="Re-download even if file already exists")
    parser.add_argument("--output-dir", default=OUTPUT_DIR, help="Override output directory")
    args = parser.parse_args()

    print(f"Downloading {len(LOGO_SOURCES)} funder logos to: {args.output_dir}\n")
    download_logos(args.output_dir, force=args.force)
