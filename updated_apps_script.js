// ===== 1. تهيئة الجداول (شغّلها مرة واحدة من Editor) =====
function setupDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const schema = {
    Branches: ["id", "name", "password"],
    Employees: ["id", "name", "branchId", "position", "status"],
    Shifts: ["id", "empId", "empName", "branchId", "date", "type", "start", "end", "status", "notes"],
    ShiftTypes: ["id", "name", "startTime", "endTime"],
    Leaves: ["id", "empId", "empName", "branchId", "date", "type", "quantity", "notes", "status"],
    LeaveTypes: ["id", "name"],
    Settings: ["key", "value"],
    Attendance: ["id", "empId", "empName", "branchId", "date", "punchInTime", "punchOutTime", "shiftType", "day", "department", "section", "position", "punchCount", "delay", "earlyLeave", "overtime", "noPunchIn", "noPunchOut", "singlePunch", "notes", "status"]
  };
  for (const name in schema) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, schema[name].length).setValues([schema[name]]);
      sheet.getRange(1, 1, 1, schema[name].length).setFontWeight("bold").setBackground("#e2e8f0");
      if (name === "Settings") { sheet.appendRow(["admin_password", "admin123"]); sheet.appendRow(["supervisor_password", "super123"]); }
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
    settings: getSheetData(ss, "Settings"),
    attendance: getSheetData(ss, "Attendance")
  };
  if (e.parameter.callback)
    return ContentService.createTextOutput(e.parameter.callback + '(' + JSON.stringify(data) + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ===== 3. كتابة البيانات (POST من المتصفح) =====
function doPost(e) {
  const params = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(params.table);
  if (!sheet) {
    sheet = ss.insertSheet(params.table);
    const headers = { Branches: ["id","name","password"], Employees: ["id","name","branchId","position","status"], Shifts: ["id","empId","empName","branchId","date","type","start","end","status","notes"], ShiftTypes: ["id","name","startTime","endTime"], Leaves: ["id","empId","empName","branchId","date","type","quantity","notes","status"], LeaveTypes: ["id","name"], Settings: ["key","value"], Attendance: ["id","empId","empName","branchId","date","punchInTime","punchOutTime","shiftType","day","department","section","position","punchCount","delay","earlyLeave","overtime","noPunchIn","noPunchOut","singlePunch","notes","status"] };
    if (headers[params.table]) sheet.appendRow(headers[params.table]);
  }

  if (params.action === "save") {
    const data = params.data, headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const row = headers.map(h => data[h] !== undefined ? data[h] : "");
    if (data.id) {
      const ids = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow()-1), 1).getValues().flat();
      const idx = ids.findIndex(id => String(id) === String(data.id));
      if (idx !== -1) sheet.getRange(idx + 2, 1, 1, row.length).setValues([row]);
      else sheet.appendRow(row);
    } else sheet.appendRow(row);
  }

  if (params.action === "bulk_save") {
    const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow()-1, sheet.getLastColumn()).getValues() : [];
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const empIdx = headers.indexOf("empId"), dateIdx = headers.indexOf("date");
    
    (params.data || []).forEach(item => {
      const row = headers.map(h => item[h] !== undefined ? item[h] : "");
      let found = false;

      // 1. فحص بالـ id
      for (let i = 0; i < rows.length && !found; i++) {
        if (String(rows[i][0]) === String(item.id)) {
          sheet.getRange(i + 2, 1, 1, row.length).setValues([row]); rows[i] = row; found = true;
        }
      }
      // 2. فحص بـ empId + date (لمنع التكرار)
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

  if (params.action === "delete") {
    const ids = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow()-1), 1).getValues().flat();
    const idx = ids.findIndex(id => String(id) === String(params.id));
    if (idx !== -1) sheet.deleteRow(idx + 2);
  }

  if (params.action === "bulk_delete") {
    const allIds = sheet.getRange(2, 1, Math.max(1, sheet.getLastRow()-1), 1).getValues().flat().map(String);
    const toDel = (params.data?.ids || []).map(String);
    const rows = allIds.map((id, i) => toDel.includes(id) ? i + 2 : -1).filter(r => r > 0).sort((a, b) => b - a);
    rows.forEach(r => sheet.deleteRow(r));
  }

  SpreadsheetApp.flush();
  return ContentService.createTextOutput(JSON.stringify({status:"success"})).setMimeType(ContentService.MimeType.JSON);
}

// ===== 4. تحويل صفوف الجدول إلى Objects =====
function getSheetData(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values.shift();
  return values.map(row => { let o = {}; headers.forEach((h, i) => o[h] = row[i]); return o; });
}
