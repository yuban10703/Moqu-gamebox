#!/usr/bin/env bash
#
# 把**纯代码**同步到公开仓库。设计要点（按用户要求）：
#
#   1. **不用 force-push**：只做追加式推送（`git push public <sha>:main`），
#      所以公开仓库的历史只会往前长，被外部改动过就报错而不是覆盖。
#   2. **首次不搬历史**：公开仓库里第一条提交是一个"初始快照"（当前 tip 的代码树）。
#   3. **之后按标题同步**：私有仓库每多一个提交，就在公开仓库追加一个提交，
#      **只取标题**（`%s`），不带正文、不带作者信息（统一用 bot，避免把协作者的邮箱带到公开仓库）。
#
# 不带过去的内容：`docs/` 整个目录、所有 `*.md`、以及同步机制自身（本脚本 + 工作流）。
# 续传依据：每条公开提交的正文里有一行 `Private-Rev: <私有 sha>`；下次据此只发新提交。
# 只改文档的提交过滤后内容不变 → 直接跳过，不会在公开仓库里留空提交。
#
# 用法：sync-public.sh <public-repo-url>（URL 里可带 token；需要私有仓库的完整历史）
set -euo pipefail

PUBLIC_URL="${1:?用法: tools/scripts/sync-public.sh <public-repo-url>}"
BOT_NAME='eink-gamebox sync'
BOT_EMAIL='actions@users.noreply.github.com'
# 不该公开的路径（目录或文件）；与工作流的 paths-ignore、自检正则保持一致
EXCLUDE_PATHS=('docs' '.github/workflows/sync-public.yml' 'tools/scripts/sync-public.sh')

log() { printf '%s\n' "$*"; }

# 从工作树里删掉不该公开的东西（随后统一 git add -A 把它们从索引里也去掉）
strip_private() {
  find . -type f -name '*.md' -not -path './.git/*' -delete
  for path in "${EXCLUDE_PATHS[@]}"; do rm -rf "$path"; done
}

# 自检：暂存后的索引里不许有 docs/ 或 *.md（顺序很关键：必须先 git add -A 再查，否则查到的是旧索引）
assert_no_docs() {
  local leftovers
  # core.quotePath=false：默认 git 会给非 ASCII 路径加引号，正则会因此抓不到残留
  leftovers="$(git -c core.quotePath=false ls-files | grep -E '(^docs/|\.md$)' || true)"
  if [ -n "$leftovers" ]; then
    log "::error::快照里仍有文档残留，请检查 EXCLUDE_PATHS 与 *.md 规则："
    log "$leftovers"
    exit 1
  fi
}

# 把某个私有提交的代码树做成公开仓库上的一条提交
# 用法：make_commit <私有 sha> <标题> <父提交 sha（首次留空）>
# 内容与父提交完全一样（例如只改了文档）时返回 1，让调用方跳过
make_commit() {
  local sha="$1" title="$2" parent="${3:-}" tree args
  # -f：上一次 strip_private 删掉的文件还在工作树/索引里，不加 -f 会被 git 拒绝检出
  git checkout -q -f --detach "$sha" || { log "::warning::无法检出 ${sha:0:7}，跳过"; return 1; }
  strip_private
  git add -A
  assert_no_docs
  tree="$(git write-tree)"
  [ -n "$tree" ] || { log "::error::写不出树对象（检出状态异常）"; exit 1; }
  if [ -n "$parent" ] && [ "$(git rev-parse --verify --quiet "$parent^{tree}" || true)" = "$tree" ]; then
    return 1
  fi
  args=(-m "$title" -m "Private-Rev: $sha")
  [ -n "$parent" ] && args+=(-p "$parent")
  git -c user.name="$BOT_NAME" -c user.email="$BOT_EMAIL" commit-tree "$tree" "${args[@]}"
}

# ── 接上公开仓库，读回上次同步到哪 ───────────────────────────────────────────
git remote remove public 2>/dev/null || true
git remote add public "$PUBLIC_URL"
git fetch -q public main 2>/dev/null || true
# --verify --quiet：ref 不存在时**什么都不输出**（直接 rev-parse 会把参数原样打印出来，
# 于是 PUBLIC_HEAD 会变成字符串 "refs/remotes/public/main"，后面当父提交用就炸了）
PUBLIC_HEAD="$(git rev-parse --verify --quiet refs/remotes/public/main || true)"
# 扫**整条**公开历史找最后一条 trailer：公开仓库里混进外部提交（没有 trailer）时，
# 只看 tip 会误判成"首次同步"，把之前同步过的提交又当成快照重发一遍。
SYNCED="$(git log --format=%B refs/remotes/public/main 2>/dev/null | sed -n 's/^Private-Rev: //p' | head -1 || true)"

TOTAL_FILES="$(git -c core.quotePath=false ls-files | wc -l | tr -d ' ')"
NEW_HEAD="$PUBLIC_HEAD"
PUBLISHED=0

if [ -z "$SYNCED" ] || ! git cat-file -e "${SYNCED}^{commit}" 2>/dev/null; then
  # ── 首次（或公开仓库被重置过）：只发一条初始快照 ──────────────────────────
  TIP="$(git rev-parse HEAD)"
  TITLE="init: 代码快照（对应私有 ${TIP:0:7}）"
  log "[首次] 把当前代码压成一个初始快照提交：$TITLE"
  NEW_HEAD="$(make_commit "$TIP" "$TITLE" "$PUBLIC_HEAD")" || { log "内容与公开仓库当前状态一致，无需同步"; exit 0; }
  PUBLISHED=1
elif ! git merge-base --is-ancestor "$SYNCED" HEAD 2>/dev/null; then
  # ── 私有仓库重写过历史：追加一条全量快照，仍然不 force-push ────────────────
  TIP="$(git rev-parse HEAD)"
  TITLE="$(git log -1 --format=%s "$TIP")"
  log "[历史已重写] 上次同步的 $SYNCED 不在当前历史里 → 追加一条全量快照提交"
  NEW_HEAD="$(make_commit "$TIP" "$TITLE" "$PUBLIC_HEAD")" || { log "内容与公开仓库当前状态一致，无需同步"; exit 0; }
  PUBLISHED=1
else
  # ── 常规：把上次同步之后的新提交**逐个按标题**重放 ─────────────────────────
  RANGE="$SYNCED..HEAD"
  COUNT="$(git rev-list --count "$RANGE")"
  if [ "$COUNT" = "0" ]; then
    log "已是最新（上次同步：${SYNCED:0:7}）"
    exit 0
  fi
  log "[增量] $COUNT 个新提交，逐个按标题重放："
  while IFS=$'\t' read -r sha subject; do
    [ -n "$sha" ] || continue
    # 注意：不能用 `if NEW_HEAD="$(...)"; then` —— 跳过时函数返回 1 但赋值照样发生，
    # NEW_HEAD 会被清空，推送就变成"删除远端分支"（实测被远端拒绝）。
    if next_head="$(make_commit "$sha" "$subject" "$NEW_HEAD")"; then
      NEW_HEAD="$next_head"
      PUBLISHED=$((PUBLISHED + 1))
      log "  + ${sha:0:7} $subject"
    else
      log "  · ${sha:0:7} 跳过（过滤文档后内容没变）$subject"
    fi
  done < <(git log --reverse --format='%H%x09%s' "$RANGE")
fi

if [ "$PUBLISHED" = "0" ] || [ "$NEW_HEAD" = "$PUBLIC_HEAD" ]; then
  log "没有需要推送的提交"
  exit 0
fi

# ── 追加式推送（**不用** force）：成功即快进，失败说明公开仓库被改动过 ────────
log "推送 $PUBLISHED 个提交到公开仓库（快照文件数：$(git -c core.quotePath=false ls-tree -r --name-only "$NEW_HEAD" | wc -l | tr -d ' ')，私有仓库共 $TOTAL_FILES 个文件）"
# 源是裸 sha，目标必须写完整 refname（refs/heads/main），否则 git 会拒绝
if ! git push -q public "$NEW_HEAD:refs/heads/main"; then
  log "::error::推送失败（非快进）。本流程**不使用 force-push**："
  log "  公开仓库大概被外部改过。请把它恢复成上一次同步的状态（或删库重建）后再跑。"
  exit 1
fi
log "已同步到公开仓库：$(git rev-list --count "$NEW_HEAD") 个提交"
