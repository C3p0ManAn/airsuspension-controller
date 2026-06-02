const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

let bluetoothDevice;
let controlCharacteristic;

const connectBtn = document.getElementById('connect-btn');
const statusText = document.getElementById('ble-status-text');
const statusDot = document.getElementById('ble-status-dot');

async function connectBLE() {
  try {
    console.log('Requesting Bluetooth Device...');
    bluetoothDevice = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'CyberSuspension' }],
      optionalServices: [SERVICE_UUID]
    });

    bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);

    statusText.innerText = 'CONNECTING...';
    
    const server = await bluetoothDevice.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    controlCharacteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    statusText.innerText = 'CONNECTED';
    statusDot.classList.add('connected');
    connectBtn.innerText = 'DISCONNECT';
    connectBtn.classList.add('active');

    console.log('Connected to ESP32!');
  } catch (error) {
    console.error('Connection failed!', error);
    statusText.innerText = 'CONNECTION FAILED';
    setTimeout(() => {
      if (!bluetoothDevice || !bluetoothDevice.gatt.connected) {
        statusText.innerText = 'DISCONNECTED';
      }
    }, 2000);
  }
}

function onDisconnected() {
  console.log('Device Disconnected');
  statusText.innerText = 'DISCONNECTED';
  statusDot.classList.remove('connected');
  connectBtn.innerText = 'CONNECT BLE';
  connectBtn.classList.remove('active');
  controlCharacteristic = null;
}

connectBtn.addEventListener('click', () => {
  if (controlCharacteristic) {
    bluetoothDevice.gatt.disconnect();
  } else {
    connectBLE();
  }
});

// Command Sender
async function sendCommand(command) {
  if (!controlCharacteristic) {
    console.warn('Not connected to BLE device. Command ignored:', command);
    return;
  }
  try {
    const encoder = new TextEncoder();
    await controlCharacteristic.writeValue(encoder.encode(command));
    console.log('Sent:', command);
  } catch (error) {
    console.error('Send error:', error);
  }
}

// Button Event Listeners
const controlBtns = document.querySelectorAll('.control-btn, .preset-btn');

controlBtns.forEach(btn => {
  // Use pointer events for both mouse and touch
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const action = btn.dataset.action;
    const preset = btn.dataset.preset;
    
    if (action) {
      // e.g. FL_UP_ON
      sendCommand(`${action}_ON`);
    } else if (preset) {
      sendCommand(`PRESET_${preset}_ON`);
    }
  });

  btn.addEventListener('pointerup', (e) => {
    e.preventDefault();
    const action = btn.dataset.action;
    
    if (action) {
      // e.g. FL_UP_OFF
      sendCommand(`${action}_OFF`);
    }
  });

  btn.addEventListener('pointerleave', (e) => {
    e.preventDefault();
    const action = btn.dataset.action;
    
    // If the user drags finger off button, send OFF command
    if (action) {
      sendCommand(`${action}_OFF`);
    }
  });
});
