# systemd setup (auto start on boot)

## 1) install and start once

Run from project root:

```bash
./scripts/install-systemd-service.sh
```

The script will:
- copy `deploy/gps-tracker.service` to `/etc/systemd/system/`
- install a validated `/etc/sudoers.d/gps-tracker` drop-in for passwordless maintenance commands
- reload systemd
- enable auto start on boot
- start the service immediately
- print status and last logs

## 2) manual service commands

```bash
sudo systemctl status gps-tracker.service
sudo systemctl restart gps-tracker.service
sudo systemctl stop gps-tracker.service
sudo systemctl disable gps-tracker.service
sudo journalctl -u gps-tracker.service -f
```

## 3) update after code changes

```bash
cd /home/punl-wilc/Documents/gps-tracker
npm install
sudo systemctl restart gps-tracker.service
```

## 4) notes

- The service reads environment variables from `/home/punl-wilc/Documents/gps-tracker/.env`.
- The `.env` file is optional for systemd because the unit uses `EnvironmentFile=-...`.
- Ensure TTN variables are set in `.env` for live TTN MQTT uplinks:
  - `TTN_APP_ID`
  - `TTN_MQTT_USERNAME`
  - `TTN_MQTT_PASSWORD`
- Optional downlink configuration:
  - `TTN_DOWNLINK_API_KEY`
