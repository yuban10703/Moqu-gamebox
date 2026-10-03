#!/usr/bin/env python3
"""从 APKMirror 取 Google Play 商店（com.android.vending）原版 APK。

为什么需要脚本：Play 商店 APK 按「Android 版本 + 架构」分变体，手点很容易拿错；
脚本按设备条件（Android 13 / arm64）挑变体，并把包名、签名、sha256 一起打出来留痕。

用法：
    # 只看会下载哪一个（不下载）
    python3 tools/device/fetch-play-store.py --url-only

    # 下载到指定目录（默认 tools/apk-inbox/）
    python3 tools/device/fetch-play-store.py --out tools/apk-inbox

变体：
    universal-a12plus   universal + Android 12+，**单 APK**，直接 adb install（默认，P6Plus 实测用这个）
    arm64-a12plus       arm64-v8a + Android 12+，APKMirror 上是 split BUNDLE（多 APK），
                        需要用 adb install-multiple 装整包，单独装 base 会缺拆分件

说明：脚本只做「解析页面 → 跟随官方下载入口」，不镜像、不修改 APK；
下载后请用 build-tools 的 aapt2/apksigner 复核包名与签名。
"""

import argparse
import hashlib
import html
import re
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("需要 requests：python3 -m pip install requests")

BASE = "https://www.apkmirror.com"
APP_PAGE = "/apk/google-inc/google-play-store/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

# 变体关键字：在最新版的表格里按 (架构, 最低 Android) 匹配
VARIANTS = {
    "arm64-a12plus": ("arm64-v8a", "Android 12+"),
    "universal-a12plus": ("universal", "Android 12+"),
}


def newest_release(session):
    r = session.get(BASE + APP_PAGE, headers=HEADERS, timeout=30)
    r.raise_for_status()
    rel = re.findall(r'href="(/apk/google-inc/google-play-store/google-play-store-([0-9][0-9-]*)-release/)"', r.text)
    if not rel:
        raise SystemExit("没解析到版本列表（页面结构可能变了）")
    # 注意：应用页的链接不是「最新在前」（会混进推荐位里的老版本），
    # 所以按 slug 里的版本号排序取最大，而不是取第一个。
    def ver(slug):
        return tuple(int(x) for x in slug.split("-"))
    return max(rel, key=lambda m: ver(m[1]))[0]


def pick_variant(session, release, variant):
    url = BASE + release
    r = session.get(url, headers={**HEADERS, "Referer": BASE + APP_PAGE}, timeout=30)
    r.raise_for_status()
    arch, api = VARIANTS[variant]
    for row in re.split(r'<div class="table-row', r.text)[1:]:
        link = re.search(r'href="(/apk/[^"]*?apk-download/)"', row)
        if not link:
            continue
        text = re.sub(r"<[^>]+>", " ", row)
        text = re.sub(r"\s+", " ", text)
        if arch in text and api in text and " BUNDLE" not in text:
            return link.group(1), text.strip()
    # 退一步：允许 BUNDLE（split APK，需 install-multiple）
    for row in re.split(r'<div class="table-row', r.text)[1:]:
        link = re.search(r'href="(/apk/[^"]*?apk-download/)"', row)
        if not link:
            continue
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", row)).strip()
        if arch in text and api in text:
            return link.group(1), text
    raise SystemExit(f"该版本里找不到变体：{variant}")


def resolve_download(session, dl_page):
    referer = BASE + dl_page
    r = session.get(referer, headers={**HEADERS, "Referer": BASE + APP_PAGE}, timeout=30)
    r.raise_for_status()
    m = re.search(r'href="([^"]*download/\?key=[^"]*)"', r.text)
    if not m:
        raise SystemExit("页面上没有下载入口（可能被风控挡了）")
    r2 = session.get(BASE + html.unescape(m.group(1)), headers={**HEADERS, "Referer": referer}, timeout=40)
    r2.raise_for_status()
    m2 = re.search(r"(/wp-content/themes/APKMirror/download\.php\?id=[^\"']+)", r2.text)
    if not m2:
        raise SystemExit("没拿到最终下载地址")
    return html.unescape(m2.group(1)), r2.url


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="tools/apk-inbox", help="APK 落地目录")
    ap.add_argument("--variant", default="universal-a12plus", choices=sorted(VARIANTS))
    ap.add_argument("--url-only", action="store_true", help="只解析不下载")
    args = ap.parse_args()

    session = requests.Session()
    release = newest_release(session)
    dl_page, desc = pick_variant(session, release, args.variant)
    print(f"版本页   : {BASE + release}")
    print(f"变体     : {args.variant}  →  {desc[:120]}")
    final, referer = resolve_download(session, dl_page)
    print(f"下载入口 : {BASE}{final}")

    if args.url_only:
        return

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^A-Za-z0-9._-]", "_", release.strip("/").split("/")[-1]) + f"-{args.variant}.apk"
    dest = out_dir / name
    print(f"开始下载 → {dest}")
    digest = hashlib.sha256()
    total = 0
    with session.get(BASE + final, headers={**HEADERS, "Referer": referer}, stream=True, timeout=120) as r:
        r.raise_for_status()
        with dest.open("wb") as f:
            for chunk in r.iter_content(1 << 16):
                f.write(chunk)
                digest.update(chunk)
                total += len(chunk)
    print(f"完成：{total} 字节  sha256={digest.hexdigest()}")
    print("复核：" f"{Path('.toolchain/android-sdk/build-tools/35.0.0')}/aapt2 dump badging {dest} | head -3")


if __name__ == "__main__":
    main()
