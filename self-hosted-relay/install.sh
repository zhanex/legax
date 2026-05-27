#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="legax-relay"
ORIGINAL_ARGS=("$@")
SERVICE_USER="${SERVICE_USER:-legax}"
SERVICE_GROUP="${SERVICE_GROUP:-legax}"
INSTALL_DIR="${INSTALL_DIR:-/opt/legax-relay}"
CONFIG_DIR="${CONFIG_DIR:-/etc/legax-relay}"
DATA_DIR="${DATA_DIR:-/var/lib/legax-relay}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8787}"
SESSION_ID="${SESSION_ID:-default}"
START_SERVICE=1
INSTALL_NODE=1

usage() {
  cat <<'USAGE'
Legax Relay installer

Usage:
  sudo ./install.sh [options]

Options:
  --no-start              Install files but do not start the service
  --no-node-install       Do not install nodejs automatically
  --install-dir PATH      Default: /opt/legax-relay
  --config-dir PATH       Default: /etc/legax-relay
  --data-dir PATH         Default: /var/lib/legax-relay
  --host HOST             Default: 0.0.0.0
  --port PORT             Default: 8787
  --session SESSION_ID    Default: default
  -h, --help              Show help

Environment:
  LEGAX_SECRET       Desktop/agent side secret. Generated if absent.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-start) START_SERVICE=0 ;;
    --no-node-install) INSTALL_NODE=0 ;;
    --install-dir) INSTALL_DIR="$2"; shift ;;
    --config-dir) CONFIG_DIR="$2"; shift ;;
    --data-dir) DATA_DIR="$2"; shift ;;
    --host) HOST="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --session) SESSION_ID="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo -E bash "$0" "${ORIGINAL_ARGS[@]}"
  fi
  echo "Please run as root or install sudo." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_SRC="$SCRIPT_DIR/server.mjs"
LIB_SRC_DIR="$SCRIPT_DIR/lib"
RELAY_CORE_FILES=(
  "relay-server-core.mjs"
  "lps-actions.mjs"
  "telegram-transport.mjs"
  "outbound-transports.mjs"
  "menu-groups.mjs"
  "yaml.mjs"
  "paths.mjs"
)

if [ ! -f "$SERVER_SRC" ]; then
  echo "server.mjs not found next to install.sh" >&2
  exit 1
fi
for core_file in "${RELAY_CORE_FILES[@]}"; do
  if [ ! -f "$LIB_SRC_DIR/$core_file" ]; then
    echo "relay core dependency not found: $LIB_SRC_DIR/$core_file" >&2
    exit 1
  fi
done

log() {
  printf '[legax-relay] %s\n' "$*"
}

detect_pkg_manager() {
  if command -v apt-get >/dev/null 2>&1; then echo apt; return; fi
  if command -v dnf >/dev/null 2>&1; then echo dnf; return; fi
  if command -v yum >/dev/null 2>&1; then echo yum; return; fi
  if command -v zypper >/dev/null 2>&1; then echo zypper; return; fi
  if command -v pacman >/dev/null 2>&1; then echo pacman; return; fi
  if command -v apk >/dev/null 2>&1; then echo apk; return; fi
  echo unknown
}

install_nodejs() {
  if command -v node >/dev/null 2>&1; then
    return
  fi
  if [ "$INSTALL_NODE" -eq 0 ]; then
    echo "node is missing and --no-node-install was set." >&2
    exit 1
  fi

  manager="$(detect_pkg_manager)"
  log "Installing nodejs with package manager: $manager"
  case "$manager" in
    apt)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update
      apt-get install -y nodejs ca-certificates
      ;;
    dnf)
      dnf install -y nodejs ca-certificates
      ;;
    yum)
      yum install -y nodejs ca-certificates
      ;;
    zypper)
      zypper --non-interactive install nodejs ca-certificates
      ;;
    pacman)
      pacman -Sy --noconfirm nodejs ca-certificates
      ;;
    apk)
      apk add --no-cache nodejs ca-certificates
      ;;
    *)
      echo "Unsupported package manager. Install Node.js 18+ and rerun with --no-node-install." >&2
      exit 1
      ;;
  esac
}

check_node_version() {
  if ! command -v node >/dev/null 2>&1; then
    echo "node is not installed." >&2
    exit 1
  fi
  major="$(node -p 'Number(process.versions.node.split(".")[0])')"
  if [ "$major" -lt 18 ]; then
    echo "Node.js 18+ is required. Found: $(node -v)" >&2
    echo "Install a newer Node.js and rerun with --no-node-install." >&2
    exit 1
  fi
}

create_user() {
  if id "$SERVICE_USER" >/dev/null 2>&1; then
    return
  fi
  log "Creating system user: $SERVICE_USER"
  if command -v useradd >/dev/null 2>&1; then
    useradd --system --home-dir "$DATA_DIR" --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  elif command -v adduser >/dev/null 2>&1; then
    addgroup -S "$SERVICE_GROUP" 2>/dev/null || true
    adduser -S -D -H -h "$DATA_DIR" -s /sbin/nologin -G "$SERVICE_GROUP" "$SERVICE_USER"
  else
    echo "Could not create service user; useradd/adduser missing." >&2
    exit 1
  fi
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

install_files() {
  log "Installing relay files"
  install -d -m 0755 "$INSTALL_DIR"
  install -d -m 0755 "$INSTALL_DIR/lib"
  install -d -m 0750 "$CONFIG_DIR"
  install -d -m 0750 "$DATA_DIR"
  install -m 0755 "$SERVER_SRC" "$INSTALL_DIR/server.mjs"
  for core_file in "${RELAY_CORE_FILES[@]}"; do
    install -m 0644 "$LIB_SRC_DIR/$core_file" "$INSTALL_DIR/lib/$core_file"
  done
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$DATA_DIR"

  config_file="$CONFIG_DIR/config.yaml"
  if [ ! -f "$config_file" ]; then
    # Accept SECRET / LEGAX_SECRET at install time as a convenience
    # for CI / scripted installs; the running relay reads only this YAML file.
    DESKTOP_SECRET="${SECRET:-${LEGAX_SECRET:-$(random_secret)}}"
    cat > "$config_file" <<EOF
sessionId: $SESSION_ID
relay:
  host: $HOST
  port: $PORT
  secret: $DESKTOP_SECRET
  storePath: $DATA_DIR/relay-store.json
  maxEventsPerSession: 500
  maxMessagesPerSession: 500
  audit:
    enabled: true
    path: $DATA_DIR/relay-audit.jsonl
    maxTail: 1000
    textPreview: 80
EOF
    chmod 0600 "$config_file"
  else
    log "Keeping existing config file: $config_file"
    DESKTOP_SECRET="$(awk '/^[[:space:]]*secret:/ { print $2; exit }' "$config_file")"
  fi
}

install_systemd_service() {
  unit_path="/etc/systemd/system/$SERVICE_NAME.service"
  log "Installing systemd service: $unit_path"
  sed \
    -e "s|/opt/legax-relay|$INSTALL_DIR|g" \
    -e "s|/etc/legax-relay|$CONFIG_DIR|g" \
    -e "s|/var/lib/legax-relay|$DATA_DIR|g" \
    -e "s|User=legax|User=$SERVICE_USER|g" \
    -e "s|Group=legax|Group=$SERVICE_GROUP|g" \
    "$SCRIPT_DIR/systemd/legax-relay.service" > "$unit_path"
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  if [ "$START_SERVICE" -eq 1 ]; then
    systemctl restart "$SERVICE_NAME"
  fi
}

install_openrc_service() {
  service_path="/etc/init.d/$SERVICE_NAME"
  log "Installing OpenRC service: $service_path"
  sed \
    -e "s|/opt/legax-relay|$INSTALL_DIR|g" \
    -e "s|/etc/legax-relay|$CONFIG_DIR|g" \
    -e "s|/var/lib/legax-relay|$DATA_DIR|g" \
    -e "s|legax:legax|$SERVICE_USER:$SERVICE_GROUP|g" \
    "$SCRIPT_DIR/openrc/legax-relay" > "$service_path"
  chmod 0755 "$service_path"
  rc-update add "$SERVICE_NAME" default
  if [ "$START_SERVICE" -eq 1 ]; then
    rc-service "$SERVICE_NAME" restart
  fi
}

install_service() {
  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    install_systemd_service
    return
  fi
  if command -v rc-service >/dev/null 2>&1 && command -v rc-update >/dev/null 2>&1; then
    install_openrc_service
    return
  fi
  log "No supported service manager detected. Run manually with:"
  echo "  LEGAX_CONFIG=$CONFIG_DIR/config.yaml node $INSTALL_DIR/server.mjs"
}

print_summary() {
  config_file="$CONFIG_DIR/config.yaml"
  host_for_url="$HOST"
  if [ "$host_for_url" = "0.0.0.0" ]; then
    host_for_url="<server-ip-or-domain>"
  fi
  cat <<EOF

Legax Relay installed.

Service:
  $SERVICE_NAME

Config file:
  $config_file

Secrets:
  Desktop secrets were written to the YAML config above.
  They are not printed by default.

Relay web URL:
  http://$host_for_url:$PORT/

Browser pairing:
  Run npm run daemon:pair on the desktop, then scan the printed QR code from
  the phone or enter the one-time pairing code manually.

EOF
  cat <<EOF

Useful commands:
  systemctl status $SERVICE_NAME
  journalctl -u $SERVICE_NAME -f

Firewall hint:
  open TCP port $PORT only to trusted networks, or place the relay behind HTTPS reverse proxy.
EOF
}

install_nodejs
check_node_version
create_user
install_files
install_service
print_summary
