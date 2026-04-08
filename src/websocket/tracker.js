function setupWebSocket(io, deviceConfig, deviceIntervals) {
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        const devicesList = Object.keys(deviceConfig || {}).map((deviceId) => {
            const config = deviceConfig[deviceId] || {};

            return {
                id: deviceId,
                name: config.name || deviceId,
                status: config.is_active === false ? 'offline' : 'online'
            };
        });

        socket.emit('devices-list', devicesList);
        socket.emit('current-intervals', deviceIntervals || {});

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });
}

module.exports = { setupWebSocket };