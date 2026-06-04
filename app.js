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

function onConnected() {
  statusText.innerText = 'CONNECTED';
  statusDot.classList.add('connected');
  connectBtn.innerText = 'DISCONNECT';
  connectBtn.classList.add('active');
  
  // Sync custom delay setting to ESP32
  setTimeout(() => {
    if (typeof modeDelay !== 'undefined') queueCommand(`*D${modeDelay}`);
  }, 500);
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
  '1': ['A', 'B', 'E', 'F', '1'], // True Front Bounce: Up/Down + Mode 1
  '2': ['G', 'H', '2'], // Rear Down valves + Mode 2
  '3': ['E', 'F', 'G', 'H', 'N', '3'], // All Down valves + All Down double arrow + Mode 3
  '4': ['A', 'B', 'C', 'D', 'M', '4']  // All Up valves + All Up double arrow + Syndicate Mode
};

let sequenceInterval = null;
let sequenceTimeout = null;
let currentAnimatedTargets = [];

function startUIRoutine(action) {
  stopUIRoutine(); // clear any existing animations
  
  if (action === '1') {
    document.body.classList.add('sequence-overdrive');
    // DANCING MODE: Alternate UP and DOWN dynamically
    const upBtns = ['A', 'B'].map(act => document.querySelector(`[data-action="${act}"]`)).filter(el => el !== null);
    const downBtns = ['E', 'F'].map(act => document.querySelector(`[data-action="${act}"]`)).filter(el => el !== null);
    const modeBtn = document.querySelector(`[data-action="1"]`);
    
    currentAnimatedTargets = [...upBtns, ...downBtns, modeBtn].filter(el => el !== null);
    
    let isUp = true;
    if (modeBtn) modeBtn.classList.add('is-active');
    upBtns.forEach(t => t.classList.add('is-active'));
    downBtns.forEach(t => t.classList.remove('is-active'));
    
    sequenceInterval = setInterval(() => {
      isUp = !isUp;
      if (isUp) {
        upBtns.forEach(t => t.classList.add('is-active'));
        downBtns.forEach(t => t.classList.remove('is-active'));
      } else {
        upBtns.forEach(t => t.classList.remove('is-active'));
        downBtns.forEach(t => t.classList.add('is-active'));
      }
    }, modeDelay); // Sync to user's dynamic MS setting
    
  } else {
    // HYBRID PULSE MODE: Every 400ms
    document.body.classList.add('sequence-overdrive');
    
    // Separate the Mode button from the Valve buttons
    const modeBtn = document.querySelector(`[data-action="${action}"]`);
    const valveTargets = seqMap[action]
      .filter(act => act !== action) // Remove the mode button from the pulse list
      .map(act => document.querySelector(`[data-action="${act}"]`))
      .filter(el => el !== null);
    
    // 1. Make mode button STATIC red
    if (modeBtn) modeBtn.classList.add('is-active');
    
    // 2. Make valve buttons PULSE
    let isOn = true;
    valveTargets.forEach(t => t.classList.add('is-active'));
    
    sequenceInterval = setInterval(() => {
      isOn = !isOn;
      valveTargets.forEach(t => {
        if (isOn) t.classList.add('is-active');
        else t.classList.remove('is-active');
      });
    }, 400); 
    
    // Store all of them in currentAnimatedTargets for cleanup
    currentAnimatedTargets = [...valveTargets];
    if (modeBtn) currentAnimatedTargets.push(modeBtn);
  }
  
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
  document.body.classList.remove('light-active');
  
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
    
    if (!['1', '2', '3', '4'].includes(action) && action !== 'gyro') {
      queueCommand('-' + action);
    }
    document.body.classList.remove('light-active');
  }
}

// --- GYRO & SETTINGS ENGINE ---
const gyroBtn = document.getElementById('gyro-btn');
const passcodeModal = document.getElementById('passcode-modal');
const passcodeInput = document.getElementById('passcode-input');
const passcodeSubmit = document.getElementById('passcode-submit');
const passcodeCancel = document.getElementById('passcode-cancel');

const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');
const deadzoneSlider = document.getElementById('deadzone-slider');
const delaySlider = document.getElementById('delay-slider');
const deadzoneVal = document.getElementById('deadzone-val');
const delayVal = document.getElementById('delay-val');

let gyroDeadzone = parseInt(localStorage.getItem('gyroDeadzone')) || 15;
let modeDelay = parseInt(localStorage.getItem('modeDelay')) || 200;

deadzoneSlider.value = gyroDeadzone;
deadzoneVal.innerText = gyroDeadzone;
delaySlider.value = modeDelay;
delayVal.innerText = modeDelay;

// Settings Logic
settingsBtn.addEventListener('click', () => settingsModal.classList.remove('hidden'));
settingsClose.addEventListener('click', () => settingsModal.classList.add('hidden'));

deadzoneSlider.addEventListener('input', (e) => {
  gyroDeadzone = parseInt(e.target.value);
  deadzoneVal.innerText = gyroDeadzone;
  localStorage.setItem('gyroDeadzone', gyroDeadzone);
});

delaySlider.addEventListener('input', (e) => {
  modeDelay = parseInt(e.target.value);
  delayVal.innerText = modeDelay;
  localStorage.setItem('modeDelay', modeDelay);
  if (controlCharacteristic) queueCommand(`*D${modeDelay}`);
});

// Gyro Logic
let gyroActive = false;
let currentGyroState = { pitch: 0, roll: 0 };
let lastGyroSendTime = 0;

gyroBtn.addEventListener('click', () => {
  if (gyroActive) disableGyro();
  else {
    passcodeModal.classList.remove('hidden');
    passcodeInput.value = '';
    passcodeInput.focus();
  }
});

passcodeCancel.addEventListener('click', () => passcodeModal.classList.add('hidden'));

passcodeSubmit.addEventListener('click', () => {
  if (passcodeInput.value === '1234') {
    passcodeModal.classList.add('hidden');
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(state => {
        if (state === 'granted') enableGyro();
        else alert('Gyro permission denied by iOS.');
      }).catch(console.error);
    } else enableGyro();
  } else {
    passcodeInput.style.borderColor = 'red';
    setTimeout(() => passcodeInput.style.borderColor = 'var(--neon-red)', 500);
  }
});

function enableGyro() {
  gyroActive = true;
  gyroBtn.classList.add('is-active');
  window.addEventListener('deviceorientation', handleGyro);
}

function disableGyro() {
  gyroActive = false;
  gyroBtn.classList.remove('is-active');
  document.body.classList.remove('gyro-overdrive');
  window.removeEventListener('deviceorientation', handleGyro);
  
  // Stop all gyro valves
  if (currentGyroState.pitch === 1) { queueCommand('-K'); queueCommand('-J'); }
  else if (currentGyroState.pitch === -1) { queueCommand('-I'); queueCommand('-L'); }
  if (currentGyroState.roll === 1) { queueCommand('-A'); queueCommand('-C'); queueCommand('-F'); queueCommand('-H'); }
  else if (currentGyroState.roll === -1) { queueCommand('-B'); queueCommand('-D'); queueCommand('-E'); queueCommand('-G'); }
  
  // Clear UI
  ['A','B','C','D','E','F','G','H'].forEach(act => document.querySelector(`[data-action="${act}"]`)?.classList.remove('is-active'));
  currentGyroState = { pitch: 0, roll: 0 };
  
  // Auto-Drop Sequence
  queueCommand('+N');
  setTimeout(() => queueCommand('-N'), 3000);
}

function handleGyro(e) {
  if (!gyroActive || !controlCharacteristic) return;
  if (Date.now() - lastGyroSendTime < 50) return; // 50ms throttle
  
  const pitch = e.beta; // Front/Back tilt
  const roll = e.gamma; // Left/Right tilt
  
  let newPitchState = 0;
  if (pitch > gyroDeadzone) newPitchState = -1; // Pitch Back
  else if (pitch < -gyroDeadzone) newPitchState = 1; // Pitch Forward
  
  let newRollState = 0;
  if (roll > gyroDeadzone) newRollState = 1; // Roll Right
  else if (roll < -gyroDeadzone) newRollState = -1; // Roll Left
  
  const getPitchUI = (state) => {
    if (state === 1) return ['E', 'F', 'C', 'D']; // Front Down, Rear Up
    if (state === -1) return ['A', 'B', 'G', 'H']; // Front Up, Rear Down
    return [];
  };
  
  const getRollUI = (state) => {
    if (state === 1) return ['A', 'C', 'F', 'H']; // Left Up, Right Down
    if (state === -1) return ['B', 'D', 'E', 'G']; // Right Up, Left Down
    return [];
  };

  if (newPitchState !== currentGyroState.pitch || newRollState !== currentGyroState.roll) {
    if (newPitchState !== currentGyroState.pitch) {
       getPitchUI(currentGyroState.pitch).forEach(act => document.querySelector(`[data-action="${act}"]`)?.classList.remove('is-active'));
       
       if (currentGyroState.pitch === 1) { queueCommand('-K'); queueCommand('-J'); }
       else if (currentGyroState.pitch === -1) { queueCommand('-I'); queueCommand('-L'); }
       
       if (newPitchState === 1) { queueCommand('+K'); queueCommand('+J'); }
       else if (newPitchState === -1) { queueCommand('+I'); queueCommand('+L'); }
       
       getPitchUI(newPitchState).forEach(act => document.querySelector(`[data-action="${act}"]`)?.classList.add('is-active'));
       currentGyroState.pitch = newPitchState;
    }
    
    if (newRollState !== currentGyroState.roll) {
       getRollUI(currentGyroState.roll).forEach(act => document.querySelector(`[data-action="${act}"]`)?.classList.remove('is-active'));
       
       if (currentGyroState.roll === 1) { queueCommand('-A'); queueCommand('-C'); queueCommand('-F'); queueCommand('-H'); }
       else if (currentGyroState.roll === -1) { queueCommand('-B'); queueCommand('-D'); queueCommand('-E'); queueCommand('-G'); }
       
       if (newRollState === 1) { queueCommand('+A'); queueCommand('+C'); queueCommand('+F'); queueCommand('+H'); }
       else if (newRollState === -1) { queueCommand('+B'); queueCommand('+D'); queueCommand('+E'); queueCommand('+G'); }
       
       getRollUI(newRollState).forEach(act => document.querySelector(`[data-action="${act}"]`)?.classList.add('is-active'));
       currentGyroState.roll = newRollState;
    }
    
    if (currentGyroState.pitch !== 0 || currentGyroState.roll !== 0) {
       document.body.classList.add('gyro-overdrive');
    } else {
       document.body.classList.remove('gyro-overdrive');
    }
    
    lastGyroSendTime = Date.now();
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
