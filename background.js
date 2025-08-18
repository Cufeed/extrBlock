const ENABLE_LOGGING = true;
const ruleIdOffset = 1000;
let blockedUrlsCache = [];
let isEnabled = true;

// Логирование
function log(...args) {
  if (ENABLE_LOGGING) {
    console.log('[BG]', ...args);
  }
}

// Нормализация URL
function normalizeUrl(rawUrl) {
  try {
    // Мусор в конце URL
    let cleanUrl = rawUrl
      .trim()
      .replace(/[^\w\-.:/?#[\]@!$&'()*+,;=%]+$/, '')
      .replace(/[;,)\]]+$/, '')
      .replace(/\s+/g, '');

    // Пропуск исключений
    const excludedDomains = ["minjust.gov.ru", "vk.com"];
    const urlObj = new URL(cleanUrl);
    const domain = urlObj.hostname.replace(/^www\./, '');
    if (excludedDomains.includes(domain)) return null;

    const hasMeaningfulPath = urlObj.pathname !== '/' || urlObj.search !== '';

    // Формирование правила
    if (hasMeaningfulPath) {
      return `||${domain}${urlObj.pathname.replace(/\/$/, '')}${urlObj.search}`;
    }
    return `||${domain}`;
  } catch (e) {
    console.warn('Invalid URL skipped:', rawUrl, e.message);
    return null;
  }
}

async function removeAllRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const oldIds = existing.map(r => r.id);
  if (oldIds.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: oldIds });
    log(`Removed ${oldIds.length} rules`);
  }
}

async function fetchRSSAndUpdateRules() {
  if (!isEnabled) {
    console.log("Расширение выключено — обновление пропущено");
    return;
  }

  try {
    const response = await fetch("https://minjust.gov.ru/ru/subscription/rss/extremist_materials/");
    const text = await response.text();

    // 1. Извлекаем URL из <link> элементов
    const linkUrls = Array.from(
      text.matchAll(/<link>(https?:\/\/[^\s<]*)<\/link>/gi),
      m => m[1]
    );

    // 2. Извлекаем URL из <description> элементов
    const descriptionUrls = [];
    const descriptionMatches = [...text.matchAll(/<description>([\s\S]*?)<\/description>/gi)];
    
    for (const match of descriptionMatches) {
      const descriptionText = match[1];
      // Ищем все URL в описании
      const urlsInDescription = descriptionText.match(/https?:\/\/[^\s"<]+/g) || [];
      descriptionUrls.push(...urlsInDescription);
    }

    // Объединяем все найденные URL
    const allUrls = [...linkUrls, ...descriptionUrls];
    log(`Found ${allUrls.length} raw URLs in RSS feed`);

    const filters = [];
    const seen = new Set();

    for (const rawUrl of allUrls) {
      try {
        let cleanUrl = rawUrl
          .trim()
          .replace(/[^\w\-.:/?#[\]@!$&'()*+,;=%]+$/, '')
          .replace(/[;,)\]]+$/, '')
          .replace(/\s+/g, '')
          .replace(/%2F/g, '/');

        if (!cleanUrl) continue;

        // Дополнение протоколов
        if (!cleanUrl.startsWith('http')) {
          cleanUrl = 'https://' + cleanUrl;
        }
        
        const urlObj = new URL(cleanUrl);
        const domain = urlObj.hostname.replace(/^www\./, '');
        
        // Пропуск ненужных доменов
        if (["minjust.gov.ru", "vk.com"].includes(domain)) continue;
        
        const hasMeaningfulPath = urlObj.pathname !== '/' || urlObj.search !== '';
        const rule = hasMeaningfulPath 
          ? `||${domain}${urlObj.pathname.replace(/\/$/, '')}${urlObj.search}`
          : `||${domain}`;

        if (!seen.has(rule)) {
          seen.add(rule);
          filters.push(rule);
        }
      } catch (e) {
        console.warn('Invalid URL skipped:', rawUrl, e.message);
      }
    }

    blockedUrlsCache = filters;
    log(`Extracted ${filters.length} unique blocking rules`);

    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = existingRules.map(r => r.id);
    
    if (oldIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: oldIds
      });
      log(`Removed ${oldIds.length} old rules`);
    }

    const newRules = filters.map((filter, index) => ({
      id: ruleIdOffset + index,
      priority: 1,
      action: { type: "block" },
      condition: {
        urlFilter: filter,
        resourceTypes: ["main_frame"]
      }
    }));

    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: newRules
    });

    await chrome.storage.local.set({
      lastUpdate: new Date().toISOString()
    });

    log(`Added ${newRules.length} new blocking rules`);

  } catch (err) {
    console.error("Ошибка загрузки RSS:", err);
  }
}



async function toggleExtension(enable) {
  isEnabled = enable;
  if (!enable) {
    await removeAllRules();
  } else {
    await fetchRSSAndUpdateRules();
  }
}

// Обработчик сообщений
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handleAsync = async () => {
    try {
      switch (request.type) {
        case "getStatus":
          const data = await chrome.storage.local.get(["lastUpdate"]);
          return { 
            enabled: isEnabled, 
            lastUpdate: data.lastUpdate || null,
            blockedUrls: blockedUrlsCache
          };

        case "getBlockedUrls":
          return { urls: blockedUrlsCache };

        case "toggle":
          await toggleExtension(request.value);
          return { enabled: isEnabled };

        case "refresh":
          await fetchRSSAndUpdateRules();
          return { status: "updated" };

        case "checkUrl":
          const urlObj = new URL(request.url);
          const rules = await chrome.declarativeNetRequest.getDynamicRules();
          
          const domainBlocked = rules.some(rule => 
            rule.condition.requestDomains?.includes(urlObj.hostname.replace(/^www\./, ''))
          );

          const pathBlocked = rules.some(rule => {
            const filter = rule.condition.urlFilter;
            return filter && new RegExp(filter.replace(/\|\|/, '^https?://(www\.)?')).test(request.url);
          });

          return { blocked: domainBlocked || pathBlocked };

        default:
          throw new Error(`Unknown request type: ${request.type}`);
      }
    } catch (err) {
      log('Message handler error:', err);
      throw err;
    }
  };

  handleAsync()
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }));

  return true;
});

// Инициализация
chrome.runtime.onInstalled.addListener(() => {
  log('Extension installed');
  fetchRSSAndUpdateRules();
  chrome.alarms.create("updateBlacklist", { periodInMinutes: 720 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "updateBlacklist") {
    log('Scheduled update');
    fetchRSSAndUpdateRules();
  }
});
