const { pool } = require('../config/database');

const ENABLE_MOCK = false;

function setupWebSocket(io, deviceConfig, deviceIntervals) {
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);
        
        // Sende aktuelle Geräteliste
        const devicesList = Object.keys(deviceConfig).map(deviceId => ({
            id: deviceId,
            name: deviceConfig[deviceId].name,
            status: deviceConfig[deviceId].is_active ? 'online' : 'offline'
        }));
        
        socket.emit('devices-list', devicesList);
        socket.emit('current-intervals', deviceIntervals);
        
        // Simuliere GPS Daten für aktive Tracker
        const trackerIntervals = {};
        
        if (ENABLE_MOCK) {
            Object.keys(deviceIntervals).forEach(deviceId => {
                if (deviceConfig[deviceId] && deviceConfig[deviceId].is_active !== false) {
                    startTrackerInterval(deviceId, socket, trackerIntervals, deviceIntervals);
                }
            });
        }
        
        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
            // Alle Intervalle stoppen
            Object.values(trackerIntervals).forEach(interval => clearInterval(interval));
        });
        
        // Intervall-Updates live verarbeiten
        socket.on('interval-update', (data) => {
            handleIntervalUpdate(data, socket, trackerIntervals, deviceConfig);
        });
    });
}

function startTrackerInterval(deviceId, socket, trackerIntervals, deviceIntervals) {
    const intervalMs = deviceIntervals[deviceId] * 1000;
    
    trackerIntervals[deviceId] = setInterval(async () => {
        const mockData = {
            deviceId: deviceId,
            latitude: (48.1351 + Math.random() * 0.01 - 0.005).toFixed(6),
            longitude: (11.5820 + Math.random() * 0.01 - 0.005).toFixed(6),
            altitude: (520 + Math.random() * 50).toFixed(1),
            timestamp: new Date(),
            battery: (80 + Math.random() * 20).toFixed(1)
        };
        
        // In Datenbank speichern
        try {
            const conn = await pool.getConnection();
            await conn.query(
                `INSERT INTO gps_data (device_id, latitude, longitude, altitude, battery_level, timestamp) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [mockData.deviceId, mockData.latitude, mockData.longitude, 
                 mockData.altitude, mockData.battery, mockData.timestamp]
            );
            conn.release();
            console.log(`GPS Daten gespeichert für ${mockData.deviceId} (Intervall: ${deviceIntervals[deviceId]}s)`);
        } catch (error) {
            console.error('Fehler beim Speichern der GPS-Daten:', error);
        }
        
        // An Client senden
        socket.emit('gps-data', {
            ...mockData,
            timestamp: mockData.timestamp.toISOString()
        });
    }, intervalMs);
    
    console.log(`GPS Interval gestartet für ${deviceId}: ${deviceIntervals[deviceId]}s`);
}

function handleIntervalUpdate(data, socket, trackerIntervals, deviceConfig) {
    const deviceId = data.deviceId;
    const newIntervalMs = data.interval * 1000;
    
    console.log(`Intervall-Update für ${deviceId}: ${data.interval}s`);
    
    // Altes Intervall stoppen
    if (trackerIntervals[deviceId]) {
        clearInterval(trackerIntervals[deviceId]);
        console.log(`Altes Intervall gestoppt für ${deviceId}`);
    }
    
    // Nur für aktive Tracker neues Intervall starten
    if (ENABLE_MOCK && deviceConfig[deviceId] && deviceConfig[deviceId].is_active !== false) {
        trackerIntervals[deviceId] = setInterval(async () => {
            const mockData = {
                deviceId: deviceId,
                latitude: (48.1351 + Math.random() * 0.01 - 0.005).toFixed(6),
                longitude: (11.5820 + Math.random() * 0.01 - 0.005).toFixed(6),
                altitude: (520 + Math.random() * 50).toFixed(1),
                timestamp: new Date(),
                battery: (80 + Math.random() * 20).toFixed(1)
            };
            
            // In Datenbank speichern
            try {
                const conn = await pool.getConnection();
                await conn.query(
                    `INSERT INTO gps_data (device_id, latitude, longitude, altitude, battery_level, timestamp) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [mockData.deviceId, mockData.latitude, mockData.longitude, 
                     mockData.altitude, mockData.battery, mockData.timestamp]
                );
                conn.release();
                console.log(`GPS Daten gespeichert für ${mockData.deviceId} (Intervall: ${data.interval}s)`);
            } catch (error) {
                console.error('Fehler beim Speichern der GPS-Daten:', error);
            }
            
            // An Client senden
            socket.emit('gps-data', {
                ...mockData,
                timestamp: mockData.timestamp.toISOString()
            });
        }, newIntervalMs);
        
        console.log(`Neues Intervall gestartet für ${deviceId}: ${data.interval}s`);
    }
}

module.exports = { setupWebSocket };