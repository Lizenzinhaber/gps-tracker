const { pool } = require('../config/database');

// Verfügbare Daten für ein Gerät
async function getAvailableDates(req, res) {
    try {
        const { deviceId } = req.params;
        const conn = await pool.getConnection();
        
        const dates = await conn.query(
            `SELECT DISTINCT DATE(timestamp) as date 
             FROM gps_data 
             WHERE device_id = ? 
             ORDER BY date DESC`,
            [deviceId]
        );
        
        conn.release();
        res.json(dates.map(row => row.date));
        
    } catch (error) {
        console.error('Error in getAvailableDates:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Internal server error' 
        });
    }
}

// Tagesdaten für ein Gerät
async function getDayHistory(req, res) {
    try {
        const { deviceId, date } = req.params;
        const conn = await pool.getConnection();
        
        const data = await conn.query(
            `SELECT 
                device_id,
                latitude, 
                longitude, 
                altitude, 
                battery_level as battery,  -- ALIAS für Kompatibilität
                timestamp
             FROM gps_data 
             WHERE device_id = ? AND DATE(timestamp) = ?
             ORDER BY timestamp ASC`,
            [deviceId, date]
        );
        
        conn.release();
        
        // Daten für Frontend aufbereiten
        const transformedData = data.map(row => ({
            deviceId: row.device_id,
            latitude: row.latitude,
            longitude: row.longitude, 
            altitude: row.altitude,
            battery: row.battery,  // Jetzt korrekt gemappt
            timestamp: row.timestamp
        }));
        
        console.log(`History Daten geladen für ${deviceId} am ${date}: ${transformedData.length} Einträge`);
        res.json(transformedData);
        
    } catch (error) {
        console.error('Error in getDayHistory:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Internal server error' 
        });
    }
}

module.exports = { getAvailableDates, getDayHistory };