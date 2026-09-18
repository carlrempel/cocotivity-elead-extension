// Product workflow is intentionally not inherited from another sibling.
console.info('[Cocotivity eLead Extension] service worker started');

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'export-captures') return;
  const payload = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), captures: message.captures }, null, 2);
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0')
  ].join('-');
  chrome.downloads.download({
    url: `data:application/json;charset=utf-8,${encodeURIComponent(payload)}`,
    filename: `${message.batch ? 'etl-report-capture-batch' : 'etl-report-captures'}-${timestamp}.json`,
    saveAs: true
  });
});
