#!/usr/bin/env python3
"""
「墨趣」图标生成器 v3「墨滴手柄」（2026-10-04 换新图标）。

源图：同目录的 source.png（1254×1254，白底黑墨滴，墨滴里挖出十字键与两个按钮）。
**改图标只换 source.png 并重跑本脚本**，所有产物都由它单一来源生成：

  栅格（Android 传统 mipmap、Web favicon / PWA 图标）
      直接从 source.png 面积平均缩放到目标尺寸，再按 50% 阈值二值化 ——
      产物只有纯黑 / 纯白 / 透明三种像素（墨水屏 1-bit：灰阶会被抖动成噪点）。
  矢量（Android adaptive icon 前景、网页 icon.svg）
      用下面 GLYPH_* 常量描述的同一个图形（对源图轮廓做的贝塞尔拟合）；
      脚本会把矢量自己栅格化回 1254px，与 source.png 逐像素比对，重合度低于阈值即失败，
      保证「矢量版」和「位图版」是同一张图。

依赖：Python 3 + Pillow（不需要浏览器）。
运行：python3 apps/android/icon/gen-icons.py               （生成 + 自检）
      python3 apps/android/icon/gen-icons.py --no-verify   （只生成）
"""
from __future__ import annotations

import io
import math
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SOURCE = os.path.join(HERE, 'source.png')
ANDROID_RES = os.path.join(ROOT, 'apps', 'android', 'app', 'src', 'main', 'res')
WEB_PUBLIC = os.path.join(ROOT, 'apps', 'web', 'public')

# --------------------------------------------------------------------------- 源图几何
# 墨滴在 source.png 里的外接盒中心与高度（像素）。下面所有比例都以「墨滴高 = 1」为单位。
# SRC_CY 取 597.5 而不是外接盒算出的 598.5：这是与 Pillow 多边形栅格化的像素约定对齐后
# 误差最小的值（自检里矢量与源图的重合度据此计算）。
SRC_CX, SRC_CY, SRC_H = 626.0, 597.5, 976.0

# 墨滴轮廓：右半边的三次贝塞尔段（墨滴高 = 1、外接盒中心 = 原点，y 向下），左半边镜像。
# 依次是：圆润的尖顶 → 内凹的上肩 → 外凸到最宽处 → 底部右瓣 → 底部中间的凹口（中点切线水平）。
GLYPH_START = (0.0, -0.5)
GLYPH_RIGHT = [
    ((0.0071, -0.5), (0.0132, -0.4917), (0.0149, -0.4859)),
    ((0.0329, -0.4234), (0.0952, -0.2969), (0.2827, -0.1389)),
    ((0.3071, -0.1184), (0.4503, 0.0198), (0.4503, 0.1935)),
    ((0.4503, 0.3778), (0.3536, 0.5), (0.2356, 0.5)),
    ((0.165, 0.5), (0.16, 0.409), (0.0, 0.409)),
]
# 挖空（白）：十字键（圆角外角、直角内角）与两个按钮
PLUS_CENTER = (-0.1747, 0.1819)
PLUS_HALF_LEN = 0.1537
PLUS_HALF_W = 0.0574
PLUS_CORNER = 0.0307
BUTTONS = [((0.2234, 0.1153), 0.0697), ((0.2905, 0.2736), 0.0697)]
# 轮廓上离中心最远的点到中心的距离（墨滴高 = 1）：用来把图形装进各种安全圆
GLYPH_RADIUS = 0.5756

# --------------------------------------------------------------------------- 各产物里墨滴的高度
GLYPH_SQUARE = 0.78   # 圆角方 / 圆形图标：墨滴高占画布比例（圆形时最远点 0.449 < 0.5，不出圆）
GLYPH_TINY = 0.9      # 32px：小尺寸尽量放大，十字键和按钮才不会糊掉
GLYPH_16 = 0.92       # 16px：走 tiny_glyph 的光学补偿（见那里的说明）
GLYPH_MASKABLE = 0.4 / GLYPH_RADIUS * 0.98  # maskable：最远点装进中心 80% 安全圆（半径 0.4，留 2% 余量）
ADAPTIVE_GLYPH_DP = 56  # adaptive 前景（108dp 视口）：最远点 56×0.5756 ≈ 32.2dp < 安全圆半径 33dp
CORNER = 0.22         # 圆角方图标的圆角半径 / 画布（沿用 v1/v2）

BLACK, WHITE = (0, 0, 0, 255), (255, 255, 255, 255)


# --------------------------------------------------------------------------- 矢量：路径字符串
def fmt(x: float) -> str:
    s = f'{x:.3f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def mirror(p):
    return (-p[0], p[1])


def body_segments():
    """完整外轮廓（右半 + 镜像左半），每段 (c1, c2, end)"""
    segs = list(GLYPH_RIGHT)
    starts = [GLYPH_START] + [s[2] for s in GLYPH_RIGHT[:-1]]
    for (c1, c2, _end), start in zip(reversed(GLYPH_RIGHT), reversed(starts)):
        segs.append((mirror(c2), mirror(c1), mirror(start)))
    return segs


def plus_vertices():
    """十字键顶点（顺时针），True = 外角（倒圆角），False = 内角（直角）"""
    cx, cy = PLUS_CENTER
    L, W = PLUS_HALF_LEN, PLUS_HALF_W
    pts = [
        (-W, -L, True), (W, -L, True), (W, -W, False), (L, -W, True), (L, W, True), (W, W, False),
        (W, L, True), (-W, L, True), (-W, W, False), (-L, W, True), (-L, -W, True), (-W, -W, False),
    ]
    return [(cx + x, cy + y, r) for x, y, r in pts]


def plus_corner_points(i, verts):
    x, y, _ = verts[i]
    px, py, _ = verts[i - 1]
    nx, ny, _ = verts[(i + 1) % len(verts)]
    r = PLUS_CORNER

    def toward(ax, ay):
        d = math.hypot(ax - x, ay - y)
        return (x + (ax - x) / d * r, y + (ay - y) / d * r)

    return toward(px, py), toward(nx, ny)


def svg_path(scale: float, ox: float, oy: float) -> str:
    """墨滴 + 挖空，统一走 evenodd 填充规则（SVG fill-rule / Android fillType 都支持）"""
    def P(p):
        return f'{fmt(ox + p[0] * scale)},{fmt(oy + p[1] * scale)}'

    d = [f'M{P(GLYPH_START)}']
    for c1, c2, end in body_segments():
        d.append(f'C{P(c1)} {P(c2)} {P(end)}')
    d.append('Z')
    verts = plus_vertices()
    r = fmt(PLUS_CORNER * scale)
    for i, (x, y, rounded) in enumerate(verts):
        if rounded:
            a, b = plus_corner_points(i, verts)
            d.append(f'{"M" if i == 0 else "L"}{P(a)}A{r},{r} 0 0 1 {P(b)}')
        else:
            d.append(f'{"M" if i == 0 else "L"}{P((x, y))}')
    d.append('Z')
    for (cx, cy), rad in BUTTONS:
        rr = fmt(rad * scale)
        d.append(f'M{P((cx - rad, cy))}a{rr},{rr} 0 1 0 {fmt(2 * rad * scale)},0a{rr},{rr} 0 1 0 {fmt(-2 * rad * scale)},0Z')
    return ''.join(d)


# --------------------------------------------------------------------------- 矢量：自检用的栅格化
def bez(p0, c1, c2, p3, n=48):
    out = []
    for k in range(1, n + 1):
        t = k / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3
        out.append((a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]))
    return out


def rasterize_vector(size: int, glyph_h: float, center: tuple[float, float]) -> Image.Image:
    """把矢量图形画成 size×size 的 1-bit 图（墨滴高 glyph_h 像素、中心在 center），只用于和源图比对"""
    def T(p):
        return (center[0] + p[0] * glyph_h, center[1] + p[1] * glyph_h)

    body = [GLYPH_START]
    for c1, c2, end in body_segments():
        body += bez(body[-1], c1, c2, end)
    plus = []
    verts = plus_vertices()
    for i, (x, y, rounded) in enumerate(verts):
        if not rounded:
            plus.append((x, y))
            continue
        a, b = plus_corner_points(i, verts)
        # 圆心 = 顶点沿两条邻边各退 r 后的对角点
        ccx, ccy = a[0] + b[0] - x, a[1] + b[1] - y
        a0 = math.atan2(a[1] - ccy, a[0] - ccx)
        a1 = math.atan2(b[1] - ccy, b[0] - ccx)
        while a1 < a0:
            a1 += 2 * math.pi
        for k in range(13):
            t = a0 + (a1 - a0) * k / 12
            plus.append((ccx + PLUS_CORNER * math.cos(t), ccy + PLUS_CORNER * math.sin(t)))
    img = Image.new('1', (size, size), 1)
    draw = ImageDraw.Draw(img)
    draw.polygon([T(p) for p in body], fill=0)
    draw.polygon([T(p) for p in plus], fill=1)
    for (cx, cy), rad in BUTTONS:
        x, y = T((cx, cy))
        draw.ellipse([x - rad * glyph_h, y - rad * glyph_h, x + rad * glyph_h, y + rad * glyph_h], fill=1)
    return img


# --------------------------------------------------------------------------- 栅格：从源图出图
def load_source() -> Image.Image:
    img = Image.open(SOURCE).convert('L')
    if img.size != (1254, 1254):
        print(f'[gen-icons] ⚠ source.png 尺寸是 {img.size}，几何常量按 1254×1254 标定，换图后请重新拟合', file=sys.stderr)
    return img


def glyph_bitmap(src: Image.Image, size: int, glyph_ratio: float, threshold: int = 128) -> Image.Image:
    """输出 size×size 的二值灰度图：墨滴高 = size×glyph_ratio、居中；面积平均缩放后按阈值（默认 50%）二值化"""
    scale = size * glyph_ratio / SRC_H  # 目标像素 / 源像素
    span = size / scale                 # 目标画布在源图里对应的边长
    box = (SRC_CX - span / 2, SRC_CY - span / 2, SRC_CX + span / 2, SRC_CY + span / 2)
    # 画布超出源图的部分补白（源图四周本来就是白纸）
    pad = int(math.ceil(max(0.0, -box[0], -box[1], box[2] - src.width, box[3] - src.height))) + 2
    canvas = Image.new('L', (src.width + 2 * pad, src.height + 2 * pad), 255)
    canvas.paste(src, (pad, pad))
    shifted = tuple(v + pad for v in box)
    small = canvas.resize((size, size), Image.Resampling.BOX, box=shifted)
    return small.point(lambda v: 0 if v < threshold else 255)


def tiny_glyph(src: Image.Image, size: int, glyph_ratio: float) -> Image.Image:
    """
    16px 专用的「小尺寸光学补偿」：面积平均缩放在这个尺寸下会把两个按钮粘成一团
    （试过 0.84~0.94 的墨滴高 × 100~170 的阈值，没有一组能分开）。
    因此只让**轮廓**照常从源图缩放（先填掉挖空，阈值放宽到 150 让底部凹口留得住），
    再按源图里的位置手工挖出 3×3 的十字键与两个单像素按钮。
    """
    filled = src.point(lambda v: 0 if v < 128 else 255)
    ImageDraw.floodfill(filled, (0, 0), 128)  # 外部纸面标成 128，其余（墨滴 + 挖空）都算墨
    silhouette = filled.point(lambda v: 255 if v == 128 else 0)
    glyph = glyph_bitmap(silhouette, size, glyph_ratio, threshold=150)

    def at(p):
        return int(size / 2 + p[0] * size * glyph_ratio), int(size / 2 + p[1] * size * glyph_ratio)

    px, py = at(PLUS_CENTER)
    for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
        glyph.putpixel((px + dx, py + dy), 255)
    for center, _radius in BUTTONS:
        glyph.putpixel(at(center), 255)
    return glyph


def shaped(src: Image.Image, size: int, glyph_ratio: float, shape: str) -> Image.Image:
    """把墨滴放到白底上：square = 圆角方，round = 圆，full = 满幅白底（maskable）；形状外透明"""
    glyph = tiny_glyph(src, size, glyph_ratio) if size <= 16 else glyph_bitmap(src, size, glyph_ratio)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    radius = size * CORNER
    for y in range(size):
        for x in range(size):
            px, py = x + 0.5, y + 0.5  # 像素中心判定：1-bit 边缘，不产生半透明
            if shape == 'round':
                inside = (px - size / 2) ** 2 + (py - size / 2) ** 2 <= (size / 2) ** 2
            elif shape == 'square':
                dx = max(radius - px, 0, px - (size - radius))
                dy = max(radius - py, 0, py - (size - radius))
                inside = dx * dx + dy * dy <= radius * radius
            else:
                inside = True
            if inside:
                out.putpixel((x, y), BLACK if glyph.getpixel((x, y)) == 0 else WHITE)
    return out


# --------------------------------------------------------------------------- 写文件
written: list[tuple[str, int]] = []


def emit(path: str, data: bytes) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(data)
    written.append((os.path.relpath(path, ROOT), len(data)))


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    return buf.getvalue()


def main() -> int:
    src = load_source()

    # 1) Android 传统 raster 兜底：mdpi 48 / hdpi 72 / xhdpi 96 / xxhdpi 144 / xxxhdpi 192
    for dpi, size in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
        emit(os.path.join(ANDROID_RES, f'mipmap-{dpi}', 'ic_launcher.png'), png_bytes(shaped(src, size, GLYPH_SQUARE, 'square')))
        emit(os.path.join(ANDROID_RES, f'mipmap-{dpi}', 'ic_launcher_round.png'), png_bytes(shaped(src, size, GLYPH_SQUARE, 'round')))

    # 2) Web：favicon / apple-touch / PWA
    for name, size, ratio in (
        ('favicon-16.png', 16, GLYPH_16),
        ('favicon-32.png', 32, GLYPH_TINY),
        ('apple-touch-icon.png', 180, GLYPH_SQUARE),
        ('icon-192.png', 192, GLYPH_SQUARE),
        ('icon-512.png', 512, GLYPH_SQUARE),
    ):
        emit(os.path.join(WEB_PUBLIC, name), png_bytes(shaped(src, size, ratio, 'square')))
    emit(os.path.join(WEB_PUBLIC, 'icon-maskable-512.png'), png_bytes(shaped(src, 512, GLYPH_MASKABLE, 'full')))

    # 3) 网页矢量图标（index.html / manifest 首选），与 PNG 同一图形
    s = 128
    emit(
        os.path.join(WEB_PUBLIC, 'icon.svg'),
        (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {s} {s}" width="{s}" height="{s}">\n'
            f'<rect width="{s}" height="{s}" rx="{fmt(s * CORNER)}" fill="#ffffff"/>\n'
            f'<path fill="#000000" fill-rule="evenodd" d="{svg_path(s * GLYPH_SQUARE, s / 2, s / 2)}"/>\n'
            '</svg>\n'
        ).encode(),
    )

    # 4) adaptive icon 前景：108dp 视口，墨滴全部落在中心 66dp 安全圆内
    emit(
        os.path.join(ANDROID_RES, 'drawable', 'ic_launcher_foreground.xml'),
        (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<!-- 由 apps/android/icon/gen-icons.py 从 source.png 生成，请勿手改。\n'
            f'     墨滴手柄 v3：墨滴高 {ADAPTIVE_GLYPH_DP}dp，最远点距中心 {ADAPTIVE_GLYPH_DP * GLYPH_RADIUS:.1f}dp\n'
            '     （< 安全圆半径 33dp），任何蒙版（圆/方/圆角方）下都完整；十字键与按钮靠 evenOdd 挖空。 -->\n'
            '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
            '    android:width="108dp"\n'
            '    android:height="108dp"\n'
            '    android:viewportWidth="108"\n'
            '    android:viewportHeight="108">\n'
            '    <path\n'
            '        android:fillColor="#FF000000"\n'
            '        android:fillType="evenOdd"\n'
            f'        android:pathData="{svg_path(ADAPTIVE_GLYPH_DP, 54, 54)}" />\n'
            '</vector>\n'
        ).encode(),
    )

    # 5) adaptive icon 背景：白纸满幅
    emit(
        os.path.join(ANDROID_RES, 'drawable', 'ic_launcher_background.xml'),
        (
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<!-- 由 apps/android/icon/gen-icons.py 生成，请勿手改：白纸满幅 -->\n'
            '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
            '    android:width="108dp"\n'
            '    android:height="108dp"\n'
            '    android:viewportWidth="108"\n'
            '    android:viewportHeight="108">\n'
            '    <path\n'
            '        android:fillColor="#FFFFFFFF"\n'
            '        android:pathData="M0,0h108v108h-108z" />\n'
            '</vector>\n'
        ).encode(),
    )

    # 6) adaptive icon 描述（方/圆两个入口同款）
    for name in ('ic_launcher', 'ic_launcher_round'):
        emit(
            os.path.join(ANDROID_RES, 'mipmap-anydpi-v26', f'{name}.xml'),
            (
                '<?xml version="1.0" encoding="utf-8"?>\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@drawable/ic_launcher_background" />\n'
                '    <foreground android:drawable="@drawable/ic_launcher_foreground" />\n'
                '</adaptive-icon>\n'
            ).encode(),
        )

    status = 0
    if '--no-verify' not in sys.argv:
        status = verify(src)

    print(f'[gen-icons] 已生成 {len(written)} 个文件：')
    for path, size in written:
        print(f'  {path}  {size}B')
    return status


def verify(src: Image.Image) -> int:
    bad = 0
    print('[gen-icons] PNG 像素自检（只允许纯黑 / 纯白 / 全透明）：')
    for path, _ in written:
        if not path.endswith('.png'):
            continue
        img = Image.open(os.path.join(ROOT, path)).convert('RGBA')
        raw = img.tobytes()
        pixels = (raw[i:i + 4] for i in range(0, len(raw), 4))
        gray = sum(1 for r, g, b, a in pixels if 0 < a < 255 or (a == 255 and (r, g, b) not in ((0, 0, 0), (255, 255, 255))))
        if gray:
            bad += 1
        print(f'  {path:<62} {img.width:>4}px  非 1-bit 像素 {gray}')

    # 矢量 vs 源图：把矢量画回源图尺寸，比较黑像素集合的 IoU
    ref = src.point(lambda v: 0 if v < 128 else 255)
    vec = rasterize_vector(src.width, SRC_H, (SRC_CX, SRC_CY))
    a = [v == 0 for v in ref.tobytes()]
    b = [v == 0 for v in vec.convert('L').tobytes()]
    inter = sum(1 for x, y in zip(a, b) if x and y)
    union = sum(1 for x, y in zip(a, b) if x or y)
    iou = inter / union
    ok = iou >= 0.98  # ≈ 全轮廓平均边缘误差 ≤ 1px（1254px 画布上）
    print(f'[gen-icons] 矢量与 source.png 的重合度（IoU）{iou:.4f}（要求 ≥ 0.98）{"✓" if ok else "✗"}')
    if bad:
        print(f'[gen-icons] ✗ {bad} 张 PNG 含灰阶/半透明像素')
    else:
        print('[gen-icons] ✓ 全部 PNG 都是 1-bit')
    return 0 if ok and not bad else 1


if __name__ == '__main__':
    sys.exit(main())
