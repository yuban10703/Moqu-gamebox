#!/usr/bin/env python3
"""
真机逐款游戏审计：开局渲染、棋盘尺寸、按钮是否越界、有无缺键。
用法: python3 tools/device/audit-games.py <devtools-ws-file> [难度| -] <adb-serial>
"""
import json, subprocess, sys, time

WS = open(sys.argv[1]).read().strip()
EVAL = '/root/墨水屏游戏/tools/scripts/devtools-eval.py'
DIFFICULTY = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != '-' else None
ADB = '/root/墨水屏游戏/.toolchain/android-sdk/platform-tools/adb'
SERIAL = sys.argv[3] if len(sys.argv) > 3 else None

def wake():
    """设备息屏后 WebView 会停止渲染，测量值会变成陈旧数据 —— 每次测量前唤醒"""
    if SERIAL:
        subprocess.run([ADB, '-s', SERIAL, 'shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'],
                       capture_output=True, timeout=30)
        time.sleep(0.6)

def js(e):
    out = subprocess.run(['python3', EVAL, WS, e], capture_output=True, text=True, timeout=60)
    return out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ''

def click(label):
    return js(f"(()=>{{const b=[...document.querySelectorAll('button')].find(x=>((x.getAttribute('aria-label')||x.innerText||'').replace(/\\s+/g,' ').trim())==='{label}'); if(!b) return 'no'; b.click(); return 'ok'}})()")

# 先确保回到首页：反复点「返回」直到出现游戏列表（最多 4 次）
for _ in range(5):
    raw = js("JSON.stringify([...document.querySelectorAll('.eink-tile__title')].map(e=>e.textContent.trim()))")
    try:
        names = json.loads(raw)
    except Exception:
        names = []
    if names:
        break
    js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||x.innerText||'').includes('返回')); if(b){b.click(); return 'ok'} return 'noback'})()")
    time.sleep(2)
names = names if isinstance(names, list) else []
print(f"  游戏: {names}")
def tiles():
    try:
        return json.loads(js("JSON.stringify([...document.querySelectorAll('.eink-tile__title')].map(e=>e.textContent.trim()))"))
    except Exception:
        return []

def ensure_library():
    """从游戏页返回是回到详情页，需要再退一层才到首页 —— 反复退直到看见游戏列表"""
    for _ in range(5):
        if tiles():
            return True
        js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||x.innerText||'').includes('返回')); if(b){b.click(); return 'ok'} return 'noback'})()")
        time.sleep(2)
        wake()
    return bool(tiles())

for name in names:
    wake()
    ensure_library()
    js(f"(()=>{{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('{name}')); if(b) b.click(); return 'ok'}})()")
    time.sleep(2.5)
    if DIFFICULTY:
        click(DIFFICULTY)
        time.sleep(1)
    js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('继续')||(x.innerText||'').includes('开始新游戏')); if(b) b.click(); return 'ok'})()")
    time.sleep(1.5)
    js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('替换并开始')); if(b) b.click(); return 'ok'})()")
    time.sleep(3)
    info = js("""JSON.stringify((()=>{const vh=innerHeight,vw=innerWidth;const cell=document.querySelector('[role=gridcell]');const cr=cell?cell.getBoundingClientRect():null;const board=document.querySelector('.eink-board');const br=board?board.getBoundingClientRect():null;const cells=document.querySelectorAll('[role=gridcell]').length;const off=[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().bottom>vh+1).map(b=>(b.getAttribute('aria-label')||b.innerText||'').trim().slice(0,8));const txt=document.body.innerText;const stats=[...document.querySelectorAll('.eink-stats__item')].map(e=>e.textContent);return {视口:vw+'x'+vh,格子数:cells,格子:cr?Math.round(cr.width):null,棋盘:br?[Math.round(br.width),Math.round(br.height)]:null,屏外:off,缺键:txt.includes('⟦'),标题:document.querySelector('.eink-topbar__title h1')?.textContent,统计:stats}})())""")
    print(f"  {name}: {info}")
