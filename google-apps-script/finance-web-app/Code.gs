const SPREADSHEET_ID = "";
const SHEET_NAME = "Entries";
const HEADERS = ["id", "title", "category", "amount", "date", "note", "type", "createdAt"];

function doGet(e) {
  return runAction_(e, true);
}

function doPost(e) {
  return runAction_(e, false);
}

function runAction_(event, allowJsonp) {
  try {
    const payload = allowJsonp ? parseQuery_(event) : parseBody_(event);
    const action = String(payload.action || "list").trim().toLowerCase();

    if (action === "add") {
      addEntry_(payload);
    } else if (action === "delete") {
      deleteEntry_(String(payload.id || "").trim());
    } else if (action !== "list") {
      throw new Error("Неизвестное действие.");
    }

    return createResponse_(
      {
        ok: true,
        entries: getEntries_(),
      },
      allowJsonp ? payload.prefix : "",
    );
  } catch (error) {
    return createResponse_(
      {
        ok: false,
        message: getErrorMessage_(error, "Не удалось обработать запрос к таблице."),
      },
      allowJsonp ? event && event.parameter && event.parameter.prefix : "",
    );
  }
}

function parseQuery_(event) {
  var parameters = (event && event.parameter) || {};
  var payload = {};

  Object.keys(parameters).forEach(function (key) {
    payload[key] = parameters[key];
  });

  return payload;
}

function parseBody_(event) {
  const rawBody =
    event &&
    event.postData &&
    typeof event.postData.contents === "string" &&
    event.postData.contents
      ? event.postData.contents
      : "{}";

  const parsed = JSON.parse(rawBody);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Тело запроса не распознано.");
  }

  return parsed;
}

function createResponse_(payload, prefix) {
  if (isValidJsonpPrefix_(prefix)) {
    return ContentService.createTextOutput(
      String(prefix) + "(" + JSON.stringify(payload) + ")",
    ).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function isValidJsonpPrefix_(prefix) {
  return typeof prefix === "string" && /^[A-Za-z0-9_$.]+$/.test(prefix);
}

function getSpreadsheet_() {
  if (!SPREADSHEET_ID) {
    throw new Error("Укажите SPREADSHEET_ID в Code.gs.");
  }

  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function ensureSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  } else {
    const headerRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    const hasHeaderMismatch = HEADERS.some(function (header, index) {
      return String(headerRow[index] || "").trim() !== header;
    });

    if (hasHeaderMismatch) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    }
  }

  return sheet;
}

function getEntries_() {
  const sheet = ensureSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return [];
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  const entries = rows
    .map(function (row) {
      return {
        id: String(row[0] || "").trim(),
        title: String(row[1] || "").trim(),
        category: String(row[2] || "").trim(),
        amount: Number(row[3] || 0),
        date: String(row[4] || "").trim(),
        note: String(row[5] || "").trim(),
        type: String(row[6] || "").trim() === "income" ? "income" : "expense",
        createdAt: String(row[7] || "").trim(),
      };
    })
    .filter(function (entry) {
      return (
        entry.id &&
        entry.title &&
        entry.date &&
        isFinite(entry.amount) &&
        entry.amount > 0
      );
    })
    .sort(function (left, right) {
      if (left.date !== right.date) {
        return left.date < right.date ? 1 : -1;
      }

      return left.createdAt < right.createdAt ? 1 : -1;
    });

  return entries;
}

function addEntry_(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object") {
    throw new Error("Запись не передана.");
  }

  var payload = normalizeEntryPayload_(rawPayload);
  var sheet = ensureSheet_();

  sheet.appendRow([
    Utilities.getUuid(),
    payload.title,
    payload.category,
    payload.amount,
    payload.date,
    payload.note,
    payload.type,
    new Date().toISOString(),
  ]);
}

function deleteEntry_(entryId) {
  if (!entryId) {
    throw new Error("Не передан идентификатор записи.");
  }

  const sheet = ensureSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    throw new Error("В таблице пока нет записей.");
  }

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (var rowIndex = 0; rowIndex < ids.length; rowIndex += 1) {
    if (String(ids[rowIndex][0] || "").trim() === entryId) {
      sheet.deleteRow(rowIndex + 2);
      return;
    }
  }

  throw new Error("Запись для удаления не найдена.");
}

function normalizeEntryPayload_(rawPayload) {
  var title = typeof rawPayload.title === "string" ? rawPayload.title.trim() : "";
  var category =
    typeof rawPayload.category === "string" && rawPayload.category.trim()
      ? rawPayload.category.trim()
      : rawPayload.type === "income"
        ? "Доходы"
        : "Другое";
  var note = typeof rawPayload.note === "string" ? rawPayload.note.trim() : "";
  var amount = Number(rawPayload.amount);
  var date =
    typeof rawPayload.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawPayload.date)
      ? rawPayload.date
      : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var type = rawPayload.type === "income" ? "income" : "expense";

  if (!title) {
    throw new Error("Введите название операции.");
  }

  if (!isFinite(amount) || amount <= 0) {
    throw new Error("Сумма должна быть больше нуля.");
  }

  return {
    title: title,
    category: category,
    amount: amount,
    date: date,
    note: note,
    type: type,
  };
}

function getErrorMessage_(error, fallbackMessage) {
  if (error && typeof error.message === "string" && error.message) {
    return error.message;
  }

  return fallbackMessage;
}
