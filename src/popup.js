const version = document.querySelector('#version');
const launchReportButton = document.querySelector('#launch-report-button');
const status = document.querySelector('#status');

version.textContent = chrome.runtime.getManifest().version;

launchReportButton.addEventListener('click', async () => {
  launchReportButton.disabled = true;
  status.textContent = 'Opening report…';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab was found.');

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const reportLink = [...document.querySelectorAll('a')].find((link) => {
          const url = new URL(link.href, window.location.href);
          return url.pathname.toLowerCase().endsWith('/reports/customreport.aspx')
            && url.searchParams.get('ID') === '1847';
        }) || document.querySelector(
          'span[data-i18n="reportMenu:Dealership Sold Details"]'
        )?.closest('a');

        if (!reportLink) return false;
        reportLink.click();
        return true;
      }
    });

    status.textContent = result?.result
      ? 'Report opened. Select the required From and To dates.'
      : 'Report link was not found on this eLead page.';
  } catch (error) {
    status.textContent = `Could not open report: ${error.message}`;
  } finally {
    launchReportButton.disabled = false;
  }
});
