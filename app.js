if (window.location.protocol === 'file:') {
  alert("WARNING: Web Bluetooth will NOT work when opening the file directly (file:///). You must upload this to GitHub Pages or use a local server for it to find devices!");
}

const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

let bluetoothDevice = null;
let controlCharacteristic = null;
let wakeLock = null;

let commandQueue = [];
let isWriting = false;

const connectBtn = document.getElementById('connect-btn');
const statusText = document.getElementById('ble-status-text');
const statusDot = document.getElementById('ble-status-dot');

function vibrate(duration = 50) {
  if (navigator.vibrate) {
    navigator.vibrate(duration);
  }
}

async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {});
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
    
    if (!bluetoothDevice) {
      bluetoothDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
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

    requestWakeLock();
    vibrate(100);

  } catch (error) {
    console.error('Connection failed!', error);
    statusText.innerText = 'CONNECTION FAILED';
    
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
  statusText.innerText = 'DISCONNECTED';
  statusDot.classList.remove('connected');
  connectBtn.innerText = 'CONNECT BLE';
  connectBtn.classList.remove('active');
  controlCharacteristic = null;
  releaseWakeLock();
  commandQueue = []; 
}

connectBtn.addEventListener('click', () => {
  vibrate(50);
  if (controlCharacteristic) {
    bluetoothDevice.gatt.disconnect();
    bluetoothDevice = null; 
  } else {
    connectBLE();
  }
});

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
    if (controlCharacteristic.properties.writeWithoutResponse) {
      await controlCharacteristic.writeValueWithoutResponse(encoder.encode(command));
    } else {
      await controlCharacteristic.writeValue(encoder.encode(command));
    }
  } catch (error) {
    if (!bluetoothDevice || !bluetoothDevice.gatt.connected) {
      commandQueue = [];
    }
  } finally {
    isWriting = false;
    if (commandQueue.length > 0) {
      processQueue();
    }
  }
}

const controlBtns = document.querySelectorAll('.control-btn');

controlBtns.forEach(btn => {
  btn.addEventListener('pointerdown', (e) => {
    if(e.cancelable) e.preventDefault(); 
    btn.setPointerCapture(e.pointerId); 
    
    vibrate(20); 
    
    const action = btn.dataset.action;
    if (action) {
      queueCommand(action);

      // --- AMBIENT LIGHT ENGINE ---
      // If sequence (1,2,3,4), trigger overdrive light for 3.5s
      if (['1', '2', '3', '4'].includes(action)) {
        document.body.classList.add('sequence-overdrive');
        setTimeout(() => {
          document.body.classList.remove('sequence-overdrive');
        }, 3500); 
      } else {
        // Normal button press flare
        document.body.classList.add('light-active');
      }
    }
  });

  const handleRelease = (e) => {
    if(e.cancelable) e.preventDefault();
    if(btn.hasPointerCapture(e.pointerId)) {
      btn.releasePointerCapture(e.pointerId);
    }
    
    const action = btn.dataset.action;
    if (action) {
      queueCommand('X');
      // Turn off normal flare on release
      document.body.classList.remove('light-active');
    }
  };

  btn.addEventListener('pointerup', handleRelease);
  btn.addEventListener('pointercancel', handleRelease);
});
