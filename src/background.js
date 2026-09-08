// Product workflow is intentionally not inherited from another sibling.
console.info('[Cocotivity eLead Extension] service worker started');

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'export-captures') return;
  const payload = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), captures: message.captures }, null, 2);
  chrome.downloads.download({
    url: `data:application/json;charset=utf-8,${encodeURIComponent(payload)}`,
    filename: `dealership-sold-details-captures-${new Date().toISOString().slice(0, 10)}.json`,
    saveAs: true
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'export-captures') return;
  const payload = JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), captures: message.captures }, null, 2);
  chrome.downloads.download({
    url: `data:application/json;charset=utf-8,${encodeURIComponent(payload)}`,
    filename: `dealership-sold-details-captures-${new Date().toISOString().slice(0, 10)}.json`,
    saveAs: true
  });
});
