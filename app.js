const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

let bluetoothDevice = null;
let controlCharacteristic = null;
let wakeLock = null;

// Command Queue to prevent "GATT operation in progress" errors 
// which happen if you press buttons too fast.
let commandQueue = [];
let isWriting = false;

const connectBtn = document.getElementById('connect-btn');
const statusText = document.getElementById('ble-status-text');
const statusDot = document.getElementById('ble-status-dot');

// PERFORMANCE UPGRADE: Haptic feedback for physical feel
function vibrate(duration = 50) {
  if (navigator.vibrate) {
    navigator.vibrate(duration);
  }
}

// PERFORMANCE UPGRADE: Screen Wake Lock prevents phone from sleeping while driving/airing out
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Screen Wake Lock active');
      wakeLock.addEventListener('release', () => {
        console.log('Screen Wake Lock released');
      });
    } catch (err) {
      console.error(`Wake Lock error: ${err.name}, ${err.message}`);
    }
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release();
    wakeLock = null;
  }
}

async function connectBLE() {
  try {
    statusText.innerText = 'SEARCHING...';
    
    // PERFORMANCE UPGRADE: Cache device for fast-reconnect without browser popup
    if (!bluetoothDevice) {
      console.log('Requesting Bluetooth Device...');
      bluetoothDevice = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'CyberSuspension' }],
        optionalServices: [SERVICE_UUID]
      });
      bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
    }

    statusText.innerText = 'CONNECTING...';
    
    const server = await bluetoothDevice.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    controlCharacteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

    statusText.innerText = 'CONNECTED';
    statusDot.classList.add('connected');
    connectBtn.innerText = 'DISCONNECT';
    connectBtn.classList.add('active');

    console.log('Connected to ESP32!');
    requestWakeLock();
    vibrate(100);

  } catch (error) {
    console.error('Connection failed!', error);
    statusText.innerText = 'CONNECTION FAILED';
    
    // Clear device cache if connection failed entirely
    if (error.name === 'NetworkError' || error.message.includes('cancel')) {
      bluetoothDevice = null;
    }

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
  releaseWakeLock();
  commandQueue = []; // Clear queue on disconnect
}

connectBtn.addEventListener('click', () => {
  vibrate(50);
  if (controlCharacteristic) {
    // Intentional disconnect
    bluetoothDevice.gatt.disconnect();
    bluetoothDevice = null; // Clear cache so picker opens again
  } else {
    connectBLE();
  }
});

// PERFORMANCE UPGRADE: Queue commands to prevent BLE freezing
function queueCommand(command) {
  if (!controlCharacteristic) return;
  commandQueue.push(command);
  processQueue();
}

async function processQueue() {
  if (isWriting || commandQueue.length === 0) return;
  
  isWriting = true;
  const command = commandQueue.shift();
  
  try {
    const encoder = new TextEncoder();
    
    // PERFORMANCE UPGRADE: Use writeValueWithoutResponse for 10x faster transmission
    if (controlCharacteristic.properties.writeWithoutResponse) {
      await controlCharacteristic.writeValueWithoutResponse(encoder.encode(command));
    } else {
      await controlCharacteristic.writeValue(encoder.encode(command));
    }
    console.log('Sent:', command);
  } catch (error) {
    console.error('Send error:', error);
    if (!bluetoothDevice || !bluetoothDevice.gatt.connected) {
      commandQueue = [];
    }
  } finally {
    isWriting = false;
    // Process next immediately
    if (commandQueue.length > 0) {
      processQueue();
    }
  }
}

// Button Event Listeners
const controlBtns = document.querySelectorAll('.control-btn');

controlBtns.forEach(btn => {
  btn.addEventListener('pointerdown', (e) => {
    // Capture pointer prevents "stuck" buttons if finger slides off the edge
    if(e.cancelable) e.preventDefault(); 
    btn.setPointerCapture(e.pointerId); 
    
    vibrate(20); // Short tactile click
    
    const action = btn.dataset.action;
    const preset = btn.dataset.preset;
    
    if (action) {
      queueCommand(`${action}_ON`);
    } else if (preset) {
      queueCommand(`PRESET_${preset}_ON`);
    }
  });

  const handleRelease = (e) => {
    if(e.cancelable) e.preventDefault();
    if(btn.hasPointerCapture(e.pointerId)) {
      btn.releasePointerCapture(e.pointerId);
    }
    
    const action = btn.dataset.action;
    if (action) {
      queueCommand(`${action}_OFF`);
    }
  };

  btn.addEventListener('pointerup', handleRelease);
  
  // Catch interruptions (like phone calls or screen swipes) to prevent stuck valves
  btn.addEventListener('pointercancel', handleRelease);
});
