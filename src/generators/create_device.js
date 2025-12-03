require('dotenv').config();
const { pool } = require('../config/database');

function generateAccessToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = 'TK';
    for (let i = 0; i < 14; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
    return token;
}

async function createDevice({ deviceId, name = 'TTN Tracker', type = 'main', description = '' }) {
    const token = generateAccessToken();
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query(
            `INSERT INTO device_access (device_id, access_token, name, type, description, is_active)
             VALUES (?, ?, ?, ?, ?, TRUE)
             ON DUPLICATE KEY UPDATE name = VALUES(name), type = VALUES(type), description = VALUES(description), access_token = VALUES(access_token), is_active = VALUES(is_active)`,
            [deviceId, token, name, type, description]
        );
        console.log(`Created/updated device '${deviceId}' with token: ${token}`);
    } catch (err) {
        console.error('DB error:', err);
        process.exitCode = 1;
    } finally {
        if (conn) conn.release();
    }
}

// Usage: node src/generators/create_device.js <deviceId> "<name>"
const args = process.argv.slice(2);
const deviceId = args[0] || 'lizenzinhaber-lw-base-example';
const name = args[1] || 'TTN Tracker';

createDevice({ deviceId, name }).then(() => process.exit(0)).catch(() => process.exit(1));