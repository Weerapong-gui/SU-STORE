const SPREADSHEET_ID = '1m-kRy-0nR0l2um4uE_sGRmpwSLmGDx42jPzQpFvne0U';
const SHEET_GID = 0;
const FALLBACK_SHEET_NAME = 'Orders';
const WEBHOOK_TOKEN = '';

const HEADERS = [
  'orderId',
  'orderNumber',
  'roundNumber',
  'sequenceNumber',
  'status',
  'paymentStatus',
  'khantokeTicket',
  'khantokeTicketClaimedAt',
  'createdAt',
  'updatedAt',
  'lastEvent',
  'lastSyncedAt',
  'productSlug',
  'productName',
  'productShortName',
  'productTagline',
  'productCategory',
  'productImage',
  'unitPrice',
  'size',
  'quantity',
  'totalAmount',
  'studentCode',
  'email',
  'fullName',
  'phone',
  'school',
  'parentPhone',
  'slipOriginalName',
  'slipStoredName',
  'slipStoredPath',
  'slipMimeType',
  'slipSize',
  'slipUploadedAt',
];

function doPost(e) {
  try {
    const payload = JSON.parse((e.postData && e.postData.contents) || '{}');

    if (WEBHOOK_TOKEN) {
      const incomingToken = String(payload.token || '').trim();
      if (incomingToken !== WEBHOOK_TOKEN) {
        return jsonResponse({ ok: false, message: 'unauthorized' });
      }
    }

    const row = payload.row || {};
    const orderId = String(row.orderId || '').trim();
    if (!orderId) {
      return jsonResponse({ ok: false, message: 'orderId is required' });
    }

    const sheet = getOrCreateSheet_();
    const values = HEADERS.map((header) => normalizeCellValue_(row[header]));
    const existingRowIndex = findOrderRowIndex_(sheet, orderId);

    if (existingRowIndex > 1) {
      sheet.getRange(existingRowIndex, 1, 1, HEADERS.length).setValues([values]);
    } else {
      sheet.appendRow(values);
    }

    return jsonResponse({
      ok: true,
      orderId,
      event: payload.event || '',
    });
  } catch (error) {
    return jsonResponse({ ok: false, message: String(error) });
  }
}

function getOrCreateSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet
    .getSheets()
    .find((candidate) => candidate.getSheetId() === SHEET_GID);

  if (!sheet) {
    sheet = spreadsheet.getSheetByName(FALLBACK_SHEET_NAME);
  }

  if (!sheet) {
    sheet = spreadsheet.insertSheet(FALLBACK_SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }

  return sheet;
}

function findOrderRowIndex_(sheet, orderId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return -1;
  }

  const orderIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let index = 0; index < orderIds.length; index += 1) {
    if (String(orderIds[index][0]).trim() === orderId) {
      return index + 2;
    }
  }

  return -1;
}

function normalizeCellValue_(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

function jsonResponse(payload) {
  const output = ContentService.createTextOutput(JSON.stringify(payload));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
