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
  stopUIRoutine();
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

// --- UI SEQUENCE ANIMATION ENGINE ---
const seqMap = {
  '1': ['E', 'F', '1'], // Front Down valves + Mode 1
  '2': ['G', 'H', '2'], // Rear Down valves + Mode 2
  '3': ['E', 'F', 'G', 'H', 'N', '3'], // All Down valves + All Down double arrow + Mode 3
  '4': ['A', 'B', 'C', 'D', 'M', '4']  // All Up valves + All Up double arrow + Syndicate Mode
};

let sequenceInterval = null;
let sequenceTimeout = null;
let currentAnimatedTargets = [];

function startUIRoutine(action) {
  stopUIRoutine(); // clear any existing animations
  document.body.classList.add('sequence-overdrive');
  
  // Find all DOM elements related to this sequence
  currentAnimatedTargets = seqMap[action]
    .map(act => document.querySelector(`[data-action="${act}"]`))
    .filter(el => el !== null);
  
  let isOn = true;
  currentAnimatedTargets.forEach(t => t.classList.add('is-active'));
  
  // Pulse the UI buttons every 400ms to perfectly match the ESP32 physical relays!
  sequenceInterval = setInterval(() => {
    isOn = !isOn;
    currentAnimatedTargets.forEach(t => {
      if (isOn) t.classList.add('is-active');
      else t.classList.remove('is-active');
    });
  }, 400); 
  
  sequenceTimeout = setTimeout(() => {
    stopUIRoutine();
  }, 3500);
}

function stopUIRoutine() {
  if (sequenceInterval) clearInterval(sequenceInterval);
  if (sequenceTimeout) clearTimeout(sequenceTimeout);
  sequenceInterval = null;
  sequenceTimeout = null;
  document.body.classList.remove('sequence-overdrive');
  
  // Clear red glow from all animated buttons
  currentAnimatedTargets.forEach(t => t.classList.remove('is-active'));
  currentAnimatedTargets = [];
}

// --- BULLETPROOF MOBILE MULTI-TOUCH ENGINE ---
const controlBtns = document.querySelectorAll('.control-btn');
let safetyTimeouts = {};

function handlePress(btn, e) {
  // Prevents mobile browsers from triggering fake clicks/scrolls that break multi-touch
  if (e.cancelable) e.preventDefault();
  
  // Use a dedicated data attribute to track manual touches, preventing interference with visual animations
  if (btn.dataset.touched === 'true') return;
  btn.dataset.touched = 'true';
  
  btn.classList.add('is-active');
  vibrate(20); 
  
  const action = btn.dataset.action;
  if (action) {
    queueCommand('+' + action);

    if (['1', '2', '3', '4'].includes(action)) {
      startUIRoutine(action);
    } else {
      stopUIRoutine(); // Instantly kill mode sequence visuals & ambient light if manual button is touched!
      btn.classList.add('is-active'); // Ensure the button stays visually active even if it was part of the stopped sequence
      document.body.classList.add('light-active');
      
      // Sync UI with ESP32's 5-second hardware safety limit
      if (safetyTimeouts[action]) clearTimeout(safetyTimeouts[action]);
      safetyTimeouts[action] = setTimeout(() => {
        btn.classList.remove('is-active');
        document.body.classList.remove('light-active');
        btn.dataset.touched = 'false';
      }, 5000);
    }
  }
}

function handleRelease(btn, e) {
  if (e.cancelable) e.preventDefault();
  
  btn.dataset.touched = 'false';
  
  // Only remove active state if it's NOT currently being animated by a sequence
  if (!currentAnimatedTargets.includes(btn)) {
    btn.classList.remove('is-active');
  }
  
  const action = btn.dataset.action;
  if (action) {
    if (safetyTimeouts[action]) {
      clearTimeout(safetyTimeouts[action]);
      delete safetyTimeouts[action];
    }
    
    if (!['1', '2', '3', '4'].includes(action)) {
      queueCommand('-' + action);
    }
    document.body.classList.remove('light-active');
  }
}

controlBtns.forEach(btn => {
  // Touch Events are mandatory for flawless multi-touch on iOS Safari and Chrome Android
  btn.addEventListener('touchstart', (e) => handlePress(btn, e), {passive: false});
  btn.addEventListener('touchend', (e) => handleRelease(btn, e), {passive: false});
  btn.addEventListener('touchcancel', (e) => handleRelease(btn, e), {passive: false});
  
  // Fallback to standard Mouse Events for Desktop browser testing
  btn.addEventListener('mousedown', (e) => handlePress(btn, e));
  btn.addEventListener('mouseup', (e) => handleRelease(btn, e));
  btn.addEventListener('mouseleave', (e) => handleRelease(btn, e));
});
