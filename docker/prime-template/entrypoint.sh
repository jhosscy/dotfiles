#!/usr/bin/env bash
set -euo pipefail

SSH_USER="${SSH_USER:-dev}"
SSH_PORT="${SSH_PORT:-22}"

setup_authorized_keys() {
  local user="$1"
  local key="$2"
  local home_dir

  if ! id "$user" >/dev/null 2>&1; then
    return 0
  fi

  home_dir="$(getent passwd "$user" | cut -d: -f6)"
  mkdir -p "$home_dir/.ssh"
  printf '%s\n' "$key" > "$home_dir/.ssh/authorized_keys"
  chown -R "$user:$user" "$home_dir/.ssh"
  chmod 700 "$home_dir/.ssh"
  chmod 600 "$home_dir/.ssh/authorized_keys"
}

if [[ -n "${PUBLIC_KEY:-}" ]]; then
  setup_authorized_keys "$SSH_USER" "$PUBLIC_KEY"

  # Keep root login available too, useful if a cloud template assumes root.
  mkdir -p /root/.ssh
  printf '%s\n' "$PUBLIC_KEY" > /root/.ssh/authorized_keys
  chmod 700 /root/.ssh
  chmod 600 /root/.ssh/authorized_keys
fi

sed -i '/^#*Port /d' /etc/ssh/sshd_config
echo "Port ${SSH_PORT}" >> /etc/ssh/sshd_config

ssh-keygen -A >/dev/null 2>&1 || true

if [[ "${1:-}" == "sshd" || $# -eq 0 ]]; then
  echo "Starting SSH server on port ${SSH_PORT}. SSH user: ${SSH_USER}"
  exec /usr/sbin/sshd -D
fi

exec "$@"
