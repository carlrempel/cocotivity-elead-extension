const version = document.querySelector('#version');
const launchReportButton = document.querySelector('#launch-report-button');
const runReportButton = document.querySelector('#run-report-button');
const captureTableButton = document.querySelector('#capture-table-button');
const copyCapturesButton = document.querySelector('#copy-captures-button');
const copyDiagnosticButton = document.querySelector('#copy-diagnostic-button');
const exportCapturesButton = document.querySelector('#export-captures-button');
const startDateInput = document.querySelector('#start-date');
const endDateInput = document.querySelector('#end-date');
const vehicleTypeInput = document.querySelector('#vehicle-type');
const status = document.querySelector('#status');

version.textContent = chrome.runtime.getManifest().version;

const formatDate = (date) => [
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
  date.getFullYear()
].join('/');

const today = new Date();
startDateInput.value = formatDate(new Date(today.getFullYear(), today.getMonth(), 1));
endDateInput.value = formatDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));

chrome.storage.local.get('vehicleType').then(({ vehicleType }) => {
  vehicleTypeInput.value = vehicleType ?? '';
});

function readDates() {
  const dates = [startDateInput.value.trim(), endDateInput.value.trim()];
  if (!dates.every((date) => /^\d{2}\/\d{2}\/\d{4}$/.test(date))) throw new Error('Enter both dates as MM/DD/YYYY.');
  return dates;
}

async function executeOnActiveTab(func, args = []) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab was found.');
  return chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func, args });
}

launchReportButton.addEventListener('click', async () => {
  launchReportButton.disabled = true;
  status.textContent = 'Opening report…';
  try {
    const results = await executeOnActiveTab(async () => {
      const findReportLink = () => [...document.querySelectorAll('a')].find((candidate) => {
        const url = new URL(candidate.href, window.location.href);
        const id = [...url.searchParams.entries()].find(([key]) => key.toLowerCase() === 'id')?.[1];
        return url.pathname.toLowerCase().endsWith('/reports/customreport.aspx') && id === '1847';
      }) || document.querySelector('span[data-i18n="reportMenu:Dealership Sold Details"]')?.closest('a');
      let link = findReportLink();
      if (!link) {
        document.querySelector('span#MenuSections_SectionLabel_11[title="Reports"], span[title="Reports"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 200));
        document.querySelector(
          '#MenuSections_MenuSectionItems_11_MenuSectionLink_0[title="All"], a[title="All"]'
        )?.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        link = findReportLink();
      }
      if (!link) return false;
      link.click();
      return true;
    });
    status.textContent = results.some(({ result }) => result) ? 'Report opened. Reopen this panel on its criteria page.' : 'Report link was not found on this eLead page.';
  } catch (error) {
    status.textContent = `Could not open report: ${error.message}`;
  } finally {
    launchReportButton.disabled = false;
  }
});

runReportButton.addEventListener('click', async () => {
  runReportButton.disabled = true;
  status.textContent = 'Filling criteria and running report…';
  try {
    const [from, to] = readDates();
    const vehicleType = vehicleTypeInput.value;
    await chrome.storage.local.set({ reportDates: { start: from, end: to }, vehicleType });
    const results = await executeOnActiveTab((start, end, selectedType) => {
      const fields = [document.querySelector('input[name="start-date-input-simple"]'), document.querySelector('input[name="end-date-input-simple"]')];
      if (fields.some((field) => !field)) return false;
      const typeDigits = (field, date) => {
        field.focus();
        field.select();
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', bubbles: true }));
        document.execCommand('delete');
        for (const digit of date.replaceAll('/', '')) {
          if (!document.execCommand('insertText', false, digit)) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(field, `${field.value}${digit}`);
            field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: digit }));
          }
        }
        field.dispatchEvent(new Event('change', { bubbles: true }));
      };
      typeDigits(fields[0], start);
      fields[1].focus();
      typeDigits(fields[1], end);
      fields[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
      fields[1].blur();
      const vehicle = document.querySelector('select#szNewUsed, select[name="szNewUsed"]');
      if (vehicle) {
        vehicle.value = selectedType;
        vehicle.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.querySelector('#btnRunReport')?.click();
      return true;
    }, [from, to, vehicleType]);
    status.textContent = results.some(({ result }) => result) ? 'Report started. Reopen this panel on the results page to capture it.' : 'Required criteria fields were not found on this page.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    runReportButton.disabled = false;
  }
});

captureTableButton.addEventListener('click', async () => {
  captureTableButton.disabled = true;
  status.textContent = 'Capturing result table…';
  try {
    const { reportDates, vehicleType } = await chrome.storage.local.get(['reportDates', 'vehicleType']);
    if (!reportDates?.start || !reportDates?.end) throw new Error('Run a report with dates before capturing.');
    const results = await executeOnActiveTab(() => {
      const tables = [...document.querySelectorAll('table')].map((table) => [...table.querySelectorAll('tr')]).filter((rows) => rows.length).sort((a, b) => b.length - a.length);
      return tables[0]?.map((row) => [...row.querySelectorAll('th,td')].map((cell) => cell.innerText.trim())) || null;
    });
    const rows = results.find(({ result }) => Array.isArray(result))?.result;
    if (!rows) throw new Error('No result table was found on this page.');
    const key = `dealership-sold-details|vehicleType=${vehicleType || 'All'}|${reportDates.start}|${reportDates.end}`;
    const saved = await chrome.storage.local.get('reportCaptures');
    const captures = saved.reportCaptures || {};
    captures[key] = { key, reportName: 'Dealership Sold Details', criteria: { vehicleType: vehicleType || 'All' }, dateRange: reportDates, capturedAt: new Date().toISOString(), rows };
    await chrome.storage.local.set({ reportCaptures: captures });
    status.textContent = `Captured ${rows.length} rows.`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    captureTableButton.disabled = false;
  }
});

function capturesAsTsv(captures) {
  return captures.map((capture) => [
    `Report\t${capture.reportName}`,
    `Vehicle Type\t${capture.criteria.vehicleType}`,
    `From\t${capture.dateRange.start}`,
    `To\t${capture.dateRange.end}`,
    '',
    ...capture.rows.map((row) => row.map((cell) => String(cell).replaceAll('\t', ' ').replaceAll('\n', ' ')).join('\t'))
  ].join('\n')).join('\n\n');
}

copyCapturesButton.addEventListener('click', async () => {
  try {
    const { reportCaptures = {} } = await chrome.storage.local.get('reportCaptures');
    const captures = Object.values(reportCaptures);
    if (!captures.length) throw new Error('No captures are available to copy.');
    await navigator.clipboard.writeText(capturesAsTsv(captures));
    status.textContent = `Copied ${captures.length} capture(s) as spreadsheet-ready TSV.`;
  } catch (error) {
    status.textContent = `Could not copy captures: ${error.message}`;
  }
});

copyDiagnosticButton.addEventListener('click', async () => {
  copyDiagnosticButton.disabled = true;
  status.textContent = 'Collecting sanitized diagnostic…';
  const exceptions = [];
  try {
    const { reportDates, vehicleType, reportCaptures = {} } = await chrome.storage.local.get([
      'reportDates', 'vehicleType', 'reportCaptures'
    ]);
    let frameChecks = [];
    try {
      const results = await executeOnActiveTab(() => ({
        page: {
          origin: window.location.origin,
          path: window.location.pathname,
          titlePresent: Boolean(document.title)
        },
        expected: {
          reportsMenu: 'span[title="Reports"]',
          reportsAllMenu: '#MenuSections_MenuSectionItems_11_MenuSectionLink_0[title="All"]',
          dealershipSoldDetails: 'report ID 1847',
          fromDate: 'input[name="start-date-input-simple"]',
          toDate: 'input[name="end-date-input-simple"]',
          vehicleType: 'select#szNewUsed',
          runButton: '#btnRunReport',
          resultTable: 'table'
        },
        actual: {
          reportsMenu: Boolean(document.querySelector('span[title="Reports"]')),
          reportsAllMenu: Boolean(document.querySelector('#MenuSections_MenuSectionItems_11_MenuSectionLink_0[title="All"]')),
          dealershipSoldDetails: [...document.querySelectorAll('a')].some((link) => /customreport\.aspx/i.test(link.href) && /(?:^|[?&])id=1847(?:&|$)/i.test(link.href)),
          fromDate: Boolean(document.querySelector('input[name="start-date-input-simple"]')),
          toDate: Boolean(document.querySelector('input[name="end-date-input-simple"]')),
          vehicleType: Boolean(document.querySelector('select#szNewUsed, select[name="szNewUsed"]')),
          runButton: Boolean(document.querySelector('#btnRunReport')),
          resultTable: document.querySelectorAll('table').length,
          resultTableRows: Math.max(0, ...[...document.querySelectorAll('table')].map((table) => table.querySelectorAll('tr').length)),
          resultTablePreview: (() => {
            const table = [...document.querySelectorAll('table')].sort((a, b) => b.querySelectorAll('tr').length - a.querySelectorAll('tr').length)[0];
            if (!table) return null;
            const rows = [...table.querySelectorAll('tr')].slice(0, 4).map((row) => [...row.querySelectorAll('th,td')].map((cell) => cell.innerText.trim()));
            const headers = rows[0] || [];
            const safeField = (header) => /date|vehicle|stock|vin|source|type|status|sold|department|position|count|total|zip/i.test(header)
              && !/name|email|phone|mobile|contact|address/i.test(header);
            return {
              columns: headers,
              sampleRows: rows.slice(1).map((row) => row.map((value, index) => safeField(headers[index] || '') ? value : '[OMITTED]'))
            };
          })()
        }
      }));
      frameChecks = results.map(({ result }) => result).filter(Boolean);
    } catch (error) {
      exceptions.push({ stage: 'inspect-active-tab', message: error.message });
    }

    const diagnostic = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      extension: { version: chrome.runtime.getManifest().version },
      stage: 'report-launch-capture',
      scope: {
        reportName: 'Dealership Sold Details',
        reportId: '1847',
        criteria: { vehicleType: vehicleType || 'All' },
        dateRange: reportDates || null
      },
      expectedVsActual: frameChecks,
      storedCaptures: Object.values(reportCaptures).map((capture) => ({
        key: capture.key,
        reportName: capture.reportName,
        criteria: capture.criteria,
        dateRange: capture.dateRange,
        capturedAt: capture.capturedAt,
        rowCount: capture.rows?.length || 0
      })),
      outcome: frameChecks.some(({ actual }) => actual?.resultTableRows > 0) ? 'result table detected' : 'result table not detected',
      exceptions
    };
    await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
    status.textContent = 'Diagnostic copied. Paste it here for evaluation.';
  } catch (error) {
    status.textContent = `Could not copy diagnostic: ${error.message}`;
  } finally {
    copyDiagnosticButton.disabled = false;
  }
});

exportCapturesButton.addEventListener('click', async () => {
  try {
    const { reportCaptures = {} } = await chrome.storage.local.get('reportCaptures');
    const captures = Object.values(reportCaptures);
    if (!captures.length) throw new Error('No captures are available to export.');
    await chrome.runtime.sendMessage({ type: 'export-captures', captures });
    status.textContent = `Exported ${captures.length} capture(s) for ETL.`;
  } catch (error) {
    status.textContent = error.message;
  }
});
