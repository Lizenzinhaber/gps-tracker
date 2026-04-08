const mqtt = require('mqtt');
const https = require('https');
const { pool } = require('../config/database');
const { upsertTrackerState } = require('../utils/tracker_state');

const APP_ID = process.env.TTN_APP_ID;
const USERNAME = process.env.TTN_MQTT_USERNAME || (APP_ID ? `${APP_ID}@ttn` : '');
const PASSWORD = process.env.TTN_MQTT_PASSWORD || '';
const HOST = process.env.TTN_MQTT_HOST || 'eu1.cloud.thethings.network';
const TLS = (process.env.TTN_MQTT_TLS || 'true') === 'true';
const PORT = TLS ? (process.env.TTN_MQTT_TLS_PORT || '8883') : (process.env.TTN_MQTT_PORT || '1883');

const DOWNLINK_ENABLED = (process.env.TTN_DOWNLINK_ENABLED || 'true') === 'true';
const DOWNLINK_API_KEY = process.env.TTN_DOWNLINK_API_KEY || '';
const DOWNLINK_API_HOST = process.env.TTN_API_HOST || HOST;
const DOWNLINK_PORT = parseInt(process.env.TTN_DOWNLINK_PORT || '1', 10);
const TTN_DEVICE_ID_PREFIX = process.env.TTN_DEVICE_ID_PREFIX || '';
const TTN_DEVICE_ID_SUFFIX = process.env.TTN_DEVICE_ID_SUFFIX || '';

const mqttRuntimeState = {
    configured: Boolean(APP_ID && USERNAME && PASSWORD),
    connected: false,
    subscribed: false,
    host: HOST,
    port: PORT,
    topic: null,
    lastConnectAt: null,
    lastDisconnectAt: null,
    lastMessageAt: null,
    lastError: null,
    lastErrorAt: null,
    configError: null
};

function getTTNMqttStatus() {
    return { ...mqttRuntimeState };
}

function parseBinaryFrmPayload(frmPayloadB64, fPort) {
    const buf = Buffer.from(frmPayloadB64, 'base64');

    if (fPort === 11 || (fPort == null && buf.length === 1)) {
        if (buf.length < 1) throw new Error('Port 11 payload too short');
        return {
            batteryLevel: buf.readUInt8(0),
            sourcePort: 11,
            messageType: 'battery_only',
            hasGpsFix: false
        };
    }

    if (fPort === 10 || (fPort == null && buf.length >= 13)) {
        if (buf.length < 13) throw new Error('Port 10 payload too short');

        const latitude = buf.readInt32BE(0) / 1e6;
        const longitude = buf.readInt32BE(4) / 1e6;
        const altitude = buf.readInt16BE(8);
        const satellites = buf.readUInt8(10);
        const hdop = buf.readUInt8(11) / 10;
        const batteryLevel = buf.readUInt8(12);
        const hasGpsFix = !(latitude === 0 && longitude === 0);

        return {
            latitude: hasGpsFix ? latitude : null,
            longitude: hasGpsFix ? longitude : null,
            altitude,
            satellites,
            hdop,
            batteryLevel,
            sourcePort: 10,
            messageType: hasGpsFix ? 'gnss_and_battery' : 'battery_only_with_gnss_attempt',
            hasGpsFix
        };
    }

    throw new Error(`Unsupported payload format (fPort=${fPort}, length=${buf.length})`);
}

function toNumberOrNull(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseDecodedPayload(decoded, fPort) {
    if (!decoded || typeof decoded !== 'object') return null;

    const latitude = toNumberOrNull(decoded.latitude ?? decoded.lat);
    const longitude = toNumberOrNull(decoded.longitude ?? decoded.lng);
    const altitude = toNumberOrNull(decoded.altitude ?? decoded.alt);
    const satellites = toNumberOrNull(decoded.satellites ?? decoded.sats);
    const hdop = toNumberOrNull(decoded.hdop);
    const batteryLevel = toNumberOrNull(
        decoded.battery ?? decoded.battery_level ?? decoded.batt ?? decoded.battery_percent
    );
    const messageType = typeof decoded.message_type === 'string' ? decoded.message_type : null;
    const coordinatesProvided = latitude !== null && longitude !== null;
    const coordinatesAreInvalid = coordinatesProvided && latitude === 0 && longitude === 0;
    const hasGpsFix = coordinatesProvided && !coordinatesAreInvalid;
    const resolvedMessageType =
        messageType ||
        (fPort === 11 ? 'battery_only' : hasGpsFix ? 'gnss_and_battery' : 'battery_only_with_gnss_attempt');

    if (fPort === 11 && batteryLevel !== null) {
        return {
            batteryLevel,
            sourcePort: 11,
            messageType: resolvedMessageType,
            hasGpsFix: false
        };
    }

    if (coordinatesProvided || batteryLevel !== null) {
        return {
            latitude: hasGpsFix ? latitude : null,
            longitude: hasGpsFix ? longitude : null,
            altitude,
            satellites,
            hdop,
            batteryLevel,
            sourcePort: fPort || 10,
            messageType: resolvedMessageType,
            hasGpsFix
        };
    }

    return null;
}

function isValidDate(value) {
    return value instanceof Date && !Number.isNaN(value.getTime());
}

function resolveTimestamp(msg, uplink) {
    const rawTimestamp = msg.received_at || msg.result?.received_at || uplink?.received_at;
    if (!rawTimestamp) return new Date();

    const timestamp = new Date(rawTimestamp);
    return isValidDate(timestamp) ? timestamp : new Date();
}

function normalizeHost(rawHost) {
    return rawHost.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function resolveTTNDeviceId(deviceId) {
    return `${TTN_DEVICE_ID_PREFIX}${deviceId}${TTN_DEVICE_ID_SUFFIX}`;
}

function validateIntervalSeconds(intervalSeconds) {
    const parsed = parseInt(intervalSeconds, 10);
    if (Number.isNaN(parsed)) {
        throw new Error('intervalSeconds must be a number');
    }
    if (parsed < 30 || parsed > 3600) {
        throw new Error('intervalSeconds must be in range 30..3600');
    }
    return parsed;
}

async function getLastKnownLocation(deviceId) {
    const conn = await pool.getConnection();
    try {
        const rows = await conn.query(
            `SELECT latitude, longitude, altitude
             FROM gps_data
             WHERE device_id = ?
             ORDER BY timestamp DESC
             LIMIT 1`,
            [deviceId]
        );
        return rows[0] || null;
    } finally {
        conn.release();
    }
}

function setupTTNMqtt(io, options = {}) {
    if (!APP_ID || !USERNAME || !PASSWORD) {
        mqttRuntimeState.configError =
            'TTN MQTT not configured completely. Set TTN_APP_ID, TTN_MQTT_USERNAME and TTN_MQTT_PASSWORD in .env';
        console.warn(mqttRuntimeState.configError);
        return null;
    }

    const protocol = TLS ? 'mqtts' : 'mqtt';
    const url = `${protocol}://${HOST}:${PORT}`;

    const client = mqtt.connect(url, {
        username: USERNAME,
        password: PASSWORD,
        rejectUnauthorized: options.rejectUnauthorized !== undefined ? options.rejectUnauthorized : true
    });

    const topic = `v3/${APP_ID}@ttn/devices/+/up`;
    mqttRuntimeState.topic = topic;
    mqttRuntimeState.configError = null;

    client.on('connect', () => {
        mqttRuntimeState.connected = true;
        mqttRuntimeState.lastConnectAt = new Date().toISOString();
        mqttRuntimeState.lastError = null;
        console.log('Connected to TTN MQTT:', url);
        client.subscribe(topic, { qos: 0 }, (err) => {
            if (err) {
                mqttRuntimeState.subscribed = false;
                mqttRuntimeState.lastError = err.message;
                mqttRuntimeState.lastErrorAt = new Date().toISOString();
                console.error('MQTT subscribe error:', err);
            } else {
                mqttRuntimeState.subscribed = true;
                console.log('Subscribed to TTN uplinks topic:', topic);
            }
        });
    });

    client.on('reconnect', () => {
        mqttRuntimeState.connected = false;
        mqttRuntimeState.subscribed = false;
    });

    client.on('offline', () => {
        mqttRuntimeState.connected = false;
        mqttRuntimeState.subscribed = false;
        mqttRuntimeState.lastDisconnectAt = new Date().toISOString();
    });

    client.on('close', () => {
        mqttRuntimeState.connected = false;
        mqttRuntimeState.subscribed = false;
        mqttRuntimeState.lastDisconnectAt = new Date().toISOString();
    });

    client.on('error', (err) => {
        mqttRuntimeState.connected = false;
        mqttRuntimeState.lastError = err.message;
        mqttRuntimeState.lastErrorAt = new Date().toISOString();
        console.error('MQTT error:', err);
    });

    client.on('message', async (topic, messageBuffer) => {
        try {
            mqttRuntimeState.lastMessageAt = new Date().toISOString();
            const payloadText = messageBuffer.toString();
            let msg;
            try {
                msg = JSON.parse(payloadText);
            } catch (e) {
                console.warn('Received non-JSON mqtt message on', topic);
                return;
            }

            const uplink = msg.uplink_message || msg.result?.uplink_message || msg.up;
            if (!uplink) {
                console.warn('No uplink structure found in MQTT message:', topic);
                return;
            }

            const fPort = uplink.f_port ?? uplink.port ?? null;
            const timestamp = resolveTimestamp(msg, uplink);
            const deviceId =
                msg.end_device_ids?.device_id ||
                msg.device_ids?.device_id ||
                msg.result?.end_device_ids?.device_id ||
                'unknown';

            let gps = parseDecodedPayload(uplink.decoded_payload, fPort);

            if (!gps && uplink.frm_payload) {
                gps = parseBinaryFrmPayload(uplink.frm_payload, fPort);
            }

            if (!gps) {
                console.warn('No supported payload found in message:', topic);
                return;
            }

            await saveAndEmit(io, deviceId, gps, timestamp);
        } catch (err) {
            console.error('Error handling MQTT message:', err);
        }
    });

    async function saveAndEmit(io, deviceId, gps, timestamp) {
        const gpsRecord = {
            deviceId,
            latitude: toNumberOrNull(gps.latitude),
            longitude: toNumberOrNull(gps.longitude),
            altitude: toNumberOrNull(gps.altitude),
            satellites: toNumberOrNull(gps.satellites),
            hdop: toNumberOrNull(gps.hdop),
            batteryLevel: toNumberOrNull(gps.batteryLevel),
            sourcePort: gps.sourcePort || null,
            messageType: gps.messageType || null,
            hasGpsFix: Boolean(gps.hasGpsFix),
            usedLastKnownLocation: false,
            timestamp: timestamp || new Date()
        };

        if (gpsRecord.latitude === null || gpsRecord.longitude === null) {
            try {
                const lastLocation = await getLastKnownLocation(deviceId);
                if (lastLocation) {
                    gpsRecord.latitude = toNumberOrNull(lastLocation.latitude);
                    gpsRecord.longitude = toNumberOrNull(lastLocation.longitude);
                    if (gpsRecord.altitude === null) {
                        gpsRecord.altitude = toNumberOrNull(lastLocation.altitude);
                    }
                    gpsRecord.usedLastKnownLocation = true;
                }
            } catch (locationErr) {
                console.warn(`Unable to load last location for ${deviceId}:`, locationErr.message);
            }
        }

        upsertTrackerState(deviceId, {
            lastUplinkAt: gpsRecord.timestamp,
            lastBatteryLevel: gpsRecord.batteryLevel,
            lastSourcePort: gpsRecord.sourcePort,
            lastMessageType: gpsRecord.messageType,
            lastHasGpsFix: gpsRecord.hasGpsFix,
            lastUsedLastKnownLocation: gpsRecord.usedLastKnownLocation,
            lastLatitude: gpsRecord.latitude,
            lastLongitude: gpsRecord.longitude,
            lastAltitude: gpsRecord.altitude
        });

        // save to DB
        try {
            if (gpsRecord.latitude !== null && gpsRecord.longitude !== null) {
                const conn = await pool.getConnection();
                try {
                    await conn.query(
                        `INSERT INTO gps_data (device_id, latitude, longitude, altitude, battery_level, timestamp)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            gpsRecord.deviceId,
                            gpsRecord.latitude,
                            gpsRecord.longitude,
                            gpsRecord.altitude,
                            gpsRecord.batteryLevel,
                            gpsRecord.timestamp
                        ]
                    );
                } finally {
                    conn.release();
                }
                console.log(
                    `Saved TTN data from ${deviceId} to DB: ${gpsRecord.latitude}, ${gpsRecord.longitude} (battery=${gpsRecord.batteryLevel})`
                );
            } else {
                console.warn(`Skipping DB insert for ${deviceId}: no valid coordinates available`);
            }
        } catch (dbErr) {
            console.error('DB insert error for MQTT GPS:', dbErr);
        }

        // emit over websocket so dashboard can update immediately
        try {
            io.emit('gps-data', {
                deviceId: gpsRecord.deviceId,
                latitude: gpsRecord.latitude,
                longitude: gpsRecord.longitude,
                altitude: gpsRecord.altitude,
                satellites: gpsRecord.satellites,
                hdop: gpsRecord.hdop,
                battery: gpsRecord.batteryLevel,
                battery_level: gpsRecord.batteryLevel,
                port: gpsRecord.sourcePort,
                message_type: gpsRecord.messageType,
                has_gps_fix: gpsRecord.hasGpsFix,
                hasGpsFix: gpsRecord.hasGpsFix,
                used_last_known_location: gpsRecord.usedLastKnownLocation,
                usedLastKnownLocation: gpsRecord.usedLastKnownLocation,
                timestamp: gpsRecord.timestamp.toISOString()
            });
        } catch (emitErr) {
            console.error('Error emitting gps-data via socket.io:', emitErr);
        }
    }

    return client;
}

async function queueIntervalDownlink(deviceId, intervalSeconds) {
    const safeInterval = validateIntervalSeconds(intervalSeconds);
    const ttnDeviceId = resolveTTNDeviceId(deviceId);

    if (!DOWNLINK_ENABLED) {
        return {
            queued: false,
            skipped: true,
            reason: 'TTN downlink disabled',
            deviceId: ttnDeviceId,
            interval: safeInterval
        };
    }

    if (!APP_ID || !DOWNLINK_API_KEY) {
        throw new Error('TTN downlink not configured. Set TTN_APP_ID and TTN_DOWNLINK_API_KEY in .env');
    }

    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(safeInterval, 0);

    const body = JSON.stringify({
        downlinks: [
            {
                f_port: DOWNLINK_PORT,
                frm_payload: payload.toString('base64'),
                priority: 'NORMAL'
            }
        ]
    });

    const host = normalizeHost(DOWNLINK_API_HOST);
    const requestPath = `/api/v3/as/applications/${encodeURIComponent(APP_ID)}/devices/${encodeURIComponent(ttnDeviceId)}/down/push`;

    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname: host,
                port: 443,
                path: requestPath,
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${DOWNLINK_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                }
            },
            (res) => {
                let responseBody = '';
                res.on('data', (chunk) => {
                    responseBody += chunk;
                });

                res.on('end', () => {
                    const statusCode = res.statusCode || 0;
                    if (statusCode < 200 || statusCode >= 300) {
                        return reject(
                            new Error(
                                `TTN downlink failed (${statusCode}): ${responseBody || 'no response body'}`
                            )
                        );
                    }

                    resolve({
                        queued: true,
                        deviceId: ttnDeviceId,
                        interval: safeInterval,
                        port: DOWNLINK_PORT,
                        statusCode
                    });
                });
            }
        );

        req.on('error', (err) => {
            reject(err);
        });

        req.write(body);
        req.end();
    });
}

module.exports = { setupTTNMqtt, queueIntervalDownlink, getTTNMqttStatus };