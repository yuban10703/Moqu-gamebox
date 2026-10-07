/**
 * 极简 GIF89a 编码器（只服务本项目：1-bit 黑白调色板 + 逐帧时长）。
 *
 * 为什么自己写：Playwright 自带的 ffmpeg 是裁剪构建（`--disable-everything`），
 * 只有 webm/image2 封装器，**没有 GIF 封装器**，环境里也没有 imagemagick / gifsicle / PIL。
 * 而本项目要的正是最窄的一条路径：两色调色板、每帧一个时长、循环播放。
 *
 * LZW 的位序与「码长增长时机」严格照抄经典 GIFCOMPR 实现（gif.js / jsgif 同源），
 * 不做"看起来更合理"的改动 —— 解码器是照着那份实现写的，差一个码就会整帧花掉。
 * 正确性由 render.mjs 的往返校验保证：编出来之后用浏览器的 ImageDecoder 解回逐帧像素，
 * 与源帧逐像素比对（见 scenes.js 的 verify）。
 */
;(function (root) {
  'use strict'

  /** GIF 变体的 LZW：initBits=2 时 Clear=4 / EOI=5 / 首个可用码=6 / 起始码长 3 位 */
  function lzwEncode(pixels, initBits) {
    const ClearCode = 1 << initBits
    const EOFCode = ClearCode + 1
    const maxbits = 12
    const maxmaxcode = 1 << maxbits
    let nBits = initBits + 1
    let maxcode = (1 << nBits) - 1
    let freeEnt = ClearCode + 2
    let clearFlg = false
    const table = new Map()
    const bytes = []
    let acc = 0
    let accBits = 0

    function output(code) {
      acc &= (1 << accBits) - 1
      acc |= code << accBits
      accBits += nBits
      while (accBits >= 8) {
        bytes.push(acc & 0xff)
        acc >>= 8
        accBits -= 8
      }
      // 下一个可用码已经超出当前码长能表达的范围 → 增长码长（时机必须与解码器一致）
      if (freeEnt > maxcode || clearFlg) {
        if (clearFlg) {
          nBits = initBits + 1
          maxcode = (1 << nBits) - 1
          clearFlg = false
        } else {
          nBits++
          maxcode = nBits === maxbits ? maxmaxcode : (1 << nBits) - 1
        }
      }
    }

    output(ClearCode)
    let ent = pixels[0]
    for (let i = 1; i < pixels.length; i++) {
      const c = pixels[i]
      const key = (c << maxbits) + ent
      const hit = table.get(key)
      if (hit !== undefined) {
        ent = hit
        continue
      }
      output(ent)
      ent = c
      if (freeEnt < maxmaxcode) {
        table.set(key, freeEnt++)
      } else {
        // 表满：发 Clear 并重置（顺序与 GIFCOMPR 一致：先重置状态，再 output(ClearCode)）
        table.clear()
        freeEnt = ClearCode + 2
        clearFlg = true
        output(ClearCode)
      }
    }
    output(ent)
    output(EOFCode)
    while (accBits > 0) {
      bytes.push(acc & 0xff)
      acc >>= 8
      accBits -= 8
    }
    return bytes
  }

  /** LZW 数据流切成 ≤255 字节的子块，尾部 0x00 收尾 */
  function subBlocks(bytes) {
    const out = []
    for (let i = 0; i < bytes.length; i += 255) {
      const chunk = bytes.slice(i, i + 255)
      out.push(chunk.length)
      for (const b of chunk) out.push(b)
    }
    out.push(0)
    return out
  }

  /**
   * @param {{width:number,height:number,frames:{pixels:Uint8Array,delayMs:number}[],loop?:number}} spec
   *   pixels：长度 = width×height，0 = 白、1 = 黑（与调色板下标一致）
   */
  function encode(spec) {
    const { width, height, frames, loop = 0 } = spec
    const out = []
    const u8 = (v) => out.push(v & 0xff)
    const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff)
    const ascii = (s) => {
      for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff)
    }

    ascii('GIF89a')
    u16(width)
    u16(height)
    u8(0xf0) // 全局调色板存在 | 色深 8 | 未排序 | 表长 2^(0+1)=2
    u8(0) // 背景色下标 = 白
    u8(0) // 像素宽高比
    u8(255)
    u8(255)
    u8(255) // 0 = 白
    u8(0)
    u8(0)
    u8(0) // 1 = 黑

    // NETSCAPE2.0 循环扩展
    u8(0x21)
    u8(0xff)
    u8(11)
    ascii('NETSCAPE2.0')
    u8(3)
    u8(1)
    u16(loop)
    u8(0)

    for (const f of frames) {
      const delay = Math.max(1, Math.round(f.delayMs / 10)) // GIF 时长单位 = 10ms
      u8(0x21)
      u8(0xf9)
      u8(4)
      u8(0x04) // 处置方式 = 1（保留上一帧），无透明、无用户输入
      u16(delay)
      u8(0)
      u8(0)
      u8(0x2c) // 图像描述符：整幅、无局部调色板、非隔行
      u16(0)
      u16(0)
      u16(width)
      u16(height)
      u8(0)
      u8(2) // LZW 最小码长 = 2
      for (const b of subBlocks(lzwEncode(f.pixels, 2))) u8(b)
    }
    u8(0x3b)
    return new Uint8Array(out)
  }

  root.GIFEncoder = { encode, lzwEncode }
})(typeof window !== 'undefined' ? window : globalThis)
