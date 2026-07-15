const connectBtn = document.getElementById('connectBtn');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const consoleLog = document.getElementById('consoleLog');

const rpmValue = document.getElementById('rpmValue');
const speedValue = document.getElementById('speedValue');
const tempValue = document.getElementById('tempValue');

// ELM327 BLE Standard UUIDs
const SERVICE_UUID = 0xFFE0;
const CHARACTERISTIC_UUID = 0xFFE1;

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
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [{ services: [SERVICE_UUID] }],
            optionalServices: [SERVICE_UUID]
        });

        bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);

        log(`Подключение к ${bluetoothDevice.name || 'OBD2'}...`, 'system');
        const server = await bluetoothDevice.gatt.connect();

        log('Получение сервиса...', 'system');
        const service = await server.getPrimaryService(SERVICE_UUID);

        log('Получение характеристики...', 'system');
        obdCharacteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

        obdCharacteristic.addEventListener('characteristicvaluechanged', handleData);
        await obdCharacteristic.startNotifications();

        statusIndicator.classList.add('connected');
        statusText.textContent = 'Подключено';
        connectBtn.textContent = 'Отключить';
        connectBtn.classList.remove('primary-btn');
        log('Успешно подключено!', 'success');

        // Инициализация ELM327
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
    responseBuffer = ''; // Очищаем буфер перед новым запросом
    
    try {
        const encoder = new TextEncoder();
        // Добавляем возврат каретки (CR) в конце команды
        const data = encoder.encode(cmd + '\r');
        await obdCharacteristic.writeValue(data);
        log(`-> ${cmd}`, 'tx');
        
        // Тайм-аут на случай, если адаптер не ответит
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

    // ELM327 завершает ответ символом '>'
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
    // Убираем пробелы и переносы
    const cleanStr = response.replace(/[\s\r]/g, '');
    
    // Обороты (010C) - Ответ: 41 0C A B -> ((A * 256) + B) / 4
    if (cleanStr.startsWith('410C')) {
        const hex = cleanStr.substring(4, 8);
        if (hex.length === 4) {
            const rpm = parseInt(hex, 16) / 4;
            rpmValue.textContent = Math.round(rpm);
        }
    }
    // Скорость (010D) - Ответ: 41 0D A -> A
    else if (cleanStr.startsWith('410D')) {
        const hex = cleanStr.substring(4, 6);
        if (hex.length === 2) {
            const speed = parseInt(hex, 16);
            speedValue.textContent = speed;
        }
    }
    // Температура (0105) - Ответ: 41 05 A -> A - 40
    else if (cleanStr.startsWith('4105')) {
        const hex = cleanStr.substring(4, 6);
        if (hex.length === 2) {
            const temp = parseInt(hex, 16) - 40;
            tempValue.textContent = temp;
        }
    }
}

function initializeELM327() {
    // Базовые команды инициализации
    sendCommand('ATZ'); // Сброс
    sendCommand('ATE0'); // Отключить эхо
    sendCommand('ATL0'); // Отключить переносы строк
    sendCommand('ATSP0'); // Автоматический поиск протокола
    
    // Начинаем опрос данных через 3 секунды после инициализации
    setTimeout(startPolling, 3000);
}

function startPolling() {
    pollingInterval = setInterval(() => {
        // Запрашиваем Обороты, Скорость, Температуру
        sendCommand('010C');
        sendCommand('010D');
        sendCommand('0105');
    }, 1000); // Опрос каждую секунду
}

connectBtn.addEventListener('click', () => {
    if (bluetoothDevice && bluetoothDevice.gatt.connected) {
        bluetoothDevice.gatt.disconnect();
    } else {
        if (!navigator.bluetooth) {
            log('Web Bluetooth API не поддерживается в этом браузере!', 'error');
            alert('Ваш браузер не поддерживает Web Bluetooth. Пожалуйста, используйте совместимый браузер (например, Bluefy для iOS).');
            return;
        }
        connect();
    }
});
