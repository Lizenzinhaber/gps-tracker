const { pool } = require('../config/database');
const { getTrackerState } = require('../utils/tracker_state');
const { calculateTrackerConnection, toValidDate } = require('../utils/helpers');

function firstNonNull(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null) {
            return value;
        }
    }
    return null;
}

function toIsoOrNull(value) {
    const date = toValidDate(value);
    return date ? date.toISOString() : null;
}

function resolveIntervalInfo(deviceIntervals, deviceId) {
    const fromMap = Number(deviceIntervals?.[deviceId]);
    if (Number.isFinite(fromMap)) {
        return {
            seconds: Math.max(30, Math.floor(fromMap)),
            source: 'configured'
        };
    }

    return {
        seconds: 60,
        source: 'device_default'
    };
}

function buildDeviceResponse(deviceRow, latestGpsData, trackerState, intervalInfo) {
    const intervalSeconds = intervalInfo.seconds;
    const timestamp = firstNonNull(trackerState?.lastUplinkAt, latestGpsData?.timestamp);
    const battery = firstNonNull(trackerState?.lastBatteryLevel, latestGpsData?.battery_level);
    const latitude = firstNonNull(trackerState?.lastLatitude, latestGpsData?.latitude);
    const longitude = firstNonNull(trackerState?.lastLongitude, latestGpsData?.longitude);
    const altitude = firstNonNull(trackerState?.lastAltitude, latestGpsData?.altitude);
    const connection = calculateTrackerConnection(timestamp, intervalSeconds, battery);

    return {
        id: deviceRow.device_id,
        name: deviceRow.name,
        type: deviceRow.type,
        description: deviceRow.description,
        status: connection.state === 'disconnected' ? 'offline' : 'online',
        connection,
        connectionMessage: connection.message,
        expectedIntervalSeconds: intervalSeconds,
        intervalSource: intervalInfo.source,
        batterySavingActive: connection.batterySavingActive,
        battery: battery,
        battery_level: battery,
        latitude,
        longitude,
        altitude,
        timestamp: toIsoOrNull(timestamp),
        lastSeen: toIsoOrNull(timestamp),
        sourcePort: trackerState?.lastSourcePort || null,
        messageType: trackerState?.lastMessageType || null,
        hasGpsFix: trackerState?.lastHasGpsFix ?? null,
        usedLastKnownLocation: trackerState?.lastUsedLastKnownLocation ?? null
    };
}

// Einzelnes Device abrufen
function getDevice(deviceIntervals) {
    return async (req, res) => {
        try {
            const { deviceId } = req.params;

            const conn = await pool.getConnection();
            let deviceRows;
            try {
                deviceRows = await conn.query(
                    'SELECT * FROM device_access WHERE device_id = ? AND is_active = TRUE',
                    [deviceId]
                );
            } finally {
                conn.release();
            }

            if (deviceRows.length === 0) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Device nicht gefunden'
                });
            }

            const gpsConn = await pool.getConnection();
            let lastData;
            try {
                lastData = await gpsConn.query(
                    `SELECT * FROM gps_data
                     WHERE device_id = ?
                     ORDER BY timestamp DESC
                     LIMIT 1`,
                    [deviceId]
                );
            } finally {
                gpsConn.release();
            }

            const trackerState = getTrackerState(deviceId);
            const intervalInfo = resolveIntervalInfo(deviceIntervals, deviceId);

            const response = buildDeviceResponse(
                deviceRows[0],
                lastData.length > 0 ? lastData[0] : null,
                trackerState,
                intervalInfo
            );

            res.json(response);
        } catch (error) {
            console.error('Error in getDevice:', error);
            res.status(500).json({
                status: 'error',
                message: 'Internal server error'
            });
        }
    };
}

// Alle Devices (fuer index.html Kompatibilitaet)
function getAllDevices(deviceConfig, deviceIntervals) {
    return (req, res) => {
        const devices = Object.keys(deviceConfig).map((deviceId) => {
            const config = deviceConfig[deviceId] || {};
            const trackerState = getTrackerState(deviceId);
            const intervalInfo = resolveIntervalInfo(deviceIntervals, deviceId);
            const intervalSeconds = intervalInfo.seconds;
            const connection = calculateTrackerConnection(
                trackerState?.lastUplinkAt || null,
                intervalSeconds,
                trackerState?.lastBatteryLevel ?? null
            );

            return {
                id: deviceId,
                name: config.name,
                type: config.type,
                description: config.description,
                status: connection.state === 'disconnected' ? 'offline' : 'online',
                connection,
                currentInterval: intervalSeconds,
                intervalSource: intervalInfo.source,
                battery: trackerState?.lastBatteryLevel ?? null,
                lastSeen: toIsoOrNull(trackerState?.lastUplinkAt)
            };
        });

        res.json(devices);
    };
}

// Device Config (fuer index.html Kompatibilitaet)
function getDeviceConfig(deviceConfig) {
    return (req, res) => {
        res.json(deviceConfig);
    };
}

module.exports = { getDevice, getAllDevices, getDeviceConfig };