const trackerStates = new Map();

function upsertTrackerState(deviceId, patch = {}) {
    if (!deviceId) return null;

    const current = trackerStates.get(deviceId) || { deviceId };
    const next = { ...current };

    Object.entries(patch).forEach(([key, value]) => {
        if (value !== undefined) {
            next[key] = value;
        }
    });

    trackerStates.set(deviceId, next);
    return next;
}

function getTrackerState(deviceId) {
    if (!deviceId) return null;
    return trackerStates.get(deviceId) || null;
}

function getAllTrackerStates() {
    return Array.from(trackerStates.values());
}

module.exports = {
    upsertTrackerState,
    getTrackerState,
    getAllTrackerStates
};