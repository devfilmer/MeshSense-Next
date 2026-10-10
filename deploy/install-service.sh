#!/usr/bin/env bash
# Install (or update) MeshSense Next as a systemd service that starts at boot.
#
# On the machine that runs MeshSense Next, after `api` and `ui` are built (see README):
#   sudo deploy/install-service.sh [user]
#
# The service runs api/dist/index.cjs with the system `node` as the given user
# (default: the user who ran sudo) and keeps its data in /var/lib/meshsense-next.
# Running the script again after a rebuild re-installs the unit and restarts the service.
set -euo pipefail

unit=meshsense-next
if [ "$(id -u)" != 0 ]; then
  echo "Run this with sudo: sudo $0 [user]" >&2
  exit 1
fi

repo=$(cd "$(dirname "$0")/.." && pwd)
user=${1:-${SUDO_USER:-}}
if [ -z "$user" ] || ! id "$user" >/dev/null 2>&1; then
  echo "Usage: sudo $0 <user that should run the service>" >&2
  exit 1
fi

node=$(command -v node || true)
if [ -z "$node" ]; then
  # sudo's PATH may not include a per-user node (nvm, volta); ask the user's login shell
  node=$(sudo -u "$user" -i sh -c 'command -v node' 2>/dev/null || true)
fi
if [ -z "$node" ] || [ ! -x "$node" ]; then
  echo "node was not found; install Node.js (18 or newer) first" >&2
  exit 1
fi

if [ ! -f "$repo/api/dist/index.cjs" ]; then
  echo "$repo/api/dist/index.cjs is missing; run 'npm run build' in api first (see README)" >&2
  exit 1
fi
if [ ! -d "$repo/api/dist/static" ]; then
  echo "$repo/api/dist/static is missing; run 'npm run build' in ui first (see README)" >&2
  exit 1
fi

case "$repo$node" in
  *[\|\&]*) echo "Paths containing | or & are not supported by this script" >&2; exit 1 ;;
esac

sed -e "s|__USER__|$user|g" -e "s|__REPO__|$repo|g" -e "s|__NODE__|$node|g" \
  "$repo/deploy/$unit.service" > "/etc/systemd/system/$unit.service"
systemctl daemon-reload
systemctl enable "$unit.service" >/dev/null
systemctl restart "$unit.service"

ok=0
for _ in $(seq 30); do
  if systemctl is-failed --quiet "$unit.service"; then break; fi
  if curl -fsS http://127.0.0.1:5920/state >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ] || ! systemctl is-active --quiet "$unit.service"; then
  echo "$unit did not start serving on port 5920; recent log:" >&2
  journalctl -u "$unit" -n 50 --no-pager >&2 || true
  exit 1
fi

echo "$unit is running as $user and enabled at boot."
echo "  Web UI:   http://$(hostname):5920"
echo "  Data:     /var/lib/meshsense-next/meshsense"
echo "  Logs:     journalctl -u $unit -f"
echo "  Control:  sudo systemctl {status|restart|stop|disable} $unit"
