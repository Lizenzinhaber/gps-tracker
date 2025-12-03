const { pool } = require('../config/database');

// Token Validierung
async function validateToken(req, res) {
    try {
        const { device_id, access_token } = req.body;
        
        if (!device_id || !access_token) {
            return res.status(400).json({ 
                status: 'error', 
                message: 'device_id and access_token are required' 
            });
        }
        
        const conn = await pool.getConnection();
        const device = await conn.query(
            `SELECT * FROM device_access 
             WHERE device_id = ? AND access_token = ? AND is_active = TRUE`,
            [device_id, access_token]
        );
        conn.release();
        
        if (device.length > 0) {
            // Update last_access timestamp
            const updateConn = await pool.getConnection();
            await updateConn.query(
                'UPDATE device_access SET last_access = NOW() WHERE device_id = ?',
                [device_id]
            );
            updateConn.release();
            
            res.json({ 
                status: 'success', 
                device: {
                    device_id: device[0].device_id,
                    name: device[0].name,
                    type: device[0].type,
                    description: device[0].description
                }
            });
        } else {
            res.status(401).json({ 
                status: 'error', 
                message: 'Ungültiger Token oder Gerät' 
            });
        }
    } catch (error) {
        console.error('Token validation error:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Internal server error' 
        });
    }
}

module.exports = { validateToken };