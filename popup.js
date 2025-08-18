const statusDiv = document.getElementById("status");
const toggle = document.getElementById("toggle");
const blockedList = document.getElementById("blockedList");
const updatedInfo = document.getElementById("updated");
const showListBtn = document.getElementById("showList");
const refreshBtn = document.getElementById("refresh");
const showLogsBtn = document.getElementById("showLogs");
const logContainer = document.getElementById("logContainer");

let currentState = {
  enabled: true,
  lastUpdate: null,
  blockedUrls: []
};

async function sendMessage(type, data = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

async function updateUI() {
  try {
    const status = await sendMessage("getStatus");
    if (status) {
      currentState = status;
      toggle.checked = status.enabled;
      statusDiv.textContent = status.enabled 
        ? "Расширение включено" 
        : "Расширение выключено";
      updatedInfo.textContent = `Последнее обновление: ${
        status.lastUpdate ? new Date(status.lastUpdate).toLocaleString() : "—"
      }`;
    }
  } catch (err) {
    console.error('UI update error:', err);
  }
}

showListBtn.addEventListener('click', async () => {
  try {
    const response = await sendMessage("getBlockedUrls");
    if (response) {
      blockedList.innerHTML = response.urls.map(rule => {
        const urlPart = rule.startsWith('||') ? rule.substring(2) : rule;
        
        try {
          const dummyUrl = 'http://' + urlPart;
          const urlObj = new URL(dummyUrl);
          
          let displayUrl = urlObj.hostname;
          if (urlObj.pathname !== '/' || urlObj.search) {
            displayUrl += urlObj.pathname;
            if (urlObj.search) {
              const maxSearchLength = 30;
              const search = urlObj.search.length > maxSearchLength 
                ? urlObj.search.substring(0, maxSearchLength) + '...' 
                : urlObj.search;
              displayUrl += search;
            }
          }
          
          return `<div class="blocked-item">• ${displayUrl}</div>`;
        } catch (e) {
          return `<div class="blocked-item">• ${urlPart}</div>`;
        }
      }).join('');

      blockedList.style.display = blockedList.style.display === 'none' ? 'block' : 'none';
      showListBtn.textContent = blockedList.style.display === 'none' 
        ? 'Показать список сайтов' 
        : 'Скрыть список сайтов';
    }
  } catch (err) {
    console.error('Blocked list error:', err);
    blockedList.innerHTML = '<div class="error">Ошибка загрузки списка</div>';
    blockedList.style.display = 'block';
  }
});

refreshBtn.addEventListener('click', async () => {
  statusDiv.textContent = "Обновление...";
  const response = await sendMessage("refresh");
  if (response?.status === "updated") {
    statusDiv.textContent = "Список обновлён";
    setTimeout(updateUI, 2000);
  } else {
    statusDiv.textContent = "Ошибка обновления";
  }
});

toggle.addEventListener("change", async () => {
  const newState = toggle.checked;
  statusDiv.textContent = newState ? "Включаем..." : "Выключаем...";
  
  const response = await sendMessage("toggle", { value: newState });
  if (response?.enabled !== undefined) {
    currentState.enabled = response.enabled;
    statusDiv.textContent = response.enabled 
      ? "Расширение включено" 
      : "Расширение выключено";
  } else {
    toggle.checked = !newState;
    statusDiv.textContent = "Ошибка!";
  }
});

if (showLogsBtn && logContainer) {
  showLogsBtn.addEventListener('click', async () => {
    try {
      const result = await chrome.storage.local.get(['logs']);
      logContainer.textContent = result.logs?.join('\n') || 'Логи пусты';
      logContainer.style.display = logContainer.style.display === 'none' ? 'block' : 'none';
      showLogsBtn.textContent = logContainer.style.display === 'none' 
        ? 'Показать логи' 
        : 'Скрыть логи';
    } catch (err) {
      logContainer.textContent = 'Ошибка загрузки логов: ' + err.message;
      logContainer.style.display = 'block';
    }
  });
}

// Инициализация
updateUI();