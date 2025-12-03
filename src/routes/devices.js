const { pool } = require('../config/database');

// Einzelnes Device abrufen
async function getDevice(req, res) {
    try {
        const { deviceId } = req.params;
        
        const conn = await pool.getConnection();
        const device = await conn.query(
            'SELECT * FROM device_access WHERE device_id = ? AND is_active = TRUE',
            [deviceId]
        );
        conn.release();
        
        if (device.length > 0) {
            // Letzte GPS-Daten für dieses Device
            const gpsConn = await pool.getConnection();
            const lastData = await gpsConn.query(
                `SELECT * FROM gps_data 
                 WHERE device_id = ? 
                 ORDER BY timestamp DESC 
                 LIMIT 1`,
                [deviceId]
            );
            gpsConn.release();
            
            const response = {
                id: device[0].device_id,
                name: device[0].name,
                type: device[0].type,
                description: device[0].description,
                status: 'online',
                lastSeen: new Date()
            };
            
            if (lastData.length > 0) {
                response.latitude = lastData[0].latitude;
                response.longitude = lastData[0].longitude;
                response.altitude = lastData[0].altitude;
                response.battery = lastData[0].battery_level;
                response.timestamp = lastData[0].timestamp;
            } else {
                // Fallback Mock-Daten
                response.latitude = (48.1351 + Math.random() * 0.01 - 0.005).toFixed(6);
                response.longitude = (11.5820 + Math.random() * 0.01 - 0.005).toFixed(6);
                response.altitude = (520 + Math.random() * 50).toFixed(1);
                response.battery = (80 + Math.random() * 20).toFixed(1);
                response.timestamp = new Date().toISOString();
            }
            
            res.json(response);
        } else {
            res.status(404).json({ 
                status: 'error', 
                message: 'Device nicht gefunden' 
            });
        }
    } catch (error) {
        console.error('Error in getDevice:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Internal server error' 
        });
    }
}

// Alle Devices (für index.html Kompatibilität)
function getAllDevices(deviceConfig, deviceIntervals) {
    return (req, res) => {
        const devices = Object.keys(deviceConfig).map(deviceId => ({
            id: deviceId,
            name: deviceConfig[deviceId].name,
            type: deviceConfig[deviceId].type,
            description: deviceConfig[deviceId].description,
            status: deviceConfig[deviceId].is_active ? 'online' : 'offline',
            lastSeen: new Date(),
            currentInterval: deviceIntervals[deviceId] || 60
        }));
        res.json(devices);
    };
}

// Device Config (für index.html Kompatibilität)
function getDeviceConfig(deviceConfig) {
    return (req, res) => {
        res.json(deviceConfig);
    };
}

module.exports = { getDevice, getAllDevices, getDeviceConfig };