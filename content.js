async function isUrlBlocked(url) {
  try {
    const response = await chrome.runtime.sendMessage({ 
      type: "checkUrl", 
      url: url 
    });
    return response?.blocked || false;
  } catch (err) {
    console.error('Error checking URL:', err);
    return false;
  }
}

document.addEventListener('click', async (event) => {
  const link = event.target.closest('a');
  if (!link?.href) return;

  try {
    if (await isUrlBlocked(link.href)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      alert(`Доступ к ресурсу запрещен!`);
    }
  } catch (err) {
    console.error('Click handler error:', err);
  }
}, true);