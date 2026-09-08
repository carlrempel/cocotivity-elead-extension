const version = document.querySelector('#version');
const launchReportButton = document.querySelector('#launch-report-button');
const runReportButton = document.querySelector('#run-report-button');
const addToQueueButton = document.querySelector('#add-to-queue-button');
const clearQueueButton = document.querySelector('#clear-queue-button');
const runNextButton = document.querySelector('#run-next-button');
const captureTableButton = document.querySelector('#capture-table-button');
const copyCapturesButton = document.querySelector('#copy-captures-button');
const copyDiagnosticButton = document.querySelector('#copy-diagnostic-button');
const exportCapturesButton = document.querySelector('#export-captures-button');
const startDateInput = document.querySelector('#start-date');
const endDateInput = document.querySelector('#end-date');
const vehicleTypeInput = document.querySelector('#vehicle-type');
const status = document.querySelector('#status');
const queueElement = document.querySelector('#run-queue');
const reportChecks = [...document.querySelectorAll('[data-report-name]')];
const DEALERSHIP_SOLD_COLUMNS = [
  'City', 'Date Active', 'Date Sold', 'Deal Status', 'DMS Deal ID', 'N/U',
  'Salesperson', 'Source', 'State', 'Stock#', 'Up Type', 'Vehicle', 'VIN', 'Zip Code'
];
const PROSPECTS_ZIP_COLUMNS = ['Zip', 'City & State', 'Prospects', 'Shown', 'Sold', 'Shown %', 'Closing %'];

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

const queueLabel = (run) => `${run.reportName} — ${run.vehicleType || 'All'} — ${run.dateRange.start}–${run.dateRange.end}`;

async function getQueue() {
  const { reportQueue = [] } = await chrome.storage.local.get('reportQueue');
  return reportQueue;
}

async function renderQueue() {
  const queue = await getQueue();
  queueElement.replaceChildren();
  if (!queue.length) {
    queueElement.append(Object.assign(document.createElement('li'), { className: 'empty-queue', textContent: 'No runs queued.' }));
    return;
  }
  for (const run of queue) {
    const item = document.createElement('li');
    item.textContent = `${run.status === 'complete' ? '✓ ' : ''}${queueLabel(run)}${run.status === 'running' ? ' (running)' : ''}`;
    if (run.status === 'complete') item.className = 'complete';
    queueElement.append(item);
  }
}

renderQueue();

clearQueueButton.addEventListener('click', async () => {
  const queue = await getQueue();
  if (!queue.length) {
    status.textContent = 'The run queue is already empty.';
    return;
  }
  if (!window.confirm(`Clear ${queue.length} queued run(s)? Captured results will be kept.`)) return;
  await chrome.storage.local.remove(['reportQueue', 'currentRun']);
  await renderQueue();
  status.textContent = 'Run queue cleared. Captured results were kept.';
});

function readDates() {
  const dates = [startDateInput.value.trim(), endDateInput.value.trim()];
  if (!dates.every((date) => /^\d{2}\/\d{2}\/\d{4}$/.test(date))) throw new Error('Enter both dates as MM/DD/YYYY.');
  return dates;
}

async function executeOnActiveTab(func, args = [], allFrames = true) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab was found.');
  return chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames }, func, args });
}

const runReportInPage = async (reportId, reportName, from, to, selectedVehicleType) => {
  const getDocuments = (root, path = 'top') => {
    const documents = [{ document: root, path }];
    for (const [index, frame] of [...root.querySelectorAll('iframe')].entries()) {
      try {
        if (frame.contentDocument) documents.push(...getDocuments(frame.contentDocument, `${path}.iframe${index}`));
      } catch (_) {
        // Cross-origin frames are intentionally skipped.
      }
    }
    return documents;
  };
  const find = (predicate) => getDocuments(document).map(({ document: doc, path }) => ({ element: predicate(doc), path })).find(({ element }) => element);
  const waitFor = async (predicate, timeout = 10000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const found = find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  };
  const reportLink = (doc) => [...doc.querySelectorAll('a')].find((candidate) => {
    const url = new URL(candidate.href, window.location.href);
    const id = [...url.searchParams.entries()].find(([key]) => key.toLowerCase() === 'id')?.[1];
    return url.pathname.toLowerCase().endsWith('/reports/customreport.aspx') && id === reportId;
  }) || [...doc.querySelectorAll('span[data-i18n^="reportMenu:"]')]
    .find((span) => span.dataset.i18n.slice('reportMenu:'.length).toLowerCase() === reportName.toLowerCase())?.closest('a');

  let link = find(reportLink);
  if (!link) {
    find((doc) => doc.querySelector('span#MenuSections_SectionLabel_11[title="Reports"], span[title="Reports"]'))?.element?.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    find((doc) => doc.querySelector('#MenuSections_MenuSectionItems_11_MenuSectionLink_0[title="All"], a[title="All"]'))?.element?.click();
    link = await waitFor(reportLink, 12000);
  }
  if (!link) return { stage: 'report-link', error: 'Report link was not found.' };
  link.element.click();

  const criteria = await waitFor((doc) => doc.querySelector('input[name="start-date-input-simple"]'), 15000);
  if (!criteria) return { stage: 'criteria', error: 'Criteria fields did not appear in the report iframe.' };
  const criteriaDocument = criteria.element.ownerDocument;
  const fields = [
    criteriaDocument.querySelector('input[name="start-date-input-simple"]'),
    criteriaDocument.querySelector('input[name="end-date-input-simple"]')
  ];
  const typeDigits = (field, date) => {
    field.focus();
    field.select();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', bubbles: true }));
    field.ownerDocument.execCommand('delete');
    for (const digit of date.replaceAll('/', '')) {
      if (!field.ownerDocument.execCommand('insertText', false, digit)) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(field, `${field.value}${digit}`);
        field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: digit }));
      }
    }
    field.dispatchEvent(new Event('change', { bubbles: true }));
  };
  typeDigits(fields[0], from);
  fields[1].focus();
  typeDigits(fields[1], to);
  fields[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
  fields[1].blur();
  const parseDate = (value) => {
    const [month, day, year] = value.split('/').map(Number);
    return { month, day, year };
  };
  const setHiddenDate = (selector, value) => {
    const field = criteriaDocument.querySelector(selector);
    if (!field) return false;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const start = parseDate(from);
  const end = parseDate(to);
  setHiddenDate('#datePickerStartDate', `${start.month}/${start.day}/${start.year} 12:00:00 AM`);
  setHiddenDate('#datePickerEndDate', `${end.month}/${end.day}/${end.year} 11:59:59 PM`);
  const vehicle = criteriaDocument.querySelector('select#szNewUsed, select[name="szNewUsed"]')
    || [...criteriaDocument.querySelectorAll('select')].find((select) => {
      const label = `${select.getAttribute('parameterlabel') || ''} ${select.closest('tr')?.innerText || ''}`.toLowerCase();
      return label.includes('new / used') || label.includes('vehicle type');
    });
  if (vehicle) {
    const desiredText = selectedVehicleType ? 'new' : 'all';
    const option = [...vehicle.options].find((candidate) => {
      const text = candidate.textContent.trim().toLowerCase();
      return selectedVehicleType ? text === desiredText || candidate.value === selectedVehicleType : text.includes(desiredText) || candidate.value === '';
    });
    vehicle.value = option?.value ?? selectedVehicleType;
    vehicle.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const submit = criteriaDocument.querySelector('#btnRunReport');
  if (!submit) return { stage: 'criteria', error: 'GO button was not found in the report iframe.' };
  submit.click();
  return { stage: 'submitted', framePath: criteria.path };
};

addToQueueButton.addEventListener('click', async () => {
  try {
    const [start, end] = readDates();
    const vehicleType = vehicleTypeInput.value;
    const selected = reportChecks.filter((check) => check.checked);
    if (!selected.length) throw new Error('Select at least one report first.');
    const existing = await getQueue();
    const additions = selected.map((check) => ({
      id: crypto.randomUUID(),
      reportId: check.value,
      reportName: check.dataset.reportName,
      vehicleType: vehicleType || 'All',
      dateRange: { start, end },
      status: 'queued'
    }));
    await chrome.storage.local.set({ reportQueue: [...existing, ...additions] });
    await renderQueue();
    status.textContent = `Added ${additions.length} run(s) to the queue.`;
  } catch (error) {
    status.textContent = error.message;
  }
});

runNextButton.addEventListener('click', async () => {
  try {
    const queue = await getQueue();
    const next = queue.find((run) => run.status === 'queued');
    if (!next) throw new Error('The run queue is empty.');
    await chrome.storage.local.set({ currentRun: next, reportDates: next.dateRange, vehicleType: next.vehicleType === 'All' ? '' : next.vehicleType });
    await chrome.storage.local.set({ reportQueue: queue.map((run) => run.id === next.id ? { ...run, status: 'running' } : run) });
    await renderQueue();
    startDateInput.value = next.dateRange.start;
    endDateInput.value = next.dateRange.end;
    vehicleTypeInput.value = next.vehicleType === 'All' ? '' : next.vehicleType;
    if (next.reportId === '1847') {
      status.textContent = 'Running the next queued report…';
      runReportButton.click();
    } else {
      status.textContent = `Running ${next.reportName}…`;
      runReportButton.click();
    }
  } catch (error) {
    status.textContent = error.message;
  }
});

launchReportButton.addEventListener('click', async () => {
  launchReportButton.disabled = true;
  status.textContent = 'Opening report…';
  try {
    const { currentRun } = await chrome.storage.local.get('currentRun');
    const reportId = currentRun?.reportId || '1847';
    const reportName = currentRun?.reportName || 'Dealership Sold Details';
    const results = await executeOnActiveTab(async (selectedReportId, selectedReportName) => {
      const findReportLink = () => [...document.querySelectorAll('a')].find((candidate) => {
        const url = new URL(candidate.href, window.location.href);
        const id = [...url.searchParams.entries()].find(([key]) => key.toLowerCase() === 'id')?.[1];
        return url.pathname.toLowerCase().endsWith('/reports/customreport.aspx') && id === selectedReportId;
      }) || document.querySelector(`span[data-i18n="reportMenu:${selectedReportName}"]`)?.closest('a');
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
    }, [reportId, reportName]);
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
    let { currentRun } = await chrome.storage.local.get('currentRun');
    if (!currentRun) {
      const selected = reportChecks.filter((check) => check.checked);
      if (selected.length !== 1) throw new Error('Select exactly one report, or add multiple reports to the queue first.');
      const check = selected[0];
      currentRun = {
        id: crypto.randomUUID(),
        reportId: check.value,
        reportName: check.dataset.reportName,
      vehicleType: vehicleType || 'All',
        dateRange: { start: from, end: to },
        status: 'running'
      };
      await chrome.storage.local.set({ currentRun });
    }
    const reportId = currentRun.reportId;
    const reportName = currentRun.reportName;
    const results = await executeOnActiveTab(runReportInPage, [reportId, reportName, from, to, vehicleType], false);
    const result = results.find(({ result: value }) => value)?.result;
    status.textContent = result?.stage === 'submitted'
      ? 'Report submitted. Reopen this panel on the results page to capture it.'
      : (result?.error || 'The report runner could not complete.');
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
    const { reportDates, vehicleType, currentRun } = await chrome.storage.local.get(['reportDates', 'vehicleType', 'currentRun']);
    if (!reportDates?.start || !reportDates?.end) throw new Error('Run a report with dates before capturing.');
    const reportName = currentRun?.reportName || 'Dealership Sold Details';
    const reportId = currentRun?.reportId || (reportName === 'Prospects by ZIP Code' ? 'prospects-zip' : '1847');
    const requestedColumns = currentRun && reportId === '1847' ? DEALERSHIP_SOLD_COLUMNS : null;
    const requestedSignature = currentRun && reportId === 'prospects-zip' ? PROSPECTS_ZIP_COLUMNS : null;
    const results = await executeOnActiveTab((desiredColumns, signature) => {
      const cellValues = (row) => [...row.children].filter((cell) => /^(TH|TD)$/.test(cell.tagName)).map((cell) => cell.innerText.trim());
      const reportTable = [...document.querySelectorAll('table')].find((table) => {
        const values = [...table.querySelectorAll(':scope > tbody > tr, :scope > tr')].flatMap(cellValues);
        if (desiredColumns?.length) return table.matches('table#gvReport') && desiredColumns.some((column) => values.includes(column));
        if (signature?.length) return signature.filter((column) => values.includes(column)).length >= Math.min(4, signature.length);
        return PROSPECTS_ZIP_COLUMNS.filter((column) => values.includes(column)).length >= 4
          || values.includes('Date Active') && values.includes('Deal Status');
      });
      if (!reportTable) return null;
      const sourceRows = [...reportTable.querySelectorAll(':scope > tbody > tr, :scope > tr')];
      const headerIndex = sourceRows.findIndex((row) => {
        const values = cellValues(row);
        return values.length > 0 && (desiredColumns?.some((column) => values.includes(column)) || signature?.some((column) => values.includes(column)));
      });
      const sourceHeaders = cellValues(sourceRows[headerIndex >= 0 ? headerIndex : 0] || []);
      const columnsToCapture = desiredColumns?.length ? desiredColumns : sourceHeaders;
      const indexes = columnsToCapture.map((column) => sourceHeaders.findIndex((header) => header === column));
      const missingColumns = desiredColumns?.length ? desiredColumns.filter((_, index) => indexes[index] === -1) : [];
      const rows = sourceRows.slice(Math.max(0, headerIndex)).map(cellValues)
        .map((row) => indexes.filter((index) => index >= 0).map((index) => row[index] || ''))
        .filter((row) => row.some((value) => value !== ''));
      if ((desiredColumns?.length || signature?.length) && !indexes.some((index) => index >= 0)) return null;
      const heading = document.querySelector('#lblHeaderReportName, #lblReportName')?.innerText.trim() || '';
      return {
        rows,
        columns: columnsToCapture.filter((_, index) => indexes[index] >= 0),
        missingColumns,
        detectedReportName: heading,
        detectedReportId: heading.toLowerCase().includes('prospects by zip') ? 'prospects-zip' : heading.toLowerCase().includes('dealership sold') ? '1847' : ''
      };
    }, [requestedColumns, requestedSignature]);
    const capture = results.find(({ result }) => result?.rows)?.result;
    if (!capture) throw new Error('No matching result table was found. Select the report you just ran, then capture it.');
    const { rows, columns, missingColumns } = capture;
    const capturedReportName = capture.detectedReportName || reportName;
    const capturedReportId = capture.detectedReportId || reportId;
    const criteriaValue = currentRun?.vehicleType || vehicleType || 'All';
    const key = `${capturedReportId}|${capturedReportName}|${criteriaValue}|${reportDates.start}|${reportDates.end}`;
    const saved = await chrome.storage.local.get('reportCaptures');
    const captures = saved.reportCaptures || {};
    captures[key] = { key, reportName: capturedReportName, reportId: capturedReportId, criteria: { vehicleType: criteriaValue }, dateRange: reportDates, capturedAt: new Date().toISOString(), columns, missingColumns, rows };
    await chrome.storage.local.set({ reportCaptures: captures });
    if (currentRun) {
      const queue = await getQueue();
      await chrome.storage.local.set({ reportQueue: queue.map((run) => run.id === currentRun.id ? { ...run, status: 'complete' } : run), currentRun: null });
      await renderQueue();
    }
    status.textContent = `Captured ${Math.max(0, rows.length - 1)} report rows from gvReport${missingColumns.length ? `; missing ${missingColumns.join(', ')}` : ''}.`;
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
    ...capture.rows.filter((row) => row.some((cell) => String(cell).trim() !== '')).map((row) => row.map((cell) => String(cell).replaceAll('\t', ' ').replaceAll('\n', ' ')).join('\t'))
  ].join('\n')).join('\n\n');
}

copyCapturesButton.addEventListener('click', async () => {
  try {
    const { reportCaptures = {} } = await chrome.storage.local.get('reportCaptures');
    const captures = Object.values(reportCaptures);
    if (!captures.length) throw new Error('No captures are available to copy.');
    const latest = captures.reduce((newest, capture) => !newest || capture.capturedAt > newest.capturedAt ? capture : newest, null);
    await navigator.clipboard.writeText(capturesAsTsv([latest]));
    status.textContent = `Copied latest capture: ${latest.reportName} (${latest.dateRange.start}–${latest.dateRange.end}).`;
  } catch (error) {
    status.textContent = `Could not copy captures: ${error.message}`;
  }
});

copyDiagnosticButton.addEventListener('click', async () => {
  copyDiagnosticButton.disabled = true;
  status.textContent = 'Collecting sanitized diagnostic…';
  const exceptions = [];
  try {
    const { reportDates, vehicleType, currentRun, reportCaptures = {} } = await chrome.storage.local.get([
      'reportDates', 'vehicleType', 'currentRun', 'reportCaptures'
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
          vehicleType: 'select#szNewUsed or a select labeled New / Used',
          runButton: '#btnRunReport',
          resultTable: 'table#gvReport'
        },
        actual: {
          reportsMenu: Boolean(document.querySelector('span[title="Reports"]')),
          reportsAllMenu: Boolean(document.querySelector('#MenuSections_MenuSectionItems_11_MenuSectionLink_0[title="All"]')),
          dealershipSoldDetails: [...document.querySelectorAll('a')].some((link) => /customreport\.aspx/i.test(link.href) && /(?:^|[?&])id=1847(?:&|$)/i.test(link.href)),
          fromDate: Boolean(document.querySelector('input[name="start-date-input-simple"]')),
          toDate: Boolean(document.querySelector('input[name="end-date-input-simple"]')),
          vehicleType: Boolean(document.querySelector('select#szNewUsed, select[name="szNewUsed"]') || [...document.querySelectorAll('select')].find((select) => `${select.getAttribute('parameterlabel') || ''} ${select.closest('tr')?.innerText || ''}`.toLowerCase().match(/new \/ used|vehicle type/))),
          runButton: Boolean(document.querySelector('#btnRunReport')),
          resultTable: Boolean(document.querySelector('table#gvReport')),
          resultTableRows: document.querySelector('table#gvReport')?.querySelectorAll(':scope > tbody > tr, :scope > tr').length || 0,
          resultTablePreview: (() => {
            const table = document.querySelector('table#gvReport');
            if (!table) return null;
            const rows = [...table.querySelectorAll(':scope > tbody > tr, :scope > tr')].slice(0, 4).map((row) => [...row.children].filter((cell) => /^(TH|TD)$/.test(cell.tagName)).map((cell) => cell.innerText.trim()));
            const headers = rows[0] || [];
            const safeFields = new Set(['city', 'date active', 'date sold', 'deal status', 'dms deal id', 'n/u', 'source', 'state', 'stock#', 'up type', 'vehicle', 'vin', 'zip code', 'front', 'back', 'total', 'sale price', 'p/l', 'inventory acquired date']);
            const safeField = (header) => safeFields.has(header.toLowerCase());
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
        reportName: currentRun?.reportName || 'No active report',
        reportId: currentRun?.reportId || null,
        criteria: { vehicleType: currentRun?.vehicleType || vehicleType || 'All' },
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
