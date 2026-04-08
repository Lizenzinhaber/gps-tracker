const os = require('os');

function toFiniteNumber(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function toValidDate(value) {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function calculateTrackerConnection(lastUpdateAt, expectedIntervalSeconds, batteryLevel = null) {
	const parsedInterval = Number(expectedIntervalSeconds);
	const interval = Number.isFinite(parsedInterval) ? Math.max(30, Math.floor(parsedInterval)) : 60;

	const delayThresholdSeconds = Math.max(Math.round(interval * 1.5), interval + 30);
	const disconnectThresholdSeconds = Math.max(Math.round(interval * 3), interval + 120, 180);
	const lowBattery = Number.isFinite(Number(batteryLevel)) && Number(batteryLevel) <= 20;
	const batterySavingActive = interval >= 300 || lowBattery;

	const lastDate = toValidDate(lastUpdateAt);
	if (!lastDate) {
		return {
			connected: false,
			state: 'disconnected',
			expectedIntervalSeconds: interval,
			secondsSinceLastUpdate: null,
			delayThresholdSeconds,
			disconnectThresholdSeconds,
			batterySavingActive,
			lowBattery,
			message: 'Keine Verbindung zum GPS-Tracker.'
		};
	}

	const secondsSinceLastUpdate = Math.max(0, Math.floor((Date.now() - lastDate.getTime()) / 1000));

	let state = 'connected';
	let message = 'Verbindung zum GPS-Tracker aktiv.';

	if (secondsSinceLastUpdate > disconnectThresholdSeconds) {
		state = 'disconnected';
		message = 'Keine Verbindung zum GPS-Tracker.';
	} else if (secondsSinceLastUpdate > delayThresholdSeconds) {
		state = 'delayed';
		message = 'Tracker sendet verspaetet, moeglicherweise im Sleep/Battery-Saving-Modus.';
	}

	if (state !== 'disconnected' && batterySavingActive) {
		message += ` Battery-Saving beruecksichtigt (Intervall ${interval}s).`;
	}

	return {
		connected: state === 'connected',
		state,
		expectedIntervalSeconds: interval,
		secondsSinceLastUpdate,
		delayThresholdSeconds,
		disconnectThresholdSeconds,
		batterySavingActive,
		lowBattery,
		message
	};
}

function resolveServerUrls(host, port) {
	const parsedPort = Number(port);
	const safePort = Number.isFinite(parsedPort) ? parsedPort : 3000;
	const safeHost = host || '0.0.0.0';

	if (safeHost !== '0.0.0.0' && safeHost !== '::') {
		return [`http://${safeHost}:${safePort}`];
	}

	const urls = new Set([`http://localhost:${safePort}`]);
	const interfaces = os.networkInterfaces();

	Object.values(interfaces).forEach((entries) => {
		(entries || []).forEach((entry) => {
			if (!entry || entry.internal || entry.family !== 'IPv4') return;
			urls.add(`http://${entry.address}:${safePort}`);
		});
	});

	return Array.from(urls);
}

module.exports = {
	toFiniteNumber,
	toValidDate,
	calculateTrackerConnection,
	resolveServerUrls
};
