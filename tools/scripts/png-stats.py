#!/usr/bin/env python3
"""统计截图里的灰度分布（纯黑 / 纯白 / 中间灰占比）。

**它测不到墨水屏残影，别把它当残影指标用。**
原因：`screencap` 取的是 SurfaceFlinger 合成出来的 framebuffer —— 也就是「系统认为该显示什么」，
而残影是电子墨水面板上颜料未完成翻转的**物理残留**，只存在于面板层。
实测证据：同一屏内容在做完整屏全刷（refreshScreen(GC)）前后，
棋盘区与空白区的字节统计完全一致（57.11/42.63/0.26 与 1.31/98.51/0.17），
而全刷调用确实执行了 —— 截图里根本没有残影的痕迹。

这个工具真正有用的场景：检查**渲染内容本身**是否出现了不该有的灰
（例如 1-bit 模式下误用了灰阶、抗锯齿过重、字体渲染发虚），以及布局/对比度回归。

残影只能靠人眼或**相机拍面板**来评估，见 docs/A06-acceptance.md。

用法：
    python3 tools/scripts/png-stats.py <png> [x y w h]

只支持 8-bit 非隔行 PNG（Android screencap 的输出即为此格式；
注意不要用 `adb exec-out screencap -p`，BOOX 会往前面插一行文字破坏文件头）。
"""
import struct
import sys
import zlib


def read_png(path):
    data = open(path, 'rb').read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise SystemExit(f'{path}: 不是 PNG（可能是 adb exec-out 被插入文字，改用 screencap 写文件再 pull）')
    pos = 8
    width = height = bit_depth = color_type = None
    idat = bytearray()
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        chunk_type = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if chunk_type == b'IHDR':
            width, height, bit_depth, color_type = struct.unpack('>IIBB', chunk[:10])
        elif chunk_type == b'IDAT':
            idat += chunk
        elif chunk_type == b'IEND':
            break
    if bit_depth != 8 or color_type not in (2, 6):
        raise SystemExit(f'不支持的 PNG 格式：bit_depth={bit_depth} color_type={color_type}')
    channels = 3 if color_type == 2 else 4
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out = bytearray(width * height * channels)
    prev = bytearray(stride)
    offset = 0
    for row in range(height):
        filter_type = raw[offset]
        offset += 1
        line = bytearray(raw[offset:offset + stride])
        offset += stride
        if filter_type == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif filter_type == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif filter_type == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif filter_type == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[row * stride:(row + 1) * stride] = line
        prev = line
    return width, height, channels, out


def stats(path, region=None):
    width, height, channels, pixels = read_png(path)
    x, y, w, h = region or (0, 0, width, height)
    x, y = max(0, x), max(0, y)
    w = min(w, width - x)
    h = min(h, height - y)
    black = white = gray = 0
    for row in range(y, y + h):
        base = row * width * channels
        for col in range(x, x + w):
            index = base + col * channels
            r, g, b = pixels[index], pixels[index + 1], pixels[index + 2]
            value = (r + g + b) // 3
            if value <= 8:
                black += 1
            elif value >= 247:
                white += 1
            else:
                gray += 1
    total = w * h or 1
    return {
        'file': path,
        'region': (x, y, w, h),
        'total': total,
        'black': black / total,
        'white': white / total,
        'gray': gray / total,
    }


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    region = tuple(int(v) for v in sys.argv[2:6]) if len(sys.argv) >= 6 else None
    result = stats(sys.argv[1], region)
    print(f"文件: {result['file']}")
    print(f"区域: {result['region']}  共 {result['total']} 像素")
    print(f"  纯黑 {result['black'] * 100:6.2f}%")
    print(f"  纯白 {result['white'] * 100:6.2f}%")
    print(f"  中间灰（抗锯齿/内容本身）{result['gray'] * 100:6.2f}%")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
