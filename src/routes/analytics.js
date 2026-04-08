const { pool } = require('../config/database');

const RANGE_LIMIT_DEFAULT = 5000;
const RANGE_LIMIT_MAX = 20000;
const EARTH_RADIUS_METERS = 6371000;

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

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function hasValidCoordinates(point) {
    return (
        point.latitude !== null &&
        point.longitude !== null &&
        point.latitude >= -90 &&
        point.latitude <= 90 &&
        point.longitude >= -180 &&
        point.longitude <= 180
    );
}

function haversineMeters(lat1, lon1, lat2, lon2) {
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) *
        Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
}

function roundTo(value, decimals = 3) {
    if (!Number.isFinite(value)) return null;
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}

function transformRow(row) {
    return {
        deviceId: row.device_id,
        latitude: toFiniteNumber(row.latitude),
        longitude: toFiniteNumber(row.longitude),
        altitude: toFiniteNumber(row.altitude),
        battery: toFiniteNumber(row.battery),
        timestamp: row.timestamp
    };
}

async function getAnalytics(req, res) {
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

        const rows = await conn.query(
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

        const rawPoints = rows.map(transformRow);
        const validPoints = rawPoints.filter(hasValidCoordinates);

        const total = Number(totalRow?.totalCount || 0);
        const truncated = total > rawPoints.length;

        if (validPoints.length < 2) {
            return res.json({
                status: 'success',
                deviceId,
                range: {
                    start: startDate.toISOString(),
                    end: endDate.toISOString()
                },
                points: {
                    total,
                    fetched: rawPoints.length,
                    valid: validPoints.length,
                    invalid: rawPoints.length - validPoints.length,
                    truncated,
                    limit: safeLimit
                },
                metrics: null,
                track: validPoints,
                message: 'Not enough valid GPS points for analytics.'
            });
        }

        let routeDistanceMeters = 0;

        for (let i = 1; i < validPoints.length; i += 1) {
            const prev = validPoints[i - 1];
            const current = validPoints[i];

            routeDistanceMeters += haversineMeters(
                prev.latitude,
                prev.longitude,
                current.latitude,
                current.longitude
            );
        }

        const firstPoint = validPoints[0];
        const lastPoint = validPoints[validPoints.length - 1];
        const startTs = toValidDate(firstPoint.timestamp);
        const endTs = toValidDate(lastPoint.timestamp);
        const durationSeconds = startTs && endTs
            ? Math.max(0, Math.floor((endTs.getTime() - startTs.getTime()) / 1000))
            : 0;

        const airlineDistanceMeters = haversineMeters(
            firstPoint.latitude,
            firstPoint.longitude,
            lastPoint.latitude,
            lastPoint.longitude
        );

        const averageSpeedKmh = durationSeconds > 0
            ? (routeDistanceMeters / 1000) / (durationSeconds / 3600)
            : 0;

        res.json({
            status: 'success',
            deviceId,
            range: {
                start: startDate.toISOString(),
                end: endDate.toISOString()
            },
            points: {
                total,
                fetched: rawPoints.length,
                valid: validPoints.length,
                invalid: rawPoints.length - validPoints.length,
                truncated,
                limit: safeLimit
            },
            metrics: {
                airlineDistanceKm: roundTo(airlineDistanceMeters / 1000, 3),
                routeDistanceKm: roundTo(routeDistanceMeters / 1000, 3),
                averageSpeedKmh: roundTo(averageSpeedKmh, 3),
                durationSeconds,
                startTimestamp: startTs ? startTs.toISOString() : null,
                endTimestamp: endTs ? endTs.toISOString() : null
            },
            track: validPoints
        });
    } catch (error) {
        console.error('Error in getAnalytics:', error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    } finally {
        if (conn) conn.release();
    }
}

module.exports = { getAnalytics };