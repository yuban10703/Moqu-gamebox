#!/usr/bin/env python3
"""
真机逐款开局并截图到 docs/screens/。
用法: python3 tools/device/shot-games.py <devtools-ws-file> <adb-serial>
"""
import json, subprocess, sys, time
WS = open(sys.argv[1]).read().strip(); SERIAL = sys.argv[2]
EVAL = '/root/墨水屏游戏/tools/scripts/devtools-eval.py'
ADB = '/root/墨水屏游戏/.toolchain/android-sdk/platform-tools/adb'
def js(e):
    out = subprocess.run(['python3', EVAL, WS, e], capture_output=True, text=True, timeout=60)
    return out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ''
def wake():
    subprocess.run([ADB,'-s',SERIAL,'shell','input','keyevent','KEYCODE_WAKEUP'], capture_output=True, timeout=30); time.sleep(0.5)
def tiles():
    try: return json.loads(js("JSON.stringify([...document.querySelectorAll('.eink-tile__title')].map(e=>e.textContent.trim()))"))
    except Exception: return []
def ensure_library():
    for _ in range(5):
        if tiles(): return
        js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||x.innerText||'').includes('返回')); if(b) b.click(); return 'ok'})()")
        time.sleep(2); wake()
def shot(tag):
    subprocess.run([ADB,'-s',SERIAL,'shell','screencap -p /sdcard/g.png'], capture_output=True, timeout=60)
    subprocess.run([ADB,'-s',SERIAL,'pull','/sdcard/g.png',f'/root/墨水屏游戏/docs/screens/game-{tag}.png'], capture_output=True, timeout=60)
    print(f'  已截图 {tag}')
ensure_library()
for name in tiles():
    ensure_library()
    js(f"(()=>{{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('{name}')); b?.click(); return 'ok'}})()"); time.sleep(2.5)
    js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('继续')||(x.innerText||'').includes('开始新游戏')); b?.click(); return 'ok'}})()"); time.sleep(1.5)
    js("(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').includes('替换并开始')); b?.click(); return 'ok'}})()"); time.sleep(3)
    wake(); shot(name)
