const connectBtn = document.getElementById('connectBtn');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const consoleLog = document.getElementById('consoleLog');

const rpmValue = document.getElementById('rpmValue');
const speedValue = document.getElementById('speedValue');
const tempValue = document.getElementById('tempValue');

// СТАНДАРТНЫЙ UUID ДЛЯ КЛАССИЧЕСКОГО BLUETOOTH (SPP) НА ANDROID
// Старый UUID 0xFFE0 заменен на международный стандарт Serial Port
const SERIAL_UUID = '00001101-0000-1000-8000-00805f9b34fb';

let bluetoothDevice;
let obdCharacteristic;
let commandQueue = [];
let isWaitingForResponse = false;
let responseBuffer = '';
let pollingInterval;

function log(message, type = 'system') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    consoleLog.appendChild(entry);
    consoleLog.scrollTop = consoleLog.scrollHeight;
}

async function connect() {
    try {
        log('Запрос устройства Bluetooth...', 'system');
        
        // Настройка фильтра для Android (ищем все устройства, но запрашиваем доступ к SPP)
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [SERIAL_UUID]
        });

        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);

        log(`Подключение к ${bluetoothDevice.name || 'OBD2'}...`, 'system');
        const server = await bluetoothDevice.gatt.connect();

        log('Получение сервиса SPP...', 'system');
        const service = await server.getPrimaryService(SERIAL_UUID);

        log('Получение характеристики...', 'system');
        // В классическом Bluetooth SPP UUID сервиса и характеристики обычно совпадают
        obdCharacteristic = await service.getCharacteristic(SERIAL_UUID);

        obdCharacteristic.addEventListener('characteristicvaluechanged', handleData);
        await obdCharacteristic.startNotifications();

        statusIndicator.classList.add('connected');
        statusText.textContent = 'Подключено';
        connectBtn.textContent = 'Отключить';
        connectBtn.classList.remove('primary-btn');
        log('Успешно подключено к адаптеру!', 'success');

        // Запуск инициализации под ВАЗ-2110
        initializeELM327();
    } catch (error) {
        log(`Ошибка подключения: ${error.message}`, 'error');
    }
}

function onDisconnected() {
    statusIndicator.classList.remove('connected');
    statusText.textContent = 'Отключено';
    connectBtn.textContent = 'Подключить OBD2';
    connectBtn.classList.add('primary-btn');
    log('Устройство отключено', 'error');
    clearInterval(pollingInterval);
    commandQueue = [];
    isWaitingForResponse = false;
}

function sendCommand(cmd) {
    commandQueue.push(cmd);
    processQueue();
}

async function processQueue() {
    if (isWaitingForResponse || commandQueue.length === 0 || !obdCharacteristic) return;

    const cmd = commandQueue.shift();
    isWaitingForResponse = true;
    responseBuffer = ''; 
    
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(cmd + '\r');
        await obdCharacteristic.writeValue(data);
        log(`-> ${cmd}`, 'tx');
        
        setTimeout(() => {
            if (isWaitingForResponse) {
                isWaitingForResponse = false;
                processQueue();
            }
        }, 1500);
    } catch (error) {
        log(`Ошибка отправки: ${error.message}`, 'error');
        isWaitingForResponse = false;
        processQueue();
    }
}

function handleData(event) {
    const value = event.target.value;
    const decoder = new TextDecoder('utf-8');
    const str = decoder.decode(value);
    
    responseBuffer += str;

    if (responseBuffer.includes('>')) {
        const fullResponse = responseBuffer.replace(/>/g, '').trim();
        if (fullResponse) {
            log(`<- ${fullResponse.replace(/\r/g, ' ')}`, 'rx');
            parseOBDResponse(fullResponse);
        }
        isWaitingForResponse = false;
        processQueue();
    }
}

function parseOBDResponse(response) {
    const cleanStr = response.replace(/[\s\r]/g, '');
    
    // Обороты (010C)
    if (cleanStr.startsWith('410C')) {
        const hex = cleanStr.substring(4, 8);
        if (hex.length === 4) {
            const rpm = parseInt(hex, 16) / 4;
            rpmValue.textContent = Math.round(rpm);
        }
    }
    // Скорость (010D)
    else if (cleanStr.startsWith('410D')) {
        const hex = cleanStr.substring(4, 6);
        if (hex.length === 2) {
            const speed = parseInt(hex, 16);
            speedValue.textContent = speed;
        }
    }
    // Температура (0105)
    else if (cleanStr.startsWith('4105')) {
        const hex = cleanStr.substring(4, 6)
        if (hex.length === 2) {
            const temp = parseInt(hex, 16) - 40;
            tempValue.textContent = temp;
        }
    }
}

function initializeELM327() {
    log('Инициализация протокола ВАЗ (K-Line)...', 'system');
    sendCommand('ATZ');   // Сброс
    sendCommand('ATE0');  // Отключить эхо
    sendCommand('ATL0');  // Отключить переносы строк
    
    // Принудительный выбор 5-го протокола (ISO 14230-4 KWP Fast Init). 
    // Именно он чаще всего открывает блоки Январь 7.2 и Bosch 7.9.7 на 2110.
    sendCommand('ATSP5'); 
    
    // Увеличиваем таймаут ожидания ответа от старого ЭБУ
    sendCommand('ATST64'); 
    
    setTimeout(startPolling, 4000);
}

function startPolling() {
    log('Запуск опроса датчиков...', 'system');
    pollingInterval = setInterval(() => {
        sendCommand('010C'); // Обороты
        sendCommand('010D'); // Скорость
        sendCommand('0105'); // Температура
    }, 1200); // Опрос чуть замедлен (1.2 сек) для стабильности K-Line
}

connectBtn.addEventListener('click', () => {
    if (bluetoothDevice && bluetoothDevice.gatt.connected) {
        bluetoothDevice.gatt.disconnect();
    } else {
        if (!navigator.bluetooth) {
            log('Web Bluetooth не поддерживается вашим браузером!', 'error');
            alert('Откройте сайт строго через Google Chrome на Android.');
            return;
        }
        connect();
    }
});
