#!/usr/bin/env bash
#
# protohub 一键启动
#
#   ./start.sh              数据仓库默认放在 ~/protohub-repo
#   ./start.sh ~/我的原型    指定仓库目录
#   ./start.sh --port 8000  换端口（预览端口自动用 端口+1）
#   ./start.sh --lan        本次开放局域网访问（同事可读，写仍只限本机）
#
# 做四件事：检查环境 → 构建工作台 → 首次运行时初始化示例仓库 → 起服务并开浏览器
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

# ---------- 输出 ----------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; N=$'\033[0m'
else
  B=''; DIM=''; G=''; Y=''; R=''; C=''; N=''
fi
step() { echo; echo "${B}▸ $*${N}"; }
ok()   { echo "  ${G}✓${N} $*"; }
warn() { echo "  ${Y}!${N} $*"; }
die()  { echo; echo "  ${R}✗${N} $*" >&2; echo; exit 1; }

# ---------- 参数 ----------
REPO=""
PORT=""
NO_OPEN=""
LAN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --no-open) NO_OPEN=1; shift ;;
    --lan) LAN=1; shift ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) REPO="$1"; shift ;;
  esac
done
REPO="${REPO:-$HOME/protohub-repo}"

echo
echo "${B}protohub${N} ${DIM}· 本地原型版本库${N}"

# ---------- 1. 环境检查 ----------
step "1/4 检查运行环境"

command -v node >/dev/null 2>&1 || die "没有找到 node。请先安装 Node.js 18.17 以上：https://nodejs.org"

NODE_RAW="$(node -v)"                 # v22.11.0
NODE_MAJOR="${NODE_RAW#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
NODE_MINOR="$(echo "${NODE_RAW#v}" | cut -d. -f2)"

# 需要 18.17+：parseArgs 在 18.3 才稳定，fetch 在 18 才默认开启
if [ "$NODE_MAJOR" -lt 18 ] || { [ "$NODE_MAJOR" -eq 18 ] && [ "$NODE_MINOR" -lt 17 ]; }; then
  die "Node $NODE_RAW 版本过低，需要 18.17 以上"
fi
ok "Node $NODE_RAW"

command -v npm >/dev/null 2>&1 || die "没有找到 npm（通常随 Node 一起安装）"
ok "npm $(npm -v)"

if command -v git >/dev/null 2>&1; then
  ok "git $(git --version | awk '{print $3}')"
else
  warn "没有 git。protohub 本身能用，但团队协作依赖 Git 共享数据目录"
fi

# ---------- 2. 构建浏览器工作台 ----------
step "2/4 准备浏览器工作台"

if [ -f web/dist/index.html ] && [ -z "${REBUILD:-}" ]; then
  ok "工作台已构建 ${DIM}(设 REBUILD=1 可强制重建)${N}"
else
  echo "  首次运行需要构建，约 1–2 分钟…"
  ( cd web && npm install --no-fund --no-audit --loglevel=error ) || die "依赖安装失败，检查网络或 npm 源"
  ( cd web && npm run build --silent ) || die "工作台构建失败"
  ok "工作台构建完成"
fi

# ---------- 3. 仓库 ----------
step "3/4 准备数据仓库"

if [ -f "$REPO/protohub.json" ]; then
  ok "使用已有仓库 ${C}$REPO${N}"
else
  mkdir -p "$REPO"
  node bin/protohub.js init "$REPO" >/dev/null
  ok "已创建仓库 ${C}$REPO${N}"

  # 造一个能立刻看见效果的示例项目 —— 空仓库打开工作台只有一片空白，
  # 用户没法判断东西到底跑起来没有
  SAMPLE="$(mktemp -d)"
  cat > "$SAMPLE/订单中心_v1.0.html" <<'PROTO'
<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>订单列表 v1.0</title>
<style>body{font-family:-apple-system,'PingFang SC',sans-serif;margin:0;background:#f5f5f5;font-size:13px}
.hd{background:#fff;padding:14px 18px;border-bottom:1px solid #f0f0f0;font-weight:600;font-size:15px}
.wrap{padding:16px}.panel{background:#fff;border-radius:8px;padding:14px 16px;margin-bottom:12px;border:1px solid #f0f0f0}
.f{height:30px;border:1px solid #d9d9d9;border-radius:6px;padding:0 10px;display:inline-flex;align-items:center;color:#8c8c8c}
.b{height:30px;border-radius:6px;padding:0 14px;display:inline-flex;align-items:center;background:#1677ff;color:#fff;margin-left:8px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:12.5px}
th{background:#fafafa;text-align:left;padding:10px 12px;border-bottom:1px solid #f0f0f0}
td{padding:11px 12px;border-bottom:1px solid #f0f0f0;color:#595959}</style></head>
<body><div class="hd">订单中心 · 订单列表 <span style="font-size:11px;color:#8c8c8c">v1.0 示例原型</span></div>
<div class="wrap"><div class="panel"><span class="f">订单号</span><span class="b">查询</span></div>
<table><tr><th>订单号</th><th>客户</th><th>金额</th><th>状态</th></tr>
<tr><td>SO20260814001</td><td>深圳云途科技</td><td>¥ 12,480.00</td><td>待付款</td></tr>
<tr><td>SO20260813047</td><td>杭州星野贸易</td><td>¥ 3,260.00</td><td>待发货</td></tr>
<tr><td>SO20260813022</td><td>成都锦程供应链</td><td>¥ 45,900.00</td><td>已完成</td></tr></table></div></body></html>
PROTO

  cat > "$SAMPLE/订单中心_v1.1.html" <<'PROTO'
<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>订单列表 v1.1</title>
<style>body{font-family:-apple-system,'PingFang SC',sans-serif;margin:0;background:#f5f5f5;font-size:13px}
.hd{background:#fff;padding:14px 18px;border-bottom:1px solid #f0f0f0;font-weight:600;font-size:15px}
.wrap{padding:16px}.panel{background:#fff;border-radius:8px;padding:14px 16px;margin-bottom:12px;border:1px solid #f0f0f0}
.f{height:30px;border:1px solid #d9d9d9;border-radius:6px;padding:0 10px;display:inline-flex;align-items:center;color:#8c8c8c;margin-right:8px}
.b{height:30px;border-radius:6px;padding:0 14px;display:inline-flex;align-items:center;background:#1677ff;color:#fff}
.b2{height:30px;border-radius:6px;padding:0 14px;display:inline-flex;align-items:center;background:#fff;border:1px solid #d9d9d9;margin-bottom:12px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;font-size:12.5px}
th{background:#fafafa;text-align:left;padding:10px 12px;border-bottom:1px solid #f0f0f0}
td{padding:11px 12px;border-bottom:1px solid #f0f0f0;color:#595959}</style></head>
<body><div class="hd">订单中心 · 订单列表 <span style="font-size:11px;color:#8c8c8c">v1.1 示例原型</span></div>
<div class="wrap"><div class="panel">
<span class="f">订单号</span><span class="f">订单状态 ▾</span><span class="f">下单时间 ▾</span><span class="b">查询</span></div>
<div class="b2">批量关闭</div>
<table><tr><th style="width:32px">☐</th><th>订单号</th><th>客户</th><th>金额</th><th>状态</th></tr>
<tr><td>☐</td><td>SO20260814001</td><td>深圳云途科技</td><td>¥ 12,480.00</td><td>待付款</td></tr>
<tr><td>☐</td><td>SO20260813047</td><td>杭州星野贸易</td><td>¥ 3,260.00</td><td>待发货</td></tr>
<tr><td>☐</td><td>SO20260813022</td><td>成都锦程供应链</td><td>¥ 45,900.00</td><td>已完成</td></tr></table></div></body></html>
PROTO

  export PROTOHUB_REPO="$REPO"
  node bin/protohub.js new "订单中心重构" --code order-center --desc "示例项目，可随时删除" >/dev/null
  node bin/protohub.js add "$SAMPLE/订单中心_v1.0.html" -p order-center -n v1.0 -t "首版原型" >/dev/null
  node bin/protohub.js baseline order-center v1.0 >/dev/null
  node bin/protohub.js add "$SAMPLE/订单中心_v1.1.html" -p order-center -n v1.1 -t "批量操作首版" \
    -m "新增:订单列表-工具栏:新增「批量关闭」按钮，选中行后可用:REQ-0275" \
    -m "修改:订单列表-筛选区:筛选项由 1 个扩展为 3 个" \
    --req "REQ-0275:订单批量关闭:https://example.com/req/REQ-0275" >/dev/null
  node bin/protohub.js spec order-center v1.1 -f /dev/stdin >/dev/null <<'SPEC'
# 批量操作首版 · 规格说明

> 这是示例规格书，用来演示「左原型 / 右文档」的对照阅读。可以直接改，或整个删掉。

## 1. 批量关闭

选中订单行后「批量关闭」按钮可用；未选中时置灰，hover 提示「请先选择要关闭的订单」。

| 场景 | 处理 |
|---|---|
| 已发货订单被选中 | 该行跳过，结果里单独列出原因 |
| 全部失败 | 提示「0 条成功」，不刷新列表 |
| 部分成功 | 提示成功/失败条数，列表刷新 |

## 2. 待确认

- 单次批量上限是多少？**待确认**，需研发评估接口耗时。
SPEC
  rm -rf "$SAMPLE"
  unset PROTOHUB_REPO
  ok "已生成示例项目 ${C}order-center${N}（2 个版本，含变更日志与规格书）"
  echo "    ${DIM}不需要的话：rm -rf \"$REPO/projects/order-center\"${N}"
fi

# ---------- 4. 启动 ----------
step "4/4 启动本地服务"

cd "$REPO"
PORT_ARG=""
[ -n "$PORT" ] && PORT_ARG="--port $PORT"
SHOW_PORT="${PORT:-7788}"
SHOW_PREVIEW=$(( SHOW_PORT + 1 ))
[ -z "$PORT" ] && SHOW_PREVIEW=7789

echo "  工作台   ${C}http://localhost:${SHOW_PORT}${N}"
echo "  预览服务 ${DIM}http://localhost:${SHOW_PREVIEW}  (原型沙箱，独立端口以隔离脚本)${N}"
echo "  数据目录 ${DIM}${REPO}${N}"
echo
echo "  ${DIM}常用命令（在 ${REPO} 目录下执行）：${N}"
echo "  ${DIM}  node ${HERE}/bin/protohub.js ls${N}"
echo "  ${DIM}  node ${HERE}/bin/protohub.js add <文件.html> -t \"标题\"${N}"
echo
echo "  ${DIM}想让 protohub 命令全局可用：cd ${HERE} && npm link${N}"
echo
echo "  ${DIM}Ctrl+C 停止${N}"
echo

OPEN_ARG=""
[ -n "$NO_OPEN" ] && OPEN_ARG="--no-open"
LAN_ARG=""
[ -n "$LAN" ] && LAN_ARG="--lan"
# exec 让 Ctrl+C 直接送到 node 进程，退出码也能正确传出去
exec node "$HERE/bin/protohub.js" open $PORT_ARG $OPEN_ARG $LAN_ARG
