import json
import re
import sys
from pathlib import Path

import instaloader
import requests


def parse_shortcode(url: str) -> str | None:
    patterns = [
        r"instagram\.com/p/([A-Za-z0-9_-]+)",
        r"instagram\.com/reel/([A-Za-z0-9_-]+)",
        r"instagram\.com/tv/([A-Za-z0-9_-]+)",
        r"instagram\.com/reels/([A-Za-z0-9_-]+)",
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)

    return None


def make_loader() -> instaloader.Instaloader:
    return instaloader.Instaloader(
        download_videos=True,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        quiet=True,
    )


def fetch_media_list(url: str) -> list[dict]:
    shortcode = parse_shortcode(url)
    if not shortcode:
        raise ValueError("Cannot recognize an Instagram post or Reel link.")

    loader = make_loader()
    post = instaloader.Post.from_shortcode(loader.context, shortcode)

    owner = post.owner_username
    base = f"{post.date_utc.strftime('%Y%m%d_%H%M%S')}_{shortcode}"
    caption = post.caption or ""
    media_items = []

    if post.typename == "GraphSidecar":
        nodes = list(post.get_sidecar_nodes())

        for index, node in enumerate(nodes, 1):
            is_video = bool(node.is_video)
            media_type = "video" if is_video else "image"
            ext = "mp4" if is_video else "jpg"
            media_url = node.video_url if is_video else node.display_url
            thumb_url = node.display_url

            media_items.append({
                "index": index,
                "type": media_type,
                "ext": ext,
                "media_url": media_url,
                "thumb_url": thumb_url,
                "filename": f"{base}_{index}.{ext}",
                "owner": owner,
                "shortcode": shortcode,
                "caption": caption,
            })
    elif post.is_video:
        media_items.append({
            "index": 1,
            "type": "video",
            "ext": "mp4",
            "media_url": post.video_url,
            "thumb_url": post.url,
            "filename": f"{base}.mp4",
            "owner": owner,
            "shortcode": shortcode,
            "caption": caption,
        })
    else:
        media_items.append({
            "index": 1,
            "type": "image",
            "ext": "jpg",
            "media_url": post.url,
            "thumb_url": post.url,
            "filename": f"{base}.jpg",
            "owner": owner,
            "shortcode": shortcode,
            "caption": caption,
        })

    return media_items


def download_file(url: str, save_path: Path) -> None:
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.instagram.com/",
    }

    with requests.get(url, stream=True, timeout=60, headers=headers) as response:
        response.raise_for_status()
        with save_path.open("wb") as file:
            for chunk in response.iter_content(chunk_size=1024 * 128):
                if chunk:
                    file.write(chunk)


def emit(payload: dict | list) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def handle_preview(url: str) -> None:
    items = fetch_media_list(url)
    emit(items)


def handle_download(url: str, item_index: int, output_dir: Path) -> None:
    items = fetch_media_list(url)
    selected = next((item for item in items if int(item["index"]) == item_index), None)
    if selected is None:
        selected = items[0] if items else None

    if selected is None:
        raise ValueError("No media items found.")

    output_dir.mkdir(parents=True, exist_ok=True)
    save_path = output_dir / selected["filename"]
    download_file(selected["media_url"], save_path)

    emit({
        "filePath": str(save_path),
        "filename": selected["filename"],
        "type": selected["type"],
        "ext": selected["ext"],
    })


def handle_download_all(url: str, output_dir: Path) -> None:
    items = fetch_media_list(url)
    if not items:
        raise ValueError("No media items found.")

    output_dir.mkdir(parents=True, exist_ok=True)
    files = []

    for item in items:
        save_path = output_dir / item["filename"]
        download_file(item["media_url"], save_path)
        files.append({
            "filePath": str(save_path),
            "filename": item["filename"],
            "type": item["type"],
            "ext": item["ext"],
        })

    emit({
        "owner": items[0].get("owner", "instagram"),
        "shortcode": items[0].get("shortcode", "media"),
        "files": files,
    })


def main() -> int:
    if len(sys.argv) < 3:
        raise ValueError("Usage: instagram_provider.py preview <url> | download <url> <itemIndex> <outputDir>")

    command = sys.argv[1]
    url = sys.argv[2]

    if command == "preview":
        handle_preview(url)
        return 0

    if command == "download":
        item_index = int(sys.argv[3]) if len(sys.argv) > 3 else 1
        output_dir = Path(sys.argv[4]) if len(sys.argv) > 4 else Path.cwd()
        handle_download(url, item_index, output_dir)
        return 0

    if command == "download_all":
        output_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else Path.cwd()
        handle_download_all(url, output_dir)
        return 0

    raise ValueError(f"Unknown command: {command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        raise SystemExit(1)
