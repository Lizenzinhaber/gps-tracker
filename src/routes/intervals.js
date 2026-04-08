const { pool } = require('../config/database');
const { queueIntervalDownlink } = require('../mqtt/ttn');

async function ensureDeviceExistsForInterval(conn, deviceId) {
    const existing = await conn.query(
        'SELECT device_id FROM devices WHERE device_id = ? LIMIT 1',
        [deviceId]
    );

    if (existing.length > 0) {
        return 'existing';
    }

    const accessRows = await conn.query(
        `SELECT device_id, name, type, description, is_active
         FROM device_access
         WHERE device_id = ?
         LIMIT 1`,
        [deviceId]
    );

    if (accessRows.length > 0) {
        const row = accessRows[0];
        await conn.query(
            `INSERT INTO devices (device_id, name, type, description, is_active)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                 name = VALUES(name),
                 type = VALUES(type),
                 description = VALUES(description),
                 is_active = VALUES(is_active)`,
            [
                row.device_id,
                row.name || `Tracker ${row.device_id}`,
                row.type || 'main',
                row.description || null,
                row.is_active === undefined || row.is_active === null ? 1 : row.is_active
            ]
        );
        return 'device_access';
    }

    const fallbackName = `Tracker ${String(deviceId).slice(0, 92)}`;
    await conn.query(
        `INSERT INTO devices (device_id, name, type, description, is_active)
         VALUES (?, ?, 'main', ?, 1)
         ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             description = VALUES(description)`,
        [deviceId, fallbackName, 'Automatisch angelegt durch Intervall-Update']
    );

    return 'fallback';
}

// Intervall setzen
async function setInterval(req, res, io, deviceIntervals) {
    try {
        const { interval, deviceId } = req.body;

        console.log(`Intervall ${interval}s für Device ${deviceId}`);
        
        // Validation
        if (!deviceId || interval === undefined || interval === null) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'deviceId and interval are required' 
            });
        }
        
        const intervalNum = parseInt(interval, 10);
        if (isNaN(intervalNum)) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'interval must be a number' 
            });
        }

        if (intervalNum < 30 || intervalNum > 3600) {
            return res.status(400).json({
                status: 'error',
                message: 'interval must be between 30 and 3600 seconds'
            });
        }
        
        // In Datenbank speichern
        const conn = await pool.getConnection();
        let deviceRegisterSource = 'existing';
        try {
            deviceRegisterSource = await ensureDeviceExistsForInterval(conn, deviceId);

            await conn.query(
                `INSERT INTO device_intervals (device_id, interval_seconds)
                 VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE interval_seconds = VALUES(interval_seconds)`,
                [deviceId, intervalNum]
            );
        } finally {
            conn.release();
        }
        
        // Lokal aktualisieren
        deviceIntervals[deviceId] = intervalNum; 
        io.emit('interval-update', { interval: intervalNum, deviceId, timestamp: new Date() });

        let downlink;
        try {
            downlink = await queueIntervalDownlink(deviceId, intervalNum);
            console.log(`TTN downlink queued for ${deviceId}: ${intervalNum}s`);
        } catch (downlinkError) {
            console.error(`TTN downlink failed for ${deviceId}:`, downlinkError.message);
            downlink = {
                queued: false,
                error: downlinkError.message
            };
        }
        
        res.json({ 
            status: 'success', 
            interval: intervalNum,
            deviceId: deviceId,
            deviceRegisterSource,
            downlink,
            message: downlink && downlink.queued === false
                ? 'Intervall gespeichert, aber TTN Downlink fehlgeschlagen'
                : 'Intervall erfolgreich gesetzt'
        });
    } catch (error) {
        console.error('Error in setInterval:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Internal server error' 
        });
    }
}

// Intervall-Info für Device
async function getIntervalInfo(req, res) {
    try {
        const { deviceId } = req.params;
        
        const conn = await pool.getConnection();
        const interval = await conn.query(
            'SELECT interval_seconds FROM device_intervals WHERE device_id = ?',
            [deviceId]
        );
        conn.release();
        
        if (interval.length > 0) {
            res.json({ 
                interval: interval[0].interval_seconds,
                deviceId: deviceId,
                source: 'configured',
                note: 'Gespeicherter Wert aus device_intervals'
            });
        } else {
            res.json({ 
                interval: 60, // Default
                deviceId: deviceId,
                source: 'device_default',
                note: 'Kein gespeicherter Wert, Tracker-Default 60 Sekunden'
            });
        }
    } catch (error) {
        console.error('Error in getIntervalInfo:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Internal server error' 
        });
    }
}

// Alle Intervalle (für Kompatibilität)
function getAllIntervals(deviceIntervals) {
    return (req, res) => {
        res.json(deviceIntervals);
    };
}

module.exports = { setInterval, getIntervalInfo, getAllIntervals };