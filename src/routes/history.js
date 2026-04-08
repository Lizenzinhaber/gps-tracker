const { pool } = require('../config/database');

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const RANGE_LIMIT_DEFAULT = 5000;
const RANGE_LIMIT_MAX = 20000;

function toDateOnlyString(value) {
    if (!value) return null;

    if (typeof value === 'string') {
        const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : null;
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }

    return null;
}

function toValidDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function parseRangeLimit(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return RANGE_LIMIT_DEFAULT;
    }
    return Math.max(1, Math.min(parsed, RANGE_LIMIT_MAX));
}

// Verfügbare Daten für ein Gerät
async function getAvailableDates(req, res) {
    let conn;
    try {
        const { deviceId } = req.params;
        conn = await pool.getConnection();
        
        const dates = await conn.query(
            `SELECT DISTINCT DATE_FORMAT(timestamp, '%Y-%m-%d') as date
             FROM gps_data 
             WHERE device_id = ? 
             ORDER BY date DESC`,
            [deviceId]
        );

        const normalizedDates = dates
            .map((row) => toDateOnlyString(row.date))
            .filter(Boolean);

        res.json(normalizedDates);
        
    } catch (error) {
        console.error('Error in getAvailableDates:', error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Internal server error' 
        });
    } finally {
        if (conn) conn.release();
    }
}

// Tagesdaten für ein Gerät
async function getDayHistory(req, res) {
    let conn;
    try {
        const { deviceId, date } = req.params;

        if (!DATE_ONLY_REGEX.test(String(date))) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid date format. Expected YYYY-MM-DD'
            });
        }

        conn = await pool.getConnection();
        
        const data = await conn.query(
            `SELECT 
                device_id,
                latitude, 
                longitude, 
                altitude, 
                battery_level as battery,  -- ALIAS für Kompatibilität
                timestamp
             FROM gps_data 
             WHERE device_id = ? AND DATE_FORMAT(timestamp, '%Y-%m-%d') = ?
             ORDER BY timestamp ASC`,
            [deviceId, date]
        );
        
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
    } finally {
        if (conn) conn.release();
    }
}

// Zeitbereichsdaten für ein Gerät
async function getHistoryRange(req, res) {
    let conn;
    try {
        const { deviceId } = req.params;
        const { start, end, limit } = req.query;

        const startDate = toValidDate(start);
        const endDate = toValidDate(end);

        if (!startDate || !endDate) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid start/end format. Expected ISO date-time values.'
            });
        }

        if (startDate >= endDate) {
            return res.status(400).json({
                status: 'error',
                message: 'start must be earlier than end'
            });
        }

        const safeLimit = parseRangeLimit(limit);

        conn = await pool.getConnection();

        const [totalRow] = await conn.query(
            `SELECT COUNT(*) as totalCount
             FROM gps_data
             WHERE device_id = ? AND timestamp BETWEEN ? AND ?`,
            [deviceId, startDate, endDate]
        );

        const data = await conn.query(
            `SELECT
                device_id,
                latitude,
                longitude,
                altitude,
                battery_level as battery,
                timestamp
             FROM gps_data
             WHERE device_id = ? AND timestamp BETWEEN ? AND ?
             ORDER BY timestamp ASC
             LIMIT ?`,
            [deviceId, startDate, endDate, safeLimit]
        );

        const transformedData = data.map((row) => ({
            deviceId: row.device_id,
            latitude: row.latitude,
            longitude: row.longitude,
            altitude: row.altitude,
            battery: row.battery,
            timestamp: row.timestamp
        }));

        const total = Number(totalRow?.totalCount || 0);
        const truncated = total > transformedData.length;

        console.log(
            `Range Daten geladen für ${deviceId} (${startDate.toISOString()} bis ${endDate.toISOString()}): ${transformedData.length}/${total}`
        );

        res.json({
            deviceId,
            range: {
                start: startDate.toISOString(),
                end: endDate.toISOString()
            },
            limit: safeLimit,
            total,
            count: transformedData.length,
            truncated,
            points: transformedData
        });
    } catch (error) {
        console.error('Error in getHistoryRange:', error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    } finally {
        if (conn) conn.release();
    }
}

module.exports = { getAvailableDates, getDayHistory, getHistoryRange };