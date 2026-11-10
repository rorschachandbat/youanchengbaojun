#!/usr/bin/env bash
set -euo pipefail

# 只接收已构建产物，不在服务器安装 npm 依赖或临时编译。
ARCHIVE="${1:?usage: install-server.sh <archive> [control-port] [install-root] [node-bin]}"
CONTROL_PORT="${2:-8080}"
INSTALL_ROOT="${3:-/opt/tyrants}"
NODE_BIN="${4:-/usr/bin/node}"
[[ "$EUID" = 0 ]] || { echo "root required" >&2; exit 1; }
[[ "$CONTROL_PORT" =~ ^[0-9]+$ ]] && (( CONTROL_PORT >= 1024 && CONTROL_PORT <= 65535 )) || exit 1
[[ "$INSTALL_ROOT" =~ ^/opt/[a-zA-Z0-9_-]+$ ]] || { echo "invalid install root" >&2; exit 1; }
[[ "$NODE_BIN" =~ ^/[a-zA-Z0-9_./-]+$ && -x "$NODE_BIN" ]] || { echo "node binary missing" >&2; exit 1; }
[[ "$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])')" -ge 20 ]] || { echo "Node 20+ required" >&2; exit 1; }
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
id tyrants >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin tyrants
install -d -m 0755 "$INSTALL_ROOT/releases" /var/log/tyrants
chown tyrants:tyrants /var/log/tyrants
touch /var/log/tyrants/server.log
chown tyrants:tyrants /var/log/tyrants/server.log
RELEASE="$INSTALL_ROOT/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir "$RELEASE"
tar -xzf "$ARCHIVE" -C "$RELEASE"
test -s "$RELEASE/dist/index.html"
test -s "$RELEASE/server-dist/standalone.mjs"
chmod -R a+rX "$RELEASE"
# 保留旧游戏文件，仅停用占用控制端口的服务，不杀其他项目的 Godot 进程。
systemctl disable --now partygame-director.service 2>/dev/null || true
systemctl stop tyrants.service 2>/dev/null || true
PREVIOUS=""
if [[ -L "$INSTALL_ROOT/current" ]]; then
  CANDIDATE="$(readlink -f "$INSTALL_ROOT/current" 2>/dev/null || true)"
  if [[ -n "$CANDIDATE" && "$CANDIDATE" != "$RELEASE" && -s "$CANDIDATE/server-dist/standalone.mjs" ]]; then
    PREVIOUS="$CANDIDATE"
  fi
fi
ln -sfn "$RELEASE" "$INSTALL_ROOT/current"
if [[ ! -f /etc/tyrants.env ]]; then
  printf 'BIND_HOST=0.0.0.0\nCONTROL_PORT=%s\nMAX_ROOMS=100\nRESERVE_MB=300\nROOM_IDLE_SECONDS=300\nDISCONNECT_SECONDS=120\n' "$CONTROL_PORT" >/etc/tyrants.env
  chmod 0644 /etc/tyrants.env
else
  sed -i "s/^CONTROL_PORT=.*/CONTROL_PORT=$CONTROL_PORT/" /etc/tyrants.env
fi
sed -e "s|/opt/tyrants|$INSTALL_ROOT|g" -e "s|/usr/bin/node|$NODE_BIN|g" \
  "$SCRIPT_DIR/tyrants.service" >/etc/systemd/system/tyrants.service
install -m 0644 "$SCRIPT_DIR/logrotate.tyrants" /etc/logrotate.d/tyrants
systemctl daemon-reload
systemctl enable --now tyrants.service
for attempt in {1..15}; do
  if curl -fsS "http://127.0.0.1:$CONTROL_PORT/api/health"; then
    echo
    echo "Deployed: $RELEASE"
    echo "Previous: ${PREVIOUS:-none}"
    exit 0
  fi
  sleep 1
done
echo "Health check failed; rolling back to previous Tyrants release" >&2
systemctl stop tyrants.service
if [[ -n "$PREVIOUS" && -s "$PREVIOUS/server-dist/standalone.mjs" ]]; then
  ln -sfn "$PREVIOUS" "$INSTALL_ROOT/current"
  systemctl start tyrants.service
fi
tail -n 40 /var/log/tyrants/server.log >&2
exit 1
