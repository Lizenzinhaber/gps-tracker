require('dotenv').config({ quiet: true });

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');


// Config & Modules
const { loadDeviceConfig } = require('./config/database');
const { setupRoutes } = require('./routes');
const { setupWebSocket } = require('./websocket/tracker');
const { setupTTNMqtt, getTTNMqttStatus } = require('./mqtt/ttn');
const { resolveServerUrls } = require('./utils/helpers');

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

        const ttnStatus = getTTNMqttStatus();
        if (!ttnStatus.configured) {
            console.warn('TTN MQTT nicht aktiv: Konfiguration in .env unvollstaendig.');
        } else {
            console.log('TTN MQTT initialisiert, warte auf Uplink-Daten.');
        }
        
        // Server starten
        const PORT = Number(process.env.PORT || 3000);
        const HOST = process.env.HOST || '0.0.0.0';

        server.listen(PORT, HOST, () => {
            const urls = resolveServerUrls(HOST, PORT);

            console.log('GPS Tracker Server gestartet.');
            urls.forEach((url) => {
                console.log(`Server URL: ${url}`);
            });
            urls.forEach((url) => {
                console.log(`Dashboard URL: ${url}/dashboard`);
            });
            console.log('Security System aktiviert.');
            console.log('Modulare Struktur geladen.');
        });
        
    } catch (error) {
        console.error('Server Initialization Error:', error);
        process.exit(1);
    }
}

// Server starten
initializeServer();