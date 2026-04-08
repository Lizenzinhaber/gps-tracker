require('dotenv').config({ quiet: true });
const mariadb = require('mariadb');
const pool = mariadb.createPool({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '3306', 10),
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
                description: device.description,
                is_active: device.is_active
            };
        });
        
        intervals.forEach(interval => {
            deviceIntervals[interval.device_id] = interval.interval_seconds;
        });
        
        return { deviceConfig, deviceIntervals };
        
    } catch (error) {
        console.error('Fehler beim Laden der Device-Konfig:', error);
        return {
            deviceConfig: {},
            deviceIntervals: {}
        };
    } finally {
        if (conn) conn.release();
    }
}
module.exports = { pool, loadDeviceConfig };