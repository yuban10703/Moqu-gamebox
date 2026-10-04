#!/usr/bin/env python3
"""
真机测量单个游戏的棋盘几何：区域/棋盘尺寸、格子大小、四边裁切量。
用法: python3 tools/device/measure-board.py <devtools-ws-file> <adb-serial> <游戏名>
"""
import json, os, shutil, subprocess, sys, time
WS = open(sys.argv[1]).read().strip(); SERIAL = sys.argv[2]; GAME = sys.argv[3]
# 路径相对仓库根目录推算（与 verify-device.sh 同一口径），不再写死某台机器上的绝对路径
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EVAL = os.path.join(ROOT, 'tools', 'scripts', 'devtools-eval.py')
# 优先用 setup-android-toolchain.sh 装进 .toolchain 的 adb；没有就退回 PATH 里的 adb
ADB = os.path.join(ROOT, '.toolchain', 'android-sdk', 'platform-tools', 'adb')
if not os.access(ADB, os.X_OK):
    ADB = shutil.which('adb') or ADB
def js(e):
    o = subprocess.run([sys.executable,EVAL,WS,e],capture_output=True,text=True,timeout=60)
    return o.stdout.strip().splitlines()[-1] if o.stdout.strip() else ''
def wake():
    subprocess.run([ADB,'-s',SERIAL,'shell','input','keyevent','KEYCODE_WAKEUP'],capture_output=True,timeout=30); time.sleep(0.5)
def click(sub):
    return js(f"(()=>{{const b=[...document.querySelectorAll('button')].find(x=>((x.getAttribute('aria-label')||x.innerText||'').replace(/\\s+/g,' ').includes('{sub}'))); if(!b) return 'no'; b.click(); return 'ok'}})()")
wake()
# 回到首页
for _ in range(5):
    if 'eink-tile' in js("document.querySelectorAll('.eink-tile').length+' tiles'"): break
    click('返回'); time.sleep(2); wake()
click(GAME); time.sleep(3)
if '开始新游戏' in js('document.body.innerText'):
    click('开始新游戏'); time.sleep(1.5)
click('继续'); time.sleep(1.5)
click('替换并开始'); time.sleep(4); wake()
print(json.dumps(json.loads(js("""JSON.stringify((()=>{const area=document.querySelector('.eink-board-area'); const board=document.querySelector('.eink-board'); if(!area||!board) return {err:'missing'}; const ar=area.getBoundingClientRect(), br=board.getBoundingClientRect(); const cs=getComputedStyle(board); return {区域:[Math.round(ar.width),Math.round(ar.height)], 棋盘:[Math.round(br.width),Math.round(br.height)], 格子:Math.round(document.querySelector('.eink-board__cell').getBoundingClientRect().width), 外框:cs.borderTopWidth, 上被裁:Math.round(ar.top-br.top), 下被裁:Math.round(br.bottom-ar.bottom), 左被裁:Math.round(ar.left-br.left), 右被裁:Math.round(br.right-ar.right), 页脚底:Math.round(document.querySelector('.eink-footer')?.getBoundingClientRect().bottom ?? -1), 视口:innerHeight}})())""")), ensure_ascii=False))
