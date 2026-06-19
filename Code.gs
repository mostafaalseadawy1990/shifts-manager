// ===== 1. تهيئة الجداول (شغّلها مرة واحدة من Editor) =====
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const schema = {
    Branches: ["id", "name", "password"],
    Employees: ["id", "name", "branchId", "position", "status"],
    Shifts: ["id", "empId", "empName", "branchId", "date", "type", "start", "end", "status", "notes"],
    ShiftTypes: ["id", "name", "startTime", "endTime", "checkInStart", "checkInEnd", "isOpeningShift"],
    Leaves: ["id", "empId", "empName", "branchId", "date", "type", "quantity", "notes", "status"],
    LeaveTypes: ["id", "name", "annualBalance"],
    LeaveBalances: ["id", "empId", "year", "leaveType", "opening", "consumed", "remaining"],
    Settings: ["id", "key", "value"],
    Attendance: ["id", "empId", "empName", "branchId", "date", "day", "shiftType", "punchInTime", "punchOutTime", "start", "end", "shiftStart", "shiftEnd", "delayMin", "earlyLeaveMin", "delay", "earlyLeave", "noPunchIn", "noPunchOut", "singlePunch", "overtime", "punchCount", "notes", "status"]
  };
  for (const name in schema) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, schema[name].length).setValues([schema[name]]);
      sheet.getRange(1, 1, 1, schema[name].length).setFontWeight("bold").setBackground("#e2e8f0");
      if (name === "Settings") {
        sheet.appendRow(["S_admin", "admin_password", "admin123"]);
        sheet.appendRow(["S_supervisor", "supervisor_password", "super123"]);
        sheet.appendRow(["S_rest_type", "rest_type", "flexible"]);
        sheet.appendRow(["S_annual_adays", "annual_leave_adays", "21"]);
        sheet.appendRow(["S_annual_cdays", "annual_leave_cdays", "6"]);
      }
    } else {
      const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const needed = schema[name];
      const missing = needed.filter(h => !existing.includes(h));
      if (missing.length) {
        const lastCol = sheet.getLastColumn();
        sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
        sheet.getRange(1, lastCol + 1, 1, missing.length).setFontWeight("bold").setBackground("#e2e8f0");
      }
    }
  }
  ["Sheet1", "ورقة 1"].forEach(n => { const s = ss.getSheetByName(n); if (s && ss.getSheets().length > 1) ss.deleteSheet(s); });
}

// ===== 2. قراءة البيانات (JSONP يدعم الملفات المحلية) =====
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  SpreadsheetApp.flush();
  const data = {
    branches: getSheetData(ss, "Branches"),
    employees: getSheetData(ss, "Employees"),
    shifts: getSheetData(ss, "Shifts"),
    shiftTypes: getSheetData(ss, "ShiftTypes"),
    leaves: getSheetData(ss, "Leaves"),
    leaveTypes: getSheetData(ss, "LeaveTypes"),
    leaveBalances: getSheetData(ss, "LeaveBalances"),
    settings: getSheetData(ss, "Settings"),
    attendance: getSheetData(ss, "Attendance")
  };
  if (e.parameter.callback)
    return ContentService.createTextOutput(e.parameter.callback + '(' + JSON.stringify(data) + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ===== 3. كتابة البيانات (POST من المتصفح) =====
function doPost(e) {
  try {
    const raw = e.postData.contents;
    Logger.log('doPost raw: ' + raw.substring(0, 500));
    const params = JSON.parse(raw);
    Logger.log('doPost table=' + params.table + ' action=' + params.action);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(params.table);
    if (!sheet) {
      sheet = ss.insertSheet(params.table);
      const headers = {
        Branches: ["id","name","password"],
        Employees: ["id","name","branchId","position","status"],
        Shifts: ["id","empId","empName","branchId","date","type","start","end","status","notes"],
        ShiftTypes: ["id","name","startTime","endTime","checkInStart","checkInEnd","isOpeningShift"],
        Leaves: ["id","empId","empName","branchId","date","type","quantity","notes","status"],
        LeaveTypes: ["id","name","annualBalance"],
        LeaveBalances: ["id","empId","year","leaveType","opening","consumed","remaining"],
        Settings: ["id","key","value"],
        Attendance: ["id","empId","empName","branchId","date","day","shiftType","punchInTime","punchOutTime","start","end","shiftStart","shiftEnd","delayMin","earlyLeaveMin","delay","earlyLeave","noPunchIn","noPunchOut","singlePunch","overtime","punchCount","notes","status"]
      };
      if (headers[params.table]) sheet.appendRow(headers[params.table]);
    }

    if (params.action === "save") {
      const data = params.data, headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      Logger.log('save: table=' + params.table + ' id=' + data.id);
      if (data.id) {
        const ids = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow()-1), 1).getValues().flat();
        const idx = ids.findIndex(id => String(id) === String(data.id));
        Logger.log('save: found idx=' + idx);
        if (idx !== -1) {
          const existingRow = sheet.getRange(idx + 2, 1, 1, headers.length).getValues()[0];
          headers.forEach((h, ci) => { if (data[h] !== undefined) existingRow[ci] = data[h]; });
          sheet.getRange(idx + 2, 1, 1, headers.length).setValues([existingRow]);
        } else { sheet.appendRow(headers.map(h => data[h] !== undefined ? data[h] : "")); Logger.log('save: appended new row for ' + params.table); }
      } else sheet.appendRow(headers.map(h => data[h] !== undefined ? data[h] : ""));
    }

    if (params.action === "bulk_save") {
      const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow()-1, sheet.getLastColumn()).getValues() : [];
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const empIdx = headers.indexOf("empId"), dateIdx = headers.indexOf("date");
      
      (params.data || []).forEach(item => {
        const row = headers.map(h => item[h] !== undefined ? item[h] : "");
        let found = false;

        for (let i = 0; i < rows.length && !found; i++) {
          if (String(rows[i][0]) === String(item.id)) {
            sheet.getRange(i + 2, 1, 1, row.length).setValues([row]); rows[i] = row; found = true;
          }
        }
        if (!found && params.table === "Attendance" && empIdx >= 0 && dateIdx >= 0 && item.empId) {
          for (let i = 0; i < rows.length && !found; i++) {
            if (String(rows[i][empIdx]) === String(item.empId) && String(rows[i][dateIdx]) === String(item.date)) {
              sheet.getRange(i + 2, 1, 1, row.length).setValues([row]); rows[i] = row; found = true;
            }
          }
        }
        if (!found) { sheet.appendRow(row); rows.push(row); }
      });
    }

    if (params.action === "bulk_insert") {
      const data = params.data || [];
      if (!data.length) return ContentService.createTextOutput(JSON.stringify({status:"success", message:"No data"})).setMimeType(ContentService.MimeType.JSON);
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      let existingRows = [];
      if (params.table === "Attendance" && sheet.getLastRow() > 1) {
        existingRows = sheet.getRange(2, 1, sheet.getLastRow()-1, sheet.getLastColumn()).getValues();
      }
      const empIdIdx = headers.indexOf("empId"), dateIdx = headers.indexOf("date");
      const toInsert = [];
      data.forEach(d => {
        const row = headers.map(h => String(d[h] ?? ''));
        let skip = false;
        if (params.table === "Attendance" && empIdIdx >= 0 && dateIdx >= 0) {
          for (const r of existingRows) {
            if (String(r[empIdIdx]) === String(d.empId) && String(r[dateIdx]) === String(d.date)) { skip = true; break; }
          }
        }
        if (!skip) { toInsert.push(row); existingRows.push(row); }
      });
      if (toInsert.length) sheet.getRange(sheet.getLastRow() + 1, 1, toInsert.length, headers.length).setValues(toInsert);
      Logger.log('bulk_insert: table=' + params.table + ' inserted=' + toInsert.length + ' skipped=' + (data.length - toInsert.length));
    }

    if (params.action === "delete") {
      const ids = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow()-1), 1).getValues().flat();
      const idx = ids.findIndex(id => String(id) === String(params.id));
      if (idx !== -1) sheet.deleteRow(idx + 2);
      Logger.log('delete: table=' + params.table + ' id=' + params.id + ' found=' + (idx !== -1));
    }

    if (params.action === "bulk_delete") {
      const allIds = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow()-1), 1).getValues().flat().map(String);
      const toDel = (params.data?.ids || []).map(String);
      const rowIndices = allIds.map((id, i) => toDel.includes(id) ? i + 2 : -1).filter(r => r > 0).sort((a, b) => b - a);
      let deleted = 0, i = 0;
      while (i < rowIndices.length) {
        let start = rowIndices[i], count = 1;
        while (i + count < rowIndices.length && rowIndices[i + count] === start - count) count++;
        sheet.deleteRows(start - count + 1, count);
        deleted += count;
        i += count;
      }
      Logger.log('bulk_delete: table=' + params.table + ' deleted=' + deleted);
    }

    SpreadsheetApp.flush();

    // Verify the write for single save operations
    const verify = params.action === "save" && params.data?.id ? (() => {
      const h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const ids = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow()-1), 1).getValues().flat();
      const idx = ids.findIndex(id => String(id) === String(params.data.id));
      if (idx >= 0) {
        const vals = sheet.getRange(idx + 2, 1, 1, h.length).getValues()[0];
        const o = {};
        h.forEach((k, i) => {
          let v = vals[i];
          if (v instanceof Date) {
            v = v.getFullYear() <= 1900
              ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm')
              : Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
          }
          o[k] = v;
        });
        return o;
      }
      return null;
    })() : null;

    return ContentService.createTextOutput(JSON.stringify({status: "success", action: params.action, table: params.table, verify})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    Logger.log('doPost error: ' + err.message + ' ' + err.stack);
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}

// ===== 4. تحويل صفوف الجدول إلى Objects =====
function getSheetData(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values.shift();
  return values.map(row => {
    let o = {};
    headers.forEach((h, i) => {
      let v = row[i];
      if (v instanceof Date) {
        const yr = v.getFullYear();
        if (yr <= 1900) {
          v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
        } else {
          v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        }
      }
      o[h] = v;
    });
    return o;
  });
}
