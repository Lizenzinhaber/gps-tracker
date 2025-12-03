const mqtt = require('mqtt');
const { pool } = require('../config/database');

const APP_ID = process.env.TTN_APP_ID;
const USERNAME = process.env.TTN_MQTT_USERNAME || `${APP_ID}@ttn`;
const PASSWORD = process.env.TTN_MQTT_PASSWORD || process.env.TTN_MQTT_PASSWORD || '';
const HOST = process.env.TTN_MQTT_HOST || 'eu1.cloud.thethings.network';
const TLS = (process.env.TTN_MQTT_TLS || 'true') === 'true';
const PORT = TLS ? (process.env.TTN_MQTT_TLS_PORT || '8883') : (process.env.TTN_MQTT_PORT || '1883');

function parseBinaryFrmPayload(frm_payload_b64) {
    const buf = Buffer.from(frm_payload_b64, 'base64');
    if (buf.length < 13) throw new Error('Payload too short to contain GPS structure');

    const latitude = buf.readInt32BE(0) / 1e6;
    const longitude = buf.readInt32BE(4) / 1e6;
    const altitude = buf.readInt16BE(8);
    const satellites = buf.readUInt8(10);
    const hdop = buf.readUInt8(11) / 10;
    const fix = buf.readUInt8(12);

    return { latitude, longitude, altitude, satellites, hdop, fix };
}

function setupTTNMqtt(io, options = {}) {
    const protocol = TLS ? 'mqtts' : 'mqtt';
    const url = `${protocol}://${HOST}:${PORT}`;

    const client = mqtt.connect(url, {
        username: USERNAME,
        password: PASSWORD,
        rejectUnauthorized: options.rejectUnauthorized !== undefined ? options.rejectUnauthorized : true
    });

    const topic = `v3/${APP_ID}@ttn/devices/+/up`;

    client.on('connect', () => {
        console.log('Connected to TTN MQTT:', url);
        client.subscribe(topic, { qos: 0 }, (err) => {
            if (err) console.error('MQTT subscribe error:', err);
            else console.log('Subscribed to TTN uplinks topic:', topic);
        });
    });

    client.on('error', (err) => {
        console.error('MQTT error:', err);
    });

    client.on('message', async (topic, messageBuffer) => {
        try {
            const payloadText = messageBuffer.toString();
            let msg;
            try {
                msg = JSON.parse(payloadText);
            } catch (e) {
                console.warn('Received non-JSON mqtt message on', topic);
                return;
            }

            // TTN V3 uplink structure: message.uplink_message (frm_payload) or message.uplink_message.frm_payload
            let frmPayloadB64 = null;
            let timestamp = new Date();

            if (msg.uplink_message?.frm_payload) {
                frmPayloadB64 = msg.uplink_message.frm_payload;
                if (msg.received_at) timestamp = new Date(msg.received_at);
            } else if (msg.result?.uplink_message?.frm_payload) {
                frmPayloadB64 = msg.result.uplink_message.frm_payload;
                if (msg.result?.received_at) timestamp = new Date(msg.result.received_at);
            } else if (msg.up?.frm_payload) {
                frmPayloadB64 = msg.up.frm_payload;
                if (msg.up?.received_at) timestamp = new Date(msg.up.received_at);
            } else if (msg.uplink_message?.decoded_payload) {
                // decoded_payload may already contain lat/lon
                const d = msg.uplink_message.decoded_payload;
                if (typeof d.latitude === 'number' && typeof d.longitude === 'number') {
                    const gps = {
                        latitude: d.latitude,
                        longitude: d.longitude,
                        altitude: d.altitude ?? null,
                        satellites: d.satellites ?? null,
                        hdop: d.hdop ?? null,
                        fix: d.fix ?? null
                    };
                    await saveAndEmit(io, msg.end_device_ids?.device_id || 'unknown', gps, timestamp);
                    return;
                }
            }

            if (!frmPayloadB64) {
                console.warn('No frm_payload or decoded payload found in message:', topic);
                return;
            }

            const gps = parseBinaryFrmPayload(frmPayloadB64);
            await saveAndEmit(io, msg.end_device_ids?.device_id || msg.device_ids?.device_id || 'unknown', gps, timestamp);
        } catch (err) {
            console.error('Error handling MQTT message:', err);
        }
    });

    async function saveAndEmit(io, deviceId, gps, timestamp) {
        const gpsRecord = {
            deviceId,
            latitude: gps.latitude,
            longitude: gps.longitude,
            altitude: gps.altitude,
            satellites: gps.satellites,
            hdop: gps.hdop,
            fix: gps.fix,
            timestamp: timestamp || new Date()
        };

        // save to DB
        try {
            const conn = await pool.getConnection();
            await conn.query(
                `INSERT INTO gps_data (device_id, latitude, longitude, altitude, battery_level, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [gpsRecord.deviceId, gpsRecord.latitude, gpsRecord.longitude, gpsRecord.altitude, null, gpsRecord.timestamp]
            );
            conn.release();
            console.log(`Saved GPS from ${deviceId} to DB: ${gpsRecord.latitude}, ${gpsRecord.longitude}`);
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
                fix: gpsRecord.fix,
                timestamp: gpsRecord.timestamp.toISOString()
            });
        } catch (emitErr) {
            console.error('Error emitting gps-data via socket.io:', emitErr);
        }
    }

    return client;
}

module.exports = { setupTTNMqtt };