const { pool } = require('../config/database');

// Intervall setzen
async function setInterval(req, res, io, deviceIntervals) {
    try {
        const { interval, deviceId } = req.body;

        console.log(`Intervall ${interval}s für Device ${deviceId}`);
        
        // Validation
        if (!deviceId || !interval) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'deviceId and interval are required' 
            });
        }
        
        const intervalNum = parseInt(interval);
        if (isNaN(intervalNum)) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'interval must be a number' 
            });
        }
        
        // In Datenbank speichern
        const conn = await pool.getConnection();
        await conn.query(
            'INSERT INTO device_intervals (device_id, interval_seconds) VALUES (?, ?) ON DUPLICATE KEY UPDATE interval_seconds = ?',
            [deviceId, intervalNum, intervalNum]
        );
        conn.release();
        
        // Lokal aktualisieren
        deviceIntervals[deviceId] = intervalNum; 
        io.emit('interval-update', { interval: intervalNum, deviceId, timestamp: new Date() });
        
        res.json({ 
            status: 'success', 
            interval: intervalNum,
            deviceId: deviceId,
            message: 'Intervall erfolgreich gesetzt'
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
                deviceId: deviceId
            });
        } else {
            res.json({ 
                interval: 60, // Default
                deviceId: deviceId
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