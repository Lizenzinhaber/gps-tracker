require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');


// Config & Modules
const { loadDeviceConfig } = require('./config/database');
const { setupRoutes } = require('./routes');
const { setupWebSocket } = require('./websocket/tracker');
const { setupTTNMqtt } = require('./mqtt/ttn');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Globale State Variablen
let deviceConfig = {};
let deviceIntervals = {};

// Middleware
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/bootstrap', express.static(path.join(__dirname, '../node_modules/bootstrap')));

// Server Initialisierung
async function initializeServer() {
    try {
        // Device Konfiguration laden
        const config = await loadDeviceConfig();
        deviceConfig = config.deviceConfig;
        deviceIntervals = config.deviceIntervals;
        
        console.log('Device-Konfiguration geladen:', Object.keys(deviceConfig));
        
        // Routes setup
        setupRoutes(app, io, deviceConfig, deviceIntervals);
        
        // WebSocket setup
        setupWebSocket(io, deviceConfig, deviceIntervals);

        // MQTT (TTN) setup
        setupTTNMqtt(io);
        
        // Server starten
        const PORT = process.env.PORT || 3000;
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 GPS Tracker Server läuft auf http://0.0.0.0:${PORT}`);
            console.log(`📊 Dashboard verfügbar unter http://0.0.0.0:${PORT}/dashboard`);
            console.log(`🔐 Security System aktiviert`);
            console.log(`📁 Modulare Struktur geladen`);
        });
        
            } catch (error) {
        console.error('Server Initialization Error:', error);
        process.exit(1);
    }
}

// Server starten
initializeServer();