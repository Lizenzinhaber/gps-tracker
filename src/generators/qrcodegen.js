// Speichere als generate-qr.js und führe aus: node generate-qr.js
const QRCode = require('qrcode');

const deviceData = {
  device_id: "tracker-001",
  access_token: "TKDCKGBLOB9DAZW5", // in tokengen.js generiert
  name: "Simulierter Tracker", 
  type: "main",
  description: "Haupt-GPS Tracker"
};

QRCode.toFile('tracker-001-qr.png', JSON.stringify(deviceData), {
  width: 400,
  margin: 2,
  color: { dark: '#000000', light: '#FFFFFF' }
}, (err) => {
  if (err) throw err;
  console.log('✅ QR-Code für tracker-001 generiert: tracker-001-qr.png');
});