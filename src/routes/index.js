const path = require('path');
const { validateToken } = require('./auth');
const { getDevice, getAllDevices, getDeviceConfig } = require('./devices');
const { setInterval, getIntervalInfo, getAllIntervals } = require('./intervals');
const { getAvailableDates, getDayHistory } = require('./history');

function setupRoutes(app, io, deviceConfig, deviceIntervals) {
    // Auth Routes
    app.post('/api/validate-token', validateToken);
    
    // Device Routes
    app.get('/api/devices/:deviceId', getDevice);
    app.get('/api/devices', getAllDevices(deviceConfig, deviceIntervals));
    app.get('/api/device-config', getDeviceConfig(deviceConfig));
    
    // Interval Routes  
    app.post('/api/interval', (req, res) => setInterval(req, res, io, deviceIntervals));
    app.get('/api/interval-info/:deviceId', getIntervalInfo);
    app.get('/api/interval-info', getAllIntervals(deviceIntervals));
    
    // History Routes
    app.get('/api/available-dates/:deviceId', getAvailableDates);
    app.get('/api/history/:deviceId/:date', getDayHistory);
    
    // Static Routes
    app.get('/', (req, res) => {
	res.sendFile(path.join(__dirname, '../../public/index.html'));
    });

    app.get('/dashboard', (req, res) => {
	res.sendFile(path.join(__dirname, '../../public/dashboard.html'));
    });

}

module.exports = { setupRoutes };
