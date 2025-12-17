require('dotenv').config();
const mariadb = require('mariadb');
const pool = mariadb.createPool({
    host: process.env.DATABASE_HOST || 'localhost',
    user: process.env.DATABASE_USER || 'gps_user',
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME || 'gps_tracker',
    connectionLimit: 5
});
// Hilfsfunktion zum Laden der Device-Konfig
async function loadDeviceConfig() {
    let conn;
    try {
        conn = await pool.getConnection();
        const devices = await conn.query('SELECT * FROM devices WHERE is_active = TRUE');
        const intervals = await conn.query('SELECT * FROM device_intervals');
        
        const deviceConfig = {};
        const deviceIntervals = {};
        
        devices.forEach(device => {
            deviceConfig[device.device_id] = {
                name: device.name,
                type: device.type,
                description: device.description
            };
        });
        
        intervals.forEach(interval => {
            deviceIntervals[interval.device_id] = interval.interval_seconds;
        });
        
        return { deviceConfig, deviceIntervals };
        
    } catch (error) {
        console.error('Fehler beim Laden der Device-Konfig:', error);
        // Fallback zu hardgecodeten Werten
        return {
            deviceConfig: {
                'tracker-001': { name: 'Simulierter Tracker', type: 'main', description: 'Haupt-GPS Tracker' },
                'tracker-002': { name: 'Reserve Tracker', type: 'backup', description: 'Backup GPS Tracker' }
            },
            deviceIntervals: { 'tracker-001': 60, 'tracker-002': 300 }
        };
    } finally {
        if (conn) conn.release();
    }
}
module.exports = { pool, loadDeviceConfig };