#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="gps-tracker.service"
PROJECT_DIR="/home/punl-wilc/Documents/gps-tracker"
SERVICE_SRC="${PROJECT_DIR}/deploy/${SERVICE_NAME}"
SERVICE_DST="/etc/systemd/system/${SERVICE_NAME}"
SUDOERS_NAME="gps-tracker"
SUDOERS_SRC="${PROJECT_DIR}/deploy/${SUDOERS_NAME}.sudoers"
SUDOERS_DST="/etc/sudoers.d/${SUDOERS_NAME}"

if [[ ! -f "${SERVICE_SRC}" ]]; then
  echo "Service file not found: ${SERVICE_SRC}" >&2
  exit 1
fi

if [[ ! -f "${SUDOERS_SRC}" ]]; then
  echo "Sudoers file not found: ${SUDOERS_SRC}" >&2
  exit 1
fi

echo "Installing ${SERVICE_NAME}..."
sudo install -m 0644 "${SERVICE_SRC}" "${SERVICE_DST}"
sudo install -m 0440 "${SUDOERS_SRC}" "${SUDOERS_DST}"
sudo visudo -cf "${SUDOERS_DST}"
sudo systemctl daemon-reload
sudo systemctl enable --now "${SERVICE_NAME}"

echo "Service installed and started."
echo "Status:"
sudo systemctl status --no-pager "${SERVICE_NAME}" || true

echo "Recent logs:"
sudo journalctl -u "${SERVICE_NAME}" -n 50 --no-pager || true
