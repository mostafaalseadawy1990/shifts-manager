// ===== Utilities =====
function escapeHtml(str) { if (typeof str !== 'string') return str; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
function debounce(fn, delay) { let t; return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), delay); }; }
function getToday() { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem('darkMode', isDark ? '1' : '0');
  const btn = document.getElementById('darkModeToggle');
  if (btn) btn.textContent = isDark ? '☀️ الوضع النهاري' : '🌙 الوضع الليلي';
}
(function() { if (localStorage.getItem('darkMode') === '1') { document.body.classList.add('dark'); setTimeout(() => { const btn = document.getElementById('darkModeToggle'); if (btn) btn.textContent = '☀️ الوضع النهاري'; }, 100); } })();

// ===== State =====
const CLOUD_URL = "https://script.google.com/macros/s/AKfycbxtTFdfY73TP61WmM0S0rPqCb6g7GWWp-b082cdM65G91WwbdFCQBisCv-HJizmSsj3/exec";
let DATABASE = { branches: [], employees: [], shifts: [], shiftTypes: [], leaves: [], leaveTypes: [], leaveBalances: [], settings: [], attendance: [] };
let currentRole = null, currentBranch = null, loginType = 'branch', branchStatusFilter = '', tempCellData = null;
let _sortState = {};
let _pageSizes = { attendanceTable: 50, branchShiftsTable: 50, adminShiftsTable: 50, leavesTable: 50 };
let _visibleCounts = {};
let _confirmHandler = null;

// ===== UI Helpers =====
function showLoading(show) { document.getElementById('cloudLoading').style.display = show ? 'flex' : 'none'; }
function showToast(msg, type = 'success') {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div'); t.className = `toast toast-${type}`; t.textContent = msg;
  c.appendChild(t); setTimeout(() => t.remove(), 3000);
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function statusBadge(s) { const m = { Pending: '<span class="badge badge-pending">⏳ مراجعة</span>', Approved: '<span class="badge badge-approved">✅ معتمد</span>', Rejected: '<span class="badge badge-rejected">❌ مرفوض</span>' }; return m[s] || s; }
function formatDate(d) { if (!d) return '—'; const p = d.split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d; }
function togglePass(id) { const i = document.getElementById(id); i.type = i.type === 'password' ? 'text' : 'password'; }
function resetConfirmBtn() { _confirmHandler = null; document.getElementById('confirmBtn').textContent = 'تأكيد'; document.getElementById('confirmBtn').className = 'btn btn-danger'; }

// ===== Data Normalization =====
function timeToMinutes(t) {
  if (!t && t !== 0) return 0;
  const s = String(t).trim();
  if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
  const p = s.split(':');
  if (p.length >= 2) return (parseInt(p[0],10)||0)*60 + (parseInt(p[1],10)||0);
  return 0;
}
function minutesToTime(mins) {
  const m = Math.max(0, Math.round(mins));
  return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
}
function formatTimeString(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  if (raw instanceof Date && !isNaN(raw)) return String(raw.getHours()).padStart(2,'0')+':'+String(raw.getMinutes()).padStart(2,'0');
  const s = String(raw).trim();
  if (!s) return '';
  if (/^([01]?\d|2[0-3]):([0-5]\d)$/.test(s)) return s;
  if (/^([01]?\d|2[0-3]):([0-5]\d):([0-5]\d)$/.test(s)) return s.substring(0,5);
  const isoMatch = s.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (isoMatch) return isoMatch[1] + ':' + isoMatch[2];
  const m12 = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)/i);
  if (m12) { let h = parseInt(m12[1],10); if (m12[4].toLowerCase()==='pm' && h!==12) h+=12; if (m12[4].toLowerCase()==='am' && h===12) h=0; return String(h).padStart(2,'0')+':'+m12[2]; }
  if (/^\d+(\.\d+)?$/.test(s)) { const total = Math.round(parseFloat(s)*24*60); return minutesToTime(total); }
  if (/^\d+$/.test(s)) { const n = parseInt(s,10); if (n >= 0 && n <= 1440) return minutesToTime(n); }
  return s;
}
function normalizeDateString(rawStr) {
  if (!rawStr) return ""; if (/^\d{4}-\d{2}-\d{2}$/.test(rawStr)) return rawStr;
  try { const d = new Date(rawStr); if (isNaN(d.getTime())) return String(rawStr).split('T')[0];
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; } catch(e) { return rawStr; }
}
function addDaysToDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function normalizeAttendance(a) {
  a.date = normalizeDateString(a.date);
  a.start = formatTimeString(a.punchInTime);
  a.end = formatTimeString(a.punchOutTime);
  if (a.shiftType) {
    const stObj = DATABASE.shiftTypes.find(t => t.name === a.shiftType);
    if (stObj) {
      a.shiftStart = stObj.startTime;
      a.shiftEnd = stObj.endTime;
    }
  }
  const shS = a.shiftStart || '';
  const shE = a.shiftEnd || '';
  if (shS && shE && a.start) {
    let sS = timeToMinutes(shS), sE = timeToMinutes(shE);
    let pI = timeToMinutes(a.start), pO = a.end ? timeToMinutes(a.end) : null;
    if (sE <= sS) {
      if (pI < sS && pI <= 480) pI += 1440;
      if (pO !== null && pO < sS && pO <= 480) pO += 1440;
      sE += 1440;
    }
    a.delayMin = Math.max(0, pI - sS);
    if (pO !== null) a.earlyLeaveMin = Math.max(0, sE - pO);
    else if (a.earlyLeaveMin === undefined || a.earlyLeaveMin === null) a.earlyLeaveMin = 0;
  } else {
    if (a.delayMin === undefined || a.delayMin === null) a.delayMin = 0;
    if (a.earlyLeaveMin === undefined || a.earlyLeaveMin === null) a.earlyLeaveMin = 0;
  }
}

// كاش محلي — السحابة مصدر أساسي، localStorage للعرض الفوري ومنع التكرار
function cacheAttendance(data) {
  try { localStorage.setItem('att_data', JSON.stringify(data)); } catch(e) {}
}
function getCachedAttendance() {
  try { const d = localStorage.getItem('att_data'); return d ? JSON.parse(d) : []; } catch(e) { return []; }
}

// === Cloud Operations ===
async function cloudAction(table, action, data = null) {
  if (!CLOUD_URL || !CLOUD_URL.startsWith("http")) { showToast("نظام محلي", "warning"); return true; }
  showLoading(true);
  try {
    const payload = { table, action };
    if (data) { payload.data = data; if (!Array.isArray(data)) payload.id = data.id; }
    const res = await fetch(CLOUD_URL, {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "text/plain;charset=utf-8" }
    });
    const resText = await res.text();
    const parsed = JSON.parse(resText);
    showLoading(false);
    if (resText.includes('"status":"success"')) {
      if (['save','bulk_save','bulk_insert','delete','bulk_delete'].includes(action)) {
        await fetchCloudData(true, 6, true);
      }
      return true;
    }
    showToast("الخادم رفض الطلب: " + resText.substring(0, 200), "error"); return false;
  } catch(e) { showLoading(false); showToast("خطأ اتصال: "+e.message, "error"); return false; }
}

let _cloudSeq = 0;

function fetchCloudData(isRefresh = false, retriesLeft = 6, silentRefresh = false) {
  return new Promise(resolve => {
    if (!CLOUD_URL || !CLOUD_URL.startsWith("http")) { if(isRefresh) showToast("لا يوجد رابط", "warning"); resolve(); return; }

    if (!isRefresh && !DATABASE.attendance.length) {
      const cached = getCachedAttendance();
      if (cached.length) { DATABASE.attendance = cached; DATABASE.attendance.forEach(a => normalizeAttendance(a)); }
    }

    showLoading(true);
    const timeout = setTimeout(() => { showLoading(false); showToast("انتهت المهلة", "error"); resolve(); }, 8000);
    const mySeq = ++_cloudSeq;

    window.cloudDataCallback = function(json) {
      if (mySeq !== _cloudSeq) return;
      clearTimeout(timeout);
      if (Array.isArray(json.branches)) DATABASE.branches = json.branches;
      if (Array.isArray(json.employees)) DATABASE.employees = json.employees;
      if (json.settings !== undefined && Array.isArray(json.settings)) DATABASE.settings = json.settings;
      if (Array.isArray(json.shiftTypes)) DATABASE.shiftTypes = json.shiftTypes;
      if (Array.isArray(json.leaveTypes)) DATABASE.leaveTypes = json.leaveTypes;
      if (Array.isArray(json.leaveBalances)) DATABASE.leaveBalances = json.leaveBalances;
      if (Array.isArray(json.shifts)) DATABASE.shifts = json.shifts;
      if (Array.isArray(json.leaves)) DATABASE.leaves = json.leaves;
      if (Array.isArray(json.attendance)) DATABASE.attendance = json.attendance;

      DATABASE.shiftTypes.forEach(t => { t.startTime = formatTimeString(t.startTime); t.endTime = formatTimeString(t.endTime); t.checkInStart = formatTimeString(t.checkInStart); t.checkInEnd = formatTimeString(t.checkInEnd); });
      DATABASE.shifts.forEach(s => { s.date = normalizeDateString(s.date); s.start = formatTimeString(s.start); s.end = formatTimeString(s.end); });
      DATABASE.leaves.forEach(l => { l.date = normalizeDateString(l.date); });
      DATABASE.attendance.forEach(a => normalizeAttendance(a));

      const hasData = json.branches?.length || json.employees?.length || json.shifts?.length;
      if (!hasData && retriesLeft > 0) {
        showLoading(false);
        if (isRefresh) showToast(`تحديث... (${7 - retriesLeft}/6)`, 'warning');
        setTimeout(() => fetchCloudData(isRefresh, retriesLeft - 1, silentRefresh).then(resolve), 3000);
        return;
      }

      cacheAttendance(DATABASE.attendance);

      if (!isRefresh) { populateBranchSelect(); refreshActivePage(); }
      else { if (!silentRefresh) showToast("تم", "success"); refreshActivePage(); }

      if (isRefresh) generateNotificationsFromData();
      showLoading(false); resolve();
    };

    const s = document.createElement('script');
    s.src = CLOUD_URL + (CLOUD_URL.includes('?') ? '&' : '?') + 'callback=cloudDataCallback&_=' + Date.now();
    s.onerror = function() { if (mySeq !== _cloudSeq) return; clearTimeout(timeout); showLoading(false); showToast("خطأ في جلب البيانات - تأكد من صلاحيات النشر", "error"); resolve(); };
    document.body.appendChild(s);
    s.onload = function() { s.remove(); };
  });
}

function refreshActivePage() {
  const map = { pageCalendar: renderCalendar, pageBranchShifts: renderBranchShifts, pageAdminShifts: renderAdminShifts, pageLeaves: renderLeaves, pageEmployees: renderEmployees, pageSettings: renderSettings, pageReports: renderReport, pageAttendance: renderAttendance, pageDashboard: renderDashboard, pageNotifications: renderNotifications, pageReview: renderReview };
  Object.keys(map).forEach(id => { if (document.getElementById(id).classList.contains('active')) map[id](); });
  populateDynamicSelects();
}

// === Navigation & Page Control ===
function showPage(id) {
  const allowedPages = (NAV_CONF[currentRole] || []).map(n => n.p);
  const allAllowed = [...allowedPages, ...((NAV_MORE[currentRole] || []).map(n => n.p))];
  if (!allAllowed.includes(id)) return;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item, .bnav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  document.getElementById('nav_' + id)?.classList.add('active');
  const b = document.getElementById('bnav_' + id); if (b) b.classList.add('active');
  refreshActivePage(); document.getElementById('sidebar').classList.remove('open'); closeBnavMore();
}
function logout() { location.reload(); }
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
document.querySelector('.main-content')?.addEventListener('click', function() { document.getElementById('sidebar').classList.remove('open'); });

// === CSV Export ===
function downloadCSV(csv, filename) {
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.download = filename; a.href = URL.createObjectURL(blob);
  a.style.display = "none"; document.body.appendChild(a); a.click();
  document.body.removeChild(a);
}
function exportTableToExcel(containerId, filename) {
  const table = document.querySelector(`#${containerId} table`);
  if (!table) return showToast("لا توجد بيانات", "warning");
  const rows = table.querySelectorAll("tr");
  let csv = [];
  rows.forEach(row => {
    const cols = row.querySelectorAll("td:not(.action-btns-cell), th:not(.action-btns-cell)");
    csv.push(Array.from(cols).map(c => '"' + c.innerText.replace(/"/g, '""').trim() + '"').join(","));
  });
  downloadCSV(csv.join("\n"), filename);
}

// === Login ===
function setRole(role) {
  loginType = role;
  document.querySelectorAll('.role-tab').forEach((t,i) => t.classList.toggle('active', ['branch','supervisor','admin'][i] === role));
  ['loginFormBranch','loginFormSupervisor','loginFormAdmin'].forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('loginForm' + role.charAt(0).toUpperCase() + role.slice(1)).style.display = '';
}
function populateBranchSelect() {
  document.getElementById('branchSelect').innerHTML = '<option value="">-- اختر الفرع --</option>' + DATABASE.branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
}
function doLogin() {
  document.getElementById('loginError').style.display = 'none';
  if (loginType === 'branch') {
    const b = DATABASE.branches.find(x => String(x.id) === document.getElementById('branchSelect').value && String(x.password) === document.getElementById('branchPassword').value);
    if (!b) { document.getElementById('loginError').style.display = 'block'; return; }
    currentRole = 'branch'; currentBranch = b;
  } else if (loginType === 'supervisor') {
    const s = DATABASE.settings.find(x => x.key === 'supervisor_password');
    if (document.getElementById('supervisorPassword').value !== (s?.value || 'super123')) { document.getElementById('loginError').style.display = 'block'; return; }
    currentRole = 'supervisor';
  } else {
    const a = DATABASE.settings.find(x => x.key === 'admin_password');
    if (document.getElementById('adminPassword').value !== (a?.value || 'admin123')) { document.getElementById('loginError').style.display = 'block'; return; }
    currentRole = 'admin';
  }
  enterApp();
}

function setInitialDates() {
  const now = new Date(), y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0');
  const d1 = `${y}-${m}-01`, d2 = `${y}-${m}-${String(new Date(y, now.getMonth()+1, 0).getDate()).padStart(2,'0')}`;
  ['filterStartBranch','filterStartAdmin','filterLeaveStart','reportStart','filterAttendanceStart'].forEach(id => { const el = document.getElementById(id); if (el) el.value = d1; });
  ['filterEndBranch','filterEndAdmin','filterLeaveEnd','reportEnd','filterAttendanceEnd'].forEach(id => { const el = document.getElementById(id); if (el) el.value = d2; });
  document.getElementById('calendarMonthPicker').value = `${y}-${m}`;
  if (window.innerWidth <= 768) {
    const weekNum = Math.ceil((now.getDate() + new Date(y, now.getMonth(), 1).getDay()) / 7);
    const sel = document.getElementById('calendarWeekFilter');
    if (sel) sel.value = String(Math.min(weekNum, 5));
  }
}

function enterApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  const isAdmin = currentRole === 'admin', isApprover = isAdmin || currentRole === 'supervisor';
  document.querySelectorAll('.admin-only').forEach(el => el.style.display = isAdmin ? '' : 'none');
  document.querySelectorAll('.approver-only').forEach(el => el.style.display = isApprover ? '' : 'none');
  setInitialDates(); buildNav();
  document.getElementById('sidebarBranchName').textContent = currentRole === 'branch' ? currentBranch.name : (currentRole === 'supervisor' ? 'المشرف' : 'الإدارة العامة');
  document.getElementById('userName').textContent = currentRole === 'branch' ? currentBranch.name : (currentRole === 'supervisor' ? 'المشرف' : 'المدير / الموارد البشرية');
  document.getElementById('userRoleLabel').textContent = currentRole === 'branch' ? 'فرع' : (currentRole === 'supervisor' ? 'مشرف اعتماد' : 'إدارة النظام');
  document.getElementById('userAvatar').textContent = currentRole === 'branch' ? '🏢' : (currentRole === 'supervisor' ? '🛡️' : '👑');
  populateDynamicSelects(); buildBottomNav(); showPage('pageCalendar');
  document.getElementById('bottomNav').style.display = '';
}

const NAV_CONF = {
  branch: [{i:'📊',l:'لوحة التحكم',p:'pageDashboard'},{i:'🗓️',l:'الجدول',p:'pageCalendar'},{i:'📅',l:'الشفتات',p:'pageBranchShifts'},{i:'⏰',l:'الحضور',p:'pageAttendance'},{i:'📋',l:'مراجعة الفتح',p:'pageReview'},{i:'🏖️',l:'الإجراءات',p:'pageLeaves'},{i:'🔔',l:'الإشعارات',p:'pageNotifications'}],
  supervisor: [{i:'📊',l:'لوحة التحكم',p:'pageDashboard'},{i:'🗓️',l:'الجدول',p:'pageCalendar'},{i:'⏰',l:'الحضور',p:'pageAttendance'},{i:'📋',l:'مراجعة الفتح',p:'pageReview'},{i:'✅',l:'الاعتمادات',p:'pageAdminShifts'},{i:'🏖️',l:'الإجراءات',p:'pageLeaves'},{i:'📊',l:'التقارير',p:'pageReports'},{i:'🔔',l:'الإشعارات',p:'pageNotifications'}],
  admin: [{i:'📊',l:'لوحة التحكم',p:'pageDashboard'},{i:'🗓️',l:'جدول الشفتات',p:'pageCalendar'},{i:'⏰',l:'الحضور',p:'pageAttendance'},{i:'📋',l:'مراجعة الفتح',p:'pageReview'},{i:'✅',l:'الاعتمادات',p:'pageAdminShifts'},{i:'🏖️',l:'الإجراءات',p:'pageLeaves'},{i:'👥',l:'الموظفون',p:'pageEmployees'},{i:'📊',l:'التقارير',p:'pageReports'},{i:'⚙️',l:'الإعدادات',p:'pageSettings'},{i:'🔔',l:'الإشعارات',p:'pageNotifications'}]
};
const NAV_MORE = { admin: [{i:'📊',l:'التقارير',p:'pageReports'},{i:'⚙️',l:'الإعدادات',p:'pageSettings'}], supervisor: [{i:'📊',l:'التقارير',p:'pageReports'}] };

function buildNav() {
  loadNotifications();
  const unread = NOTIFICATIONS.length;
  document.getElementById('sidebarNav').innerHTML = NAV_CONF[currentRole].map(item => {
    const badge = item.p === 'pageNotifications' && unread > 0 ? `<span class="nav-badge">${unread > 99 ? '99+' : unread}</span>` : '';
    return `<div class="nav-item" onclick="showPage('${item.p}')" id="nav_${item.p}"><span class="nav-icon">${item.i}</span>${item.l}${badge}</div>`;
  }).join('');
}
function buildBottomNav() {
  const items = NAV_CONF[currentRole];
  document.getElementById('bottomNavInner').innerHTML = items.map(item =>
    item.p === '' ? `<button class="bnav-item" onclick="openBnavMore()" id="bnav_more"><span class="bnav-icon">📊</span>المزيد</button>`
    : `<button class="bnav-item" onclick="showPage('${item.p}')" id="bnav_${item.p}"><span class="bnav-icon">${item.i}</span>${item.l}</button>`
  ).join('');
  document.getElementById('bnavMoreMenu').innerHTML = `<div class="bnav-more-handle"></div>` +
    (NAV_MORE[currentRole] || []).map(item => `<button class="bnav-more-item" onclick="showPage('${item.p}')"><span class="bnav-mi">${item.i}</span>${item.l}</button>`).join('');
}
function openBnavMore() { document.getElementById('bnavMoreOverlay').classList.add('open'); document.getElementById('bnavMoreMenu').classList.add('open'); }
function closeBnavMore() { document.getElementById('bnavMoreOverlay').classList.remove('open'); document.getElementById('bnavMoreMenu').classList.remove('open'); }

function toggleAllCB(cls, checked) { document.querySelectorAll('.' + cls).forEach(cb => cb.checked = checked); }

// === Bulk Actions ===
async function bulkApprove(type) {
  if (currentRole === 'branch') return showToast('غير مسموح', 'error');
  const cls = type === 'shift' ? 'shift-cb' : (type === 'attendance' ? 'attendance-cb' : 'leave-cb');
  const items = Array.from(document.querySelectorAll('.' + cls + ':checked'));
  if (!items.length) return showToast('حدد عنصراً', 'warning');
  const db = type === 'shift' ? DATABASE.shifts : (type === 'attendance' ? DATABASE.attendance : DATABASE.leaves);
  const toUpdate = items.map(cb => ({ ...db.find(x => String(x.id) === String(cb.value)), status: 'Approved' })).filter(x => x.status);
  if (!toUpdate.length) return showToast('كلهم معتمدون', 'warning');
  if (await cloudAction(type === 'shift' ? 'Shifts' : (type === 'attendance' ? 'Attendance' : 'Leaves'), 'bulk_save', toUpdate)) {
    if (type === 'leave') {
      const affectedEmps = [...new Set(toUpdate.map(l => l.empId))];
      const affectedTypes = [...new Set(toUpdate.map(l => l.type))];
      for (const empId of affectedEmps) for (const lt of affectedTypes) await recalcLeaveBalance(empId, lt);
    }
    showToast('تم الاعتماد', 'success');
  }
}

let pendingDel = null;
async function bulkDelete(type) {
  if (currentRole === 'branch') return showToast('غير مسموح', 'error');
  const cls = type === 'shift' ? 'shift-cb' : (type === 'attendance' ? 'attendance-cb' : 'leave-cb');
  const cbs = document.querySelectorAll('.' + cls + ':checked');
  if (!cbs.length) return showToast('حدد عنصراً للحذف', 'warning');
  pendingDel = { ids: Array.from(cbs).map(cb => cb.value), type, isBulk: true };
  document.getElementById('confirmTitle').textContent = `حذف ${cbs.length} عنصر؟`;
  openModal('confirmModal');
}

// === Select & Filter Helpers ===
function populateDynamicSelects() {
  const shiftOpts = '<option value="">-- اختر --</option>' + DATABASE.shiftTypes.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
  document.getElementById('shiftType').innerHTML = shiftOpts;
  document.getElementById('leaveType').innerHTML = '<option value="">-- اختر --</option>' + DATABASE.leaveTypes.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
  const bOpts = '<option value="">كل الفروع</option>' + DATABASE.branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  ['calendarBranchFilter','filterBranchAdmin','empBranchFilter','filterLeaveBranch','reportBranch','filterAttendanceBranch'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = bOpts; });
}
function autoFillShiftTimes() {
  const t = DATABASE.shiftTypes.find(x => String(x.name) === String(document.getElementById('shiftType').value));
  if (t) { document.getElementById('shiftStart').value = t.startTime; document.getElementById('shiftEnd').value = t.endTime; }
}

// === Calendar ===
function getShiftColor(typeStr) {
  if (!typeStr) return { bg: '#fff', color: '#000' };
  const s = String(typeStr);
  if (s.includes('راحة') || s.includes('اجازة') || s.includes('إجازة')) return { bg: '#dcfce7', color: '#16a34a' };
  if (s.includes('صباح')) return { bg: '#e0f2fe', color: '#0369a1' };
  if (s.includes('مساء')) return { bg: '#fef3c7', color: '#d97706' };
  if (s.includes('ليل')) return { bg: '#f3e8ff', color: '#7e22ce' };
  if (s.includes('فتح')) return { bg: '#ffedd5', color: '#c2410c' };
  let hash = 0; for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  const colors = [{bg:'#fce7f3',color:'#be185d'},{bg:'#e0e7ff',color:'#4338ca'},{bg:'#ccfbf1',color:'#047857'},{bg:'#f3f4f6',color:'#334155'}];
  return colors[Math.abs(hash) % colors.length];
}
function getStatusBadgeHtml(status) {
  if (status === 'Pending') return '<span class="status-badge-small" style="background:#fef3c7;color:#d97706;">مراجعة</span>';
  if (status === 'Approved') return '<span class="status-badge-small" style="background:#dcfce7;color:#16a34a;">معتمد</span>';
  if (status === 'Rejected') return '<span class="status-badge-small" style="background:#fee2e2;color:#dc2626;">مرفوض</span>';
  return '';
}

function renderCalendar() {
  const monthVal = document.getElementById('calendarMonthPicker').value;
  if (!monthVal) return;
  const [year, month] = monthVal.split('-');
  const daysInMonth = new Date(year, month, 0).getDate();
  const selectedWeek = parseInt(document.getElementById('calendarWeekFilter').value);
  let dates = [], cWeek = 1;
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, parseInt(month)-1, i);
    if (d.getDay() === 6 && i !== 1) cWeek++;
    dates.push({ str: `${year}-${month}-${String(i).padStart(2,'0')}`, label: `${String(i).padStart(2,'0')}/${month}`, dayName: new Intl.DateTimeFormat('ar-EG', {weekday:'short'}).format(d), isWeekend: d.getDay() === 5, weekNum: cWeek });
  }
  if (selectedWeek) dates = dates.filter(d => d.weekNum === selectedWeek);
  let emps = DATABASE.employees;
  const bId = currentRole === 'branch' ? currentBranch.id : document.getElementById('calendarBranchFilter').value;
  if (bId) emps = emps.filter(e => String(e.branchId) === String(bId));

  let th = `<tr><th class="sticky-col" style="right:0">الاسم</th><th class="sticky-col" style="right:120px">الوظيفة</th>`;
  dates.forEach(d => th += `<th class="${d.isWeekend ? 'weekend-header' : ''}">${d.dayName}<br><span style="font-weight:400;font-size:10px">${d.label}</span></th>`);
  document.getElementById('calThead').innerHTML = th + '</tr>';

  if (!emps.length || !dates.length) { document.getElementById('calTbody').innerHTML = '<tr><td colspan="10">لا بيانات</td></tr>'; return; }
  let tb = '';
  emps.forEach(emp => {
    tb += `<tr><td class="sticky-col" style="right:0;width:120px;font-weight:bold">${emp.name}</td><td class="sticky-col" style="right:120px;width:90px;color:#666;font-size:11px">${emp.position || '-'}</td>`;
    dates.forEach(d => {
      const shift = DATABASE.shifts.find(s => String(s.empId) === String(emp.id) && s.date === d.str);
      const leave = DATABASE.leaves.find(l => String(l.empId) === String(emp.id) && l.date === d.str);
      let cell = '<div class="day-cell-wrapper">';
      if (shift) { const c = getShiftColor(shift.type); cell += `<div class="item-block" style="background:${c.bg};color:${c.color};" onclick="event.stopPropagation();openShiftModal('${shift.id}')">${getStatusBadgeHtml(shift.status)}<div style="margin-top:2px">${shift.type}</div><span class="item-meta">${shift.start} - ${shift.end}</span>${currentRole !== 'branch' ? `<span class="copy-shift-btn" onclick="event.stopPropagation();duplicateShift('${shift.id}')" title="نسخ ليوم تالي" style="position:absolute;top:2px;left:2px;background:#fff;color:#333;font-size:10px;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,0.2);line-height:1">📋</span>` : ''}</div>`; }
      if (leave) { const c = getShiftColor(leave.type); cell += `<div class="item-block leave-item" style="background:${c.bg};color:${c.color};" onclick="event.stopPropagation();openLeaveModal('${leave.id}')">${getStatusBadgeHtml(leave.status)}<div style="margin-top:2px;">🔹 ${leave.type}</div><span class="item-meta" style="font-weight:bold">${leave.quantity || ''}</span></div>`; }
      const att = DATABASE.attendance.find(a => String(a.empId) === String(emp.id) && a.date === d.str);
      if (att) {
        const attColor = att.delayMin > 0 ? '#ef4444' : att.earlyLeaveMin > 0 ? '#f59e0b' : '#22c55e';
        const attLabel = att.delayMin > 0 ? `⏰${att.delayMin}د` : att.earlyLeaveMin > 0 ? `🚶${att.earlyLeaveMin}د` : '✅';
        const attTitle = att.delayMin > 0 ? `تأخير ${att.delayMin} دقيقة` : att.earlyLeaveMin > 0 ? `خروج مبكر ${att.earlyLeaveMin} دقيقة` : 'حضور';
        cell += `<div class="att-badge-cal" style="position:absolute;bottom:2px;left:2px;background:${attColor};color:#fff;font-size:8px;padding:1px 4px;border-radius:3px;font-weight:700;line-height:1.2" title="${attTitle}">${attLabel}</div>`;
      }
      if (!shift || !leave) cell += `<div class="empty-cell-space" style="${shift || leave ? 'flex:0.3' : ''}" onclick="openCellActionModal('${emp.id}','${d.str}','${emp.branchId}')"></div>`;
      cell += '</div>';
      tb += `<td class="${d.isWeekend ? 'weekend-col' : ''}">${cell}</td>`;
    });
    tb += '</tr>';
  });
  document.getElementById('calTbody').innerHTML = tb;
}

function openCellActionModal(empId, dateStr, branchId) {
  if (currentRole === 'branch' && String(branchId) !== String(currentBranch.id)) return;
  tempCellData = { empId, dateStr, branchId }; openModal('cellActionModal');
}
function proceedCellAction(type) {
  closeModal('cellActionModal');
  const modal = type === 'shift' ? 'shift' : 'leave';
  if (type === 'shift') openShiftModal();
  else openLeaveModal();
  if (currentRole === 'admin') document.getElementById(modal + 'Branch').value = tempCellData.branchId;
  populateModalEmployees(modal);
  setTimeout(() => {
    document.getElementById(modal + 'Employee').value = tempCellData.empId;
    document.getElementById(modal + 'Date').value = tempCellData.dateStr;
    document.getElementById(modal + 'EndDate').value = tempCellData.dateStr;
  }, 50);
}

function populateModalEmployees(mode) {
  const idMap = { shift: 'shiftBranch', leave: 'leaveBranch', attendance: 'attendanceBranch' };
  const empMap = { shift: 'shiftEmployee', leave: 'leaveEmployee', attendance: 'attendanceEmployee' };
  const bId = currentRole === 'branch' ? currentBranch.id : document.getElementById(idMap[mode]).value;
  const emps = DATABASE.employees.filter(e => String(e.branchId) === String(bId) && e.status === 'active');
  document.getElementById(empMap[mode]).innerHTML = emps.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
}

// === Shifts ===
function openShiftModal(id = null) {
  document.getElementById('shiftEditId').value = id || '';
  if (currentRole !== 'branch') document.getElementById('shiftBranch').innerHTML = DATABASE.branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  const btnSave = document.querySelector('#shiftModal .btn-accent');
  if (id) {
    const shift = DATABASE.shifts.find(s => String(s.id) === String(id));
    if (currentRole !== 'branch') { document.getElementById('shiftBranch').value = shift.branchId; document.getElementById('shiftStatusModal').value = shift.status; }
    populateModalEmployees('shift');
    setTimeout(() => {
      document.getElementById('shiftEmployee').value = shift.empId; document.getElementById('shiftDate').value = shift.date;
      document.getElementById('shiftEndDateGroup').style.display = 'none'; document.getElementById('shiftDateLabel').textContent = 'التاريخ *';
      document.getElementById('shiftType').value = shift.type; document.getElementById('shiftStart').value = shift.start; document.getElementById('shiftEnd').value = shift.end; document.getElementById('shiftNotes').value = shift.notes;
    }, 50);
    const locked = currentRole === 'branch' && shift.status !== 'Pending';
    document.getElementById('btnDelShift').style.display = locked ? 'none' : 'inline-flex';
    btnSave.style.display = locked ? 'none' : 'inline-flex';
  } else {
    populateModalEmployees('shift');
    const today = new Date().toISOString().slice(0,10);
    document.getElementById('shiftDate').value = today; document.getElementById('shiftEndDate').value = today;
    document.getElementById('shiftEndDateGroup').style.display = 'block'; document.getElementById('shiftDateLabel').textContent = 'من تاريخ *';
    document.getElementById('shiftType').value = ''; document.getElementById('shiftStart').value = ''; document.getElementById('shiftEnd').value = ''; document.getElementById('shiftNotes').value = '';
    if (currentRole !== 'branch') document.getElementById('shiftStatusModal').value = 'Pending';
    document.getElementById('btnDelShift').style.display = 'none';
    btnSave.style.display = 'inline-flex';
  }
  openModal('shiftModal');
}

async function saveShift() {
  const empId = document.getElementById('shiftEmployee').value, bId = currentRole === 'branch' ? currentBranch.id : document.getElementById('shiftBranch').value;
  const startDate = document.getElementById('shiftDate').value, endDate = document.getElementById('shiftEndDate').value || startDate;
  const typeVal = document.getElementById('shiftType').value, startVal = document.getElementById('shiftStart').value, endVal = document.getElementById('shiftEnd').value, notes = document.getElementById('shiftNotes').value;
  if (!empId || !startDate || !typeVal) return showToast('أكمل الحقول الأساسية', 'error');
  const emp = DATABASE.employees.find(e => String(e.id) === String(empId));
  const editId = document.getElementById('shiftEditId').value;
  const statusVal = currentRole === 'branch' ? (editId ? DATABASE.shifts.find(s=>s.id===editId)?.status || 'Pending' : 'Pending') : document.getElementById('shiftStatusModal').value;
  let current = new Date(startDate), end = new Date(endDate), toSave = [];
  while (current <= end) {
    const dStr = current.toISOString().split('T')[0];
    if (!DATABASE.shifts.find(s => String(s.empId) === String(empId) && s.date === dStr && String(s.id) !== String(editId)))
      toSave.push({ id: editId || ('s'+Date.now()+Math.random().toString(36).substr(2,4)), empId, empName: emp?.name, branchId: bId, date: dStr, type: typeVal, start: startVal, end: endVal, notes, status: statusVal });
    else if (current.getTime() === new Date(startDate).getTime()) return showToast(`يوجد شفت يوم ${dStr}`, 'error');
    current.setDate(current.getDate() + 1);
  }
  if (!toSave.length) return;
  if (await cloudAction('Shifts', 'bulk_save', toSave)) {
    showToast('تم الحفظ', 'success'); closeModal('shiftModal');
  }
}

// === Leaves ===
function openLeaveModal(id = null) {
  document.getElementById('leaveEditId').value = id || '';
  if (currentRole !== 'branch') document.getElementById('leaveBranch').innerHTML = DATABASE.branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  const btnSave = document.querySelector('#leaveModal .btn-accent');
  if (id) {
    const lv = DATABASE.leaves.find(s => String(s.id) === String(id));
    if (currentRole !== 'branch') { document.getElementById('leaveBranch').value = lv.branchId; document.getElementById('leaveStatusModal').value = lv.status; }
    populateModalEmployees('leave');
    setTimeout(() => {
      document.getElementById('leaveEmployee').value = lv.empId; document.getElementById('leaveDate').value = lv.date;
      document.getElementById('leaveEndDateGroup').style.display = 'none';
      document.getElementById('leaveType').value = lv.type; document.getElementById('leaveQuantity').value = lv.quantity || ''; document.getElementById('leaveNotes').value = lv.notes;
      updateLeaveBalancePreview();
    }, 50);
    const locked = currentRole === 'branch' && lv.status !== 'Pending';
    document.getElementById('btnDelLeave').style.display = locked ? 'none' : 'inline-flex';
    btnSave.style.display = locked ? 'none' : 'inline-flex';
  } else {
    populateModalEmployees('leave');
    const today = new Date().toISOString().slice(0,10);
    document.getElementById('leaveDate').value = today; document.getElementById('leaveEndDate').value = today;
    document.getElementById('leaveEndDateGroup').style.display = 'block';
    document.getElementById('leaveType').value = ''; document.getElementById('leaveQuantity').value = ''; document.getElementById('leaveNotes').value = '';
    if (currentRole !== 'branch') document.getElementById('leaveStatusModal').value = 'Pending';
    document.getElementById('btnDelLeave').style.display = 'none';
    btnSave.style.display = 'inline-flex';
    setTimeout(() => updateLeaveBalancePreview(), 100);
  }
  openModal('leaveModal');
}

async function saveLeave() {
  const empId = document.getElementById('leaveEmployee').value, bId = currentRole === 'branch' ? currentBranch.id : document.getElementById('leaveBranch').value;
  const startDate = document.getElementById('leaveDate').value, endDate = document.getElementById('leaveEndDate').value || startDate;
  const typeVal = document.getElementById('leaveType').value, quantityVal = document.getElementById('leaveQuantity').value, notes = document.getElementById('leaveNotes').value;
  if (!empId || !startDate || !typeVal || !quantityVal) return showToast('أكمل الحقول', 'error');
  if (typeVal !== 'أعياد') {
    const days = Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
    const bal = getLeaveBalance(empId, typeVal);
    if (bal.remaining < days) return showToast(`الرصيد المتبقي (${bal.remaining}) أقل من المطلوب (${days})`, 'error');
  }
  const emp = DATABASE.employees.find(e => String(e.id) === String(empId));
  const editId = document.getElementById('leaveEditId').value;
  const statusVal = currentRole === 'branch' ? (editId ? DATABASE.leaves.find(s=>s.id===editId)?.status || 'Pending' : 'Pending') : document.getElementById('leaveStatusModal').value;
  let current = new Date(startDate), end = new Date(endDate), toSave = [];
  while (current <= end) {
    const dStr = current.toISOString().split('T')[0];
    toSave.push({ id: editId || ('lv'+Date.now()+Math.random().toString(36).substr(2,4)), empId, empName: emp?.name, branchId: bId, date: dStr, type: typeVal, quantity: quantityVal, notes, status: statusVal });
    current.setDate(current.getDate() + 1);
  }
  if (await cloudAction('Leaves', 'bulk_save', toSave)) {
    await recalcLeaveBalance(empId, typeVal);
    showToast('تم الحفظ', 'success'); closeModal('leaveModal');
  }
}

// === Leave Balance ===
function getYear() { return new Date().getFullYear(); }
function getEmpHireYear() { return null; }

function calcOpeningBalance(empId, leaveTypeName) {
  const year = getYear();
  const lt = DATABASE.leaveTypes.find(t => t.name === leaveTypeName);
  if (!lt || lt.name === 'أعياد') return 0;
  const annual = parseInt(lt.annualBalance) || 0;
  if (annual <= 0) return 0;
  const emp = DATABASE.employees.find(e => String(e.id) === String(empId));
  if (!emp || !emp.hireDate) return annual;
  const hireMonth = new Date(emp.hireDate).getMonth() + 1;
  if (hireMonth <= 1) return annual;
  const monthsRemaining = 12 - hireMonth + 1;
  return Math.round((annual / 12) * monthsRemaining * 10) / 10;
}

function calcConsumed(empId, leaveTypeName) {
  const year = getYear();
  return DATABASE.leaves.filter(l =>
    String(l.empId) === String(empId) &&
    l.type === leaveTypeName &&
    l.status === 'Approved' &&
    l.date && l.date.startsWith(String(year))
  ).length;
}

function getLeaveBalance(empId, leaveTypeName) {
  const opening = calcOpeningBalance(empId, leaveTypeName);
  const consumed = calcConsumed(empId, leaveTypeName);
  return { opening, consumed, remaining: Math.max(0, opening - consumed) };
}

function updateLeaveBalancePreview() {
  const empId = document.getElementById('leaveEmployee').value;
  const typeName = document.getElementById('leaveType').value;
  const preview = document.getElementById('leaveBalancePreview');
  if (!empId || !typeName || typeName === 'أعياد') { preview.style.display = 'none'; return; }
  const bal = getLeaveBalance(empId, typeName);
  document.getElementById('lbOpening').textContent = bal.opening;
  document.getElementById('lbConsumed').textContent = bal.consumed;
  const remEl = document.getElementById('lbRemaining');
  remEl.textContent = bal.remaining;
  remEl.style.color = bal.remaining > 0 ? 'var(--success)' : 'var(--danger)';
  preview.style.display = 'block';
}

async function recalcLeaveBalance(empId, leaveTypeName) {
  const year = getYear();
  const bal = getLeaveBalance(empId, leaveTypeName);
  const existing = DATABASE.leaveBalances.find(b =>
    String(b.empId) === String(empId) && b.year === String(year) && b.leaveType === leaveTypeName
  );
  const data = {
    id: existing ? existing.id : ('lb_' + empId + '_' + year + '_' + leaveTypeName),
    empId: String(empId),
    year: String(year),
    leaveType: leaveTypeName,
    opening: bal.opening,
    consumed: bal.consumed,
    remaining: bal.remaining
  };
  await cloudAction('LeaveBalances', 'save', data);
}

async function saveLeaveSettings() {
  if (currentRole !== 'admin') return showToast('غير مسموح', 'error');
  const restType = document.getElementById('settingRestType').value;
  const aDays = document.getElementById('settingAnnualADays').value;
  const cDays = document.getElementById('settingAnnualCDays').value;
  const pairs = [
    { key: 'rest_type', value: restType },
    { key: 'annual_leave_adays', value: aDays },
    { key: 'annual_leave_cdays', value: cDays }
  ];
  for (const p of pairs) {
    const existing = DATABASE.settings.find(s => s.key === p.key);
    await cloudAction('Settings', 'save', { id: existing ? existing.id : ('S_' + p.key), key: p.key, value: p.value });
  }
  showToast('تم حفظ إعدادات الإجازات', 'success');
}

function loadLeaveSettings() {
  const rest = DATABASE.settings.find(s => s.key === 'rest_type');
  const aDays = DATABASE.settings.find(s => s.key === 'annual_leave_adays');
  const cDays = DATABASE.settings.find(s => s.key === 'annual_leave_cdays');
  if (rest) document.getElementById('settingRestType').value = rest.value || 'flexible';
  if (aDays) document.getElementById('settingAnnualADays').value = aDays.value || 21;
  if (cDays) document.getElementById('settingAnnualCDays').value = cDays.value || 6;
}

// === List Render ===
function renderList(tableId, dbArray, branchId, dateStartId, dateEndId, statusId, nameId, posId, isAdmin, isShift) {
  let list = dbArray;
  if (branchId) list = list.filter(x => String(x.branchId) === String(branchId));
  const dStart = document.getElementById(dateStartId)?.value, dEnd = document.getElementById(dateEndId)?.value, stat = document.getElementById(statusId)?.value;
  if (dStart) list = list.filter(x => x.date >= dStart);
  if (dEnd) list = list.filter(x => x.date <= dEnd);
  if (stat) list = list.filter(x => String(x.status) === String(stat));
  const nameF = nameId ? (document.getElementById(nameId)?.value || '').toLowerCase() : '';
  const posF = posId ? (document.getElementById(posId)?.value || '').toLowerCase() : '';
  if (nameF) list = list.filter(x => x.empName.toLowerCase().includes(nameF));
  if (posF) { const posMap = {}; DATABASE.employees.forEach(e => posMap[e.id] = (e.position || '').toLowerCase()); list = list.filter(x => (posMap[x.empId]||'').includes(posF)); }

  const bMap = {}; DATABASE.branches.forEach(b => bMap[b.id] = b.name);
  const tbody = document.getElementById(tableId);
  const thead = document.getElementById(tableId.replace('Table', 'Thead'));
  const cbKey = tableId === 'attendanceTable' ? 'attendance-cb' : (isShift ? 'shift-cb' : 'leave-cb');
  const posMap = {}; DATABASE.employees.forEach(e => posMap[e.id] = e.position || '');

  const isAtt = tableId === 'attendanceTable';

  // Sort logic
  const sortKey = tableId;
  const curSort = _sortState[sortKey] || { col: null, dir: 'asc' };
  function thSort(col, label) {
    const active = curSort.col === col;
    const dir = active ? curSort.dir : '';
    const icon = active ? (dir === 'asc' ? '▲' : '▼') : '⇅';
    return `<th class="sortable${active ? (dir === 'asc' ? ' sorted-asc' : ' sorted-desc') : ''}" onclick="toggleSort('${sortKey}','${col}')"><span class="sort-icon">${icon}</span>${label}</th>`;
  }

  function doSort(arr, cols) {
    if (!curSort.col) return arr;
    const colDef = cols.find(c => c.key === curSort.col);
    if (!colDef) return arr;
    const dir = curSort.dir === 'asc' ? 1 : -1;
    return [...arr].sort((a, b) => {
      let va = colDef.get(a), vb = colDef.get(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va || '').localeCompare(String(vb || ''), 'ar') * dir;
    });
  }

  const empCol = { key: 'empName', get: x => x.empName || '' };
  const posCol = { key: 'position', get: x => posMap[x.empId] || '' };
  const dateCol = { key: 'date', get: x => x.date || '' };
  const statusCol = { key: 'status', get: x => x.status || '' };
  const branchCol = { key: 'branch', get: x => bMap[x.branchId] || '' };

  let stdColsDef;
  if (isAtt) {
    stdColsDef = [empCol, posCol, dateCol,
      { key: 'day', get: x => x.day || '' },
      { key: 'shiftType', get: x => x.shiftType || '' },
      { key: 'shiftTime', get: x => x.shiftStart || '' },
      { key: 'punchIn', get: x => x.start || '' },
      { key: 'punchOut', get: x => x.end || '' },
      statusCol
    ];
  } else if (isShift) {
    stdColsDef = [empCol, posCol, dateCol,
      { key: 'start', get: x => x.start || '' },
      { key: 'end', get: x => x.end || '' },
      statusCol
    ];
  } else {
    stdColsDef = [empCol, posCol, dateCol,
      { key: 'type', get: x => x.type || '' },
      { key: 'quantity', get: x => parseInt(x.quantity) || 0 },
      { key: 'notes', get: x => x.notes || '' },
      statusCol
    ];
  }
  const allColsDef = isAdmin ? [branchCol, ...stdColsDef] : stdColsDef;
  list = doSort(list, allColsDef);

  // Build thead
  const attHdrs = [thSort('date','التاريخ'), thSort('day','اليوم'), thSort('shiftType','الشفت'), thSort('shiftTime','وقت الشفت'), thSort('punchIn','دخول'), thSort('punchOut','خروج'), thSort('status','الحالة')].join('');
  const stdHdrs = isShift
    ? [thSort('date','التاريخ'), thSort('start','من'), thSort('end','إلى'), thSort('status','الحالة')].join('')
    : [thSort('date','التاريخ'), thSort('type','النوع'), thSort('quantity','الكمية'), thSort('notes','ملاحظات'), thSort('status','الحالة')].join('');

  if (thead) thead.innerHTML = `<tr>${isAdmin ? '<th style="width:30px"><input type="checkbox" class="custom-checkbox" onchange="toggleAllCB(\''+cbKey+'\',this.checked)"></th>' + thSort('branch','الفرع') : ''}${thSort('empName','الموظف')}${thSort('position','الوظيفة')}${isAtt ? attHdrs : stdHdrs}<th>إجراءات</th></tr>`;

  if (!list.length) { tbody.innerHTML = '<tr><td colspan="10" style="text-align:center">لا توجد بيانات</td></tr>'; return list; }

  let html = '';
  const allRows = [];
  list.forEach(item => {
    const canEdit = isAdmin || item.status === 'Pending';
    const isApproverRole = currentRole === 'admin' || currentRole === 'supervisor';
    let btns = '';
    if (isAdmin && isApproverRole) {
      const type = isAtt ? 'attendance' : (isShift ? 'shift' : 'leave');
      if (item.status === 'Pending') {
        btns += `<button class="btn btn-success btn-sm" onclick="quickChangeStatus('${item.id}','Approved','${type}')" title="اعتماد">✅</button>`;
        btns += `<button class="btn btn-danger btn-sm" onclick="quickChangeStatus('${item.id}','Rejected','${type}')" title="رفض">❌</button>`;
      } else if (item.status === 'Approved' || item.status === 'Rejected') {
        btns += `<button class="btn btn-outline btn-sm" onclick="quickChangeStatus('${item.id}','Pending','${type}')" title="إرجاع للمراجعة" style="color:var(--warning);border-color:var(--warning)">⏳</button>`;
      }
      btns += `<button class="btn btn-warning btn-sm" onclick="${isAtt ? `openAttendanceModal('${item.id}')` : (isShift ? `openShiftModal('${item.id}')` : `openLeaveModal('${item.id}')`)}" title="تعديل">✏️</button>`;
    } else if (canEdit) {
      btns = `<button class="btn btn-warning btn-sm" onclick="${isAtt ? `openAttendanceModal('${item.id}')` : (isShift ? `openShiftModal('${item.id}')` : `openLeaveModal('${item.id}')`)}" title="تعديل">✏️</button>`;
    } else {
      btns = '<span style="color:#888;font-size:11px">مغلق</span>';
    }

    allRows.push(`<tr>${isAdmin ? `<td data-label="تحديد"><input type="checkbox" class="${cbKey} custom-checkbox" value="${item.id}"></td><td data-label="الفرع" title="${bMap[item.branchId]||item.branchId}"><strong>${bMap[item.branchId]||item.branchId}</strong></td>` : ''}<td data-label="الموظف" title="${escapeHtml(item.empName)} (${item.empId})"><strong>${escapeHtml(item.empName)}</strong><br><span style="font-size:10px;color:#888">${item.empId}</span></td><td data-label="الوظيفة" title="${posMap[item.empId]||''}" style="color:#666;font-size:11px">${posMap[item.empId]||'-'}</td>${isAtt ? (() => {
      const stObj = DATABASE.shiftTypes.find(t => t.name === item.shiftType);
      const shS = stObj ? stObj.startTime : item.shiftStart;
      const shE = stObj ? stObj.endTime : item.shiftEnd;
      const shiftTime = (shS && shE) ? shS + ' - ' + shE : '--';
      const punchIn = item.start || '--';
      const punchOut = item.end || '--';
      let liveDelay = 0, liveEarly = 0;
      if (shS && shE && punchIn !== '--') {
        let sS2 = timeToMinutes(shS), sE2 = timeToMinutes(shE);
        let pI2 = timeToMinutes(punchIn), pO2 = punchOut !== '--' ? timeToMinutes(punchOut) : null;
        if (sE2 <= sS2) { if (pI2 < sS2 && pI2 <= 480) pI2 += 1440; if (pO2 !== null && pO2 < sS2 && pO2 <= 480) pO2 += 1440; sE2 += 1440; }
        liveDelay = Math.max(0, pI2 - sS2);
        if (pO2 !== null) liveEarly = Math.max(0, sE2 - pO2);
      }
      let delayStr = '--';
      if (liveDelay > 0) delayStr = `<span style="color:var(--danger);font-weight:600">${liveDelay} د</span>`;
      else if (punchIn !== '--' && shS) delayStr = '<span style="color:var(--success)">✓</span>';
      let earlyStr = '--';
      if (liveEarly > 0) earlyStr = `<span style="color:var(--danger);font-weight:600">${liveEarly} د</span>`;
      else if (punchOut !== '--' && shE) earlyStr = '<span style="color:var(--success)">✓</span>';
      const statusHtml = item.status === 'Approved' ? '<span style="color:var(--success);font-weight:600">✅ معتمد</span>' : item.status === 'Rejected' ? '<span style="color:var(--danger);font-weight:600">❌ مرفوض</span>' : '<span style="color:var(--warning);font-weight:600">⏳ مراجعة</span>';
      return `<td data-label="التاريخ">${formatDate(item.date)}</td><td data-label="اليوم">${(item.day||'--')}</td><td data-label="الشفت">${(item.shiftType||'--')}</td><td data-label="وقت الشفت">${shiftTime}</td><td data-label="دخول"><strong>${punchIn}</strong></td><td data-label="خروج"><strong>${punchOut}</strong></td><td data-label="الحالة">${statusHtml}</td>`;
    })() : `<td data-label="التاريخ">${formatDate(item.date)}</td><td data-label="النوع"><strong>${(item.type||'')}</strong></td>`+(isShift ? `<td data-label="من">${(item.start||'--')}</td><td data-label="إلى">${(item.end||'--')}</td>` : `<td data-label="الكمية"><span style="font-size:11px;color:#2563eb;font-weight:bold">${(item.quantity||'-')}</span></td><td data-label="ملاحظات"><span style="font-size:11px;color:#666">${(item.notes||'--')}</span></td>`)}<td data-label="إجراءات" class="action-btns-cell"><div class="action-btns">${btns}</div></td></tr>`);
  });

  const pageSize = _pageSizes[tableId] || 0;
  if (pageSize && allRows.length > pageSize) {
    if (!_visibleCounts[tableId]) _visibleCounts[tableId] = pageSize;
    const visible = _visibleCounts[tableId];
    html = allRows.slice(0, visible).join('');
    if (visible < allRows.length) {
      html += `<tr><td colspan="12" style="text-align:center;padding:12px"><button class="btn btn-outline btn-sm" onclick="showMoreRows('${tableId}','${tableId.replace('Table','Thead')}','${branchId}','${dateStartId}','${dateEndId}','${statusId}','${nameId}','${posId}',${isAdmin},${isShift})">عرض المزيد (${allRows.length - visible} متبقي)</button> <span style="font-size:10px;color:#888">${visible} / ${allRows.length}</span></td></tr>`;
    }
  } else {
    html = allRows.join('');
  }
  tbody.innerHTML = html;
  return list;
}

function showMoreRows(tableId, theadId, branchId, dateStartId, dateEndId, statusId, nameId, posId, isAdmin, isShift) {
  _visibleCounts[tableId] = (_visibleCounts[tableId] || 50) + 50;
  const tableMap = { branchShiftsTable: 'DATABASE.shifts', adminShiftsTable: 'DATABASE.shifts', leavesTable: 'DATABASE.leaves', attendanceTable: 'DATABASE.attendance' };
  if (tableId === 'branchShiftsTable') renderBranchShifts();
  else if (tableId === 'adminShiftsTable') renderAdminShifts();
  else if (tableId === 'leavesTable') renderLeaves();
  else if (tableId === 'attendanceTable') renderAttendance();
}

function toggleSort(tableId, col) {
  const cur = _sortState[tableId];
  if (cur && cur.col === col) {
    _sortState[tableId] = { col, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  } else {
    _sortState[tableId] = { col, dir: 'asc' };
  }
  if (tableId === 'branchShiftsTable') renderBranchShifts();
  else if (tableId === 'adminShiftsTable') renderAdminShifts();
  else if (tableId === 'leavesTable') renderLeaves();
  else if (tableId === 'attendanceTable') renderAttendance();
}

function renderBranchShifts() { renderList('branchShiftsTable', DATABASE.shifts, currentBranch.id, 'filterStartBranch','filterEndBranch','filterStatusBranch','filterNameBranch','filterPosBranch',false,true); }
function renderAdminShifts() { renderList('adminShiftsTable', DATABASE.shifts, document.getElementById('filterBranchAdmin').value, 'filterStartAdmin','filterEndAdmin','filterStatusAdmin','filterNameAdmin','filterPosAdmin',true,true); }
function renderLeaves() { renderList('leavesTable', DATABASE.leaves, currentRole === 'branch' ? currentBranch.id : document.getElementById('filterLeaveBranch').value, 'filterLeaveStart','filterLeaveEnd','filterLeaveStatus','filterNameLeave','filterPosLeave',currentRole !== 'branch',false); }

// === Attendance ===
function renderAttendance() {
  const bId = currentRole === 'branch' ? currentBranch.id : document.getElementById('filterAttendanceBranch').value;
  renderList('attendanceTable', DATABASE.attendance, bId, 'filterAttendanceStart','filterAttendanceEnd','filterAttendanceStatus','filterAttendanceName','filterAttendancePos',currentRole !== 'branch',true);
  updateAttendanceStats();
  renderShiftsComparison();
}
function updateAttendanceStats() {
  const bId = currentRole === 'branch' ? currentBranch.id : null;
  let list = DATABASE.attendance;
  if (bId) list = list.filter(a => String(a.branchId) === String(bId));
  list = list.filter(a => a.status === 'Approved');
  const today = getToday(), todayList = list.filter(a => a.date === today);
  let delayed = 0, earlyLeave = 0;
  todayList.forEach(a => { if (a.delayMin > 0) delayed++; if (a.earlyLeaveMin > 0) earlyLeave++; });
  document.getElementById('attendanceStats').innerHTML = `
    <div class="stat-card"><div class="stat-icon blue">📋</div><div class="stat-info"><div class="stat-number">${list.length}</div><div class="stat-label">إجمالي الحضور</div></div></div>
    <div class="stat-card"><div class="stat-icon green">✅</div><div class="stat-info"><div class="stat-number">${todayList.length}</div><div class="stat-label">حضور اليوم</div></div></div>
    <div class="stat-card"><div class="stat-icon yellow">⏰</div><div class="stat-info"><div class="stat-number">${delayed}</div><div class="stat-label">متأخرون اليوم</div></div></div>
    <div class="stat-card"><div class="stat-icon red">🚶</div><div class="stat-info"><div class="stat-number">${earlyLeave}</div><div class="stat-label">خروج مبكر اليوم</div></div></div>`;
}
function renderShiftsComparison() {
  const branchSelect = document.getElementById('shiftCompBranch');
  if (branchSelect && branchSelect.options.length <= 1) {
    branchSelect.innerHTML = '<option value="">كل الفروع</option>' + DATABASE.branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  }
  const today = getToday();
  let startDate = document.getElementById('shiftCompStart')?.value || today;
  let endDate = document.getElementById('shiftCompEnd')?.value || today;
  document.getElementById('shiftCompStart').value = startDate;
  document.getElementById('shiftCompEnd').value = endDate;
  const branchId = currentRole === 'branch' ? currentBranch.id : (document.getElementById('shiftCompBranch')?.value || '');
  let shifts = DATABASE.shifts.filter(s => s.date >= startDate && s.date <= endDate);
  if (branchId) shifts = shifts.filter(s => {
    const emp = DATABASE.employees.find(e => String(e.id) === String(s.empId));
    return emp && String(emp.branchId) === String(branchId);
  });
  const rows = shifts.map(s => {
    const emp = DATABASE.employees.find(e => String(e.id) === String(s.empId));
    const empName = emp ? emp.name : s.empName || s.empId;
    const typeName = s.type || '';
    const stObj = DATABASE.shiftTypes.find(t => t.name === s.type);
    const shiftStartTime = stObj ? stObj.startTime : s.start;
    const shiftEndTime = stObj ? stObj.endTime : s.end;
    const att = DATABASE.attendance.find(a => String(a.empId) === String(s.empId) && a.date === s.date);
    let punchIn = '-', punchOut = '-';
    if (att) {
      const pi = att.punchInTime || att.start;
      const po = att.punchOutTime || att.end;
      punchIn = pi ? formatTimeString(pi) : '-';
      punchOut = po ? formatTimeString(po) : '-';
    }
    let liveDelay = 0, liveEarly = 0;
    if (shiftStartTime && shiftEndTime && punchIn !== '-') {
      let sS = timeToMinutes(shiftStartTime), sE = timeToMinutes(shiftEndTime);
      let pI = timeToMinutes(punchIn), pO = punchOut !== '-' ? timeToMinutes(punchOut) : null;
      if (sE <= sS) { if (pI < sS && pI <= 480) pI += 1440; if (pO !== null && pO < sS && pO <= 480) pO += 1440; sE += 1440; }
      liveDelay = Math.max(0, pI - sS);
      if (pO !== null) liveEarly = Math.max(0, sE - pO);
    }
    const delayColor = liveDelay > 0 ? 'var(--danger)' : 'var(--success)';
    const earlyColor = liveEarly > 0 ? 'var(--danger)' : 'var(--success)';
    const delayStr = liveDelay > 0 ? `<span style="color:${delayColor};font-weight:600">${liveDelay} د</span>` : '<span style="color:var(--success)">✓</span>';
    const earlyStr = liveEarly > 0 ? `<span style="color:${earlyColor};font-weight:600">${liveEarly} د</span>` : '<span style="color:var(--success)">✓</span>';
    const hasAtt = att && (punchIn !== '-' || punchOut !== '-');
    const attBadge = hasAtt ? '<span style="color:var(--success);font-weight:600">✓ حاضر</span>' : '<span style="color:var(--danger);font-weight:600">✗ غياب</span>';
    return `<tr><td data-label="الموظف"><strong>${escapeHtml(empName)}</strong></td><td data-label="التاريخ">${formatDate(s.date)}</td><td data-label="الشフト">${typeName}</td><td data-label="وقت الشفت">${shiftStartTime} - ${shiftEndTime}</td><td data-label="البصمة دخول">${punchIn}</td><td data-label="البصمة خروج">${punchOut}</td><td data-label="التأخير">${delayStr}</td><td data-label="خروج مبكر">${earlyStr}</td><td data-label="الحالة">${attBadge}</td></tr>`;
  });
  document.getElementById('shiftsCompTable').innerHTML = rows.length ? rows.join('') : '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted)">لا توجد شفتات في هذه الفترة</td></tr>';
}

function openAttendanceModal(id = null) {
  document.getElementById('attendanceEditId').value = id || '';
  if (currentRole !== 'branch') document.getElementById('attendanceBranch').innerHTML = DATABASE.branches.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  const btnSave = document.querySelector('#attendanceModal .btn-accent');
  if (id) {
    const a = DATABASE.attendance.find(x => String(x.id) === String(id));
    if (currentRole !== 'branch') { document.getElementById('attendanceBranch').value = a.branchId; document.getElementById('attendanceStatusModal').value = a.status; }
    populateModalEmployees('attendance');
    setTimeout(() => {
      document.getElementById('attendanceEmployee').value = a.empId; document.getElementById('attendanceDate').value = a.date;
      document.getElementById('attendanceShiftType').value = a.shiftType || '';
      document.getElementById('attendancePunchIn').value = a.punchInTime || a.start;
      document.getElementById('attendancePunchOut').value = a.punchOutTime || a.end;
      document.getElementById('attendanceDelay').value = a.delayMin || 0;
      document.getElementById('attendanceEarlyLeave').value = a.earlyLeaveMin || 0;
      document.getElementById('attendanceNotes').value = a.notes || '';
    }, 50);
    const locked = currentRole === 'branch' && a.status !== 'Pending';
    document.getElementById('btnDelAttendance').style.display = locked ? 'none' : 'inline-flex';
    btnSave.style.display = locked ? 'none' : 'inline-flex';
  } else {
    populateModalEmployees('attendance');
    const today = getToday();
    document.getElementById('attendanceDate').value = today;
    document.getElementById('attendanceShiftType').value = '';
    document.getElementById('attendancePunchIn').value = '';
    document.getElementById('attendancePunchOut').value = '';
    document.getElementById('attendanceDelay').value = 0;
    document.getElementById('attendanceEarlyLeave').value = 0;
    document.getElementById('attendanceNotes').value = '';
    document.getElementById('attendanceStatusModal').value = 'Pending';
    document.getElementById('btnDelAttendance').style.display = 'none';
    btnSave.style.display = 'inline-flex';
  }
  openModal('attendanceModal');
}

async function saveAttendance() {
  const empId = document.getElementById('attendanceEmployee').value, bId = currentRole === 'branch' ? currentBranch.id : document.getElementById('attendanceBranch').value;
  const date = document.getElementById('attendanceDate').value, shiftType = document.getElementById('attendanceShiftType').value;
  const punchIn = document.getElementById('attendancePunchIn').value, punchOut = document.getElementById('attendancePunchOut').value;
  const delay = document.getElementById('attendanceDelay').value, earlyLeave = document.getElementById('attendanceEarlyLeave').value;
  const notes = document.getElementById('attendanceNotes').value;
  if (!empId || !date || !punchIn) return showToast('أكمل الحقول الأساسية', 'error');
  const emp = DATABASE.employees.find(e => String(e.id) === String(empId));
  const editId = document.getElementById('attendanceEditId').value;
  const statusVal = currentRole === 'branch' ? (editId ? (DATABASE.attendance.find(a=>a.id===editId)?.status||'Pending') : 'Pending') : document.getElementById('attendanceStatusModal').value;
  const dayNames = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const dayOfWeek = new Date(date + 'T12:00:00').getDay();
  const stObj = DATABASE.shiftTypes.find(t => t.name === shiftType);
  const shiftStart = stObj ? stObj.startTime : '';
  const shiftEnd = stObj ? stObj.endTime : '';
  let delayCalc = 0, earlyCalc = 0;
  if (shiftStart && shiftEnd && punchIn) {
    let sStart = timeToMinutes(shiftStart), sEnd = timeToMinutes(shiftEnd);
    let pIn = timeToMinutes(punchIn), pOut = punchOut ? timeToMinutes(punchOut) : null;
    if (sEnd <= sStart) { if (pIn < sStart && pIn <= 480) pIn += 1440; if (pOut !== null && pOut < sStart && pOut <= 480) pOut += 1440; sEnd += 1440; }
    delayCalc = Math.max(0, pIn - sStart);
    if (pOut !== null) earlyCalc = Math.max(0, sEnd - pOut);
  }
  const data = { id: editId || ('att'+Date.now()+Math.random().toString(36).substr(2,4)), empId, empName: emp?.name, branchId: bId, date, day: dayNames[dayOfWeek], shiftType, punchInTime: punchIn, punchOutTime: punchOut, start: punchIn, end: punchOut, shiftStart, shiftEnd, delayMin: delayCalc, earlyLeaveMin: earlyCalc, delay: delayCalc > 0 ? delayCalc + ' د' : '', earlyLeave: earlyCalc > 0 ? earlyCalc + ' د' : '', notes, status: statusVal };
  if (await cloudAction('Attendance', 'save', data)) {
    showToast('تم الحفظ', 'success'); closeModal('attendanceModal');
  }
}

// === Attendance Import (ZKTeco fingerprint device) ===
function handleAttendanceImport(file) {
  if (!file) return;
  if (currentRole === 'branch') return showToast('غير مسموح', 'error');
  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const rows = parseCSV(text);
    if (rows.length < 2) return showToast('الملف فارغ', 'error');

    const headers = rows[0].map(h => h.trim());
    const empIdIdx = headers.findIndex(h => /^no\.|رقم|empid|id$/i.test(h));
    const nameIdx = headers.findIndex(h => /^name|الاسم/i.test(h));
    const dtIdx = headers.findIndex(h => /date.*time|التاريخ.*الوقت|datetime/i.test(h));
    if (empIdIdx === -1 || dtIdx === -1) return showToast('الملف مش من جهاز البصمة — تأكد من الأعمدة: No. و Date/Time', 'error');

    const punches = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const empId = String(row[empIdIdx] || '').trim();
      const empName = nameIdx >= 0 ? String(row[nameIdx] || '').trim() : '';
      const rawDT = String(row[dtIdx] || '').trim();
      if (!empId || !rawDT) continue;
      const parsed = parseZKTecoDateTime(rawDT);
      if (!parsed) continue;
      punches.push({ empId, empName, date: parsed.date, time: parsed.time, sortKey: parsed.sortKey });
    }
    if (!punches.length) return showToast('لا توجد بصمات صالحة', 'error');

    punches.sort((a, b) => a.empId.localeCompare(b.empId) || a.sortKey.localeCompare(b.sortKey));

    let groups = {};
    punches.forEach(p => {
      const key = p.empId + '|' + p.date;
      if (!groups[key]) groups[key] = { empId: p.empId, empName: p.empName, date: p.date, punches: [] };
      groups[key].punches.push(p);
    });

    const groupKeys = Object.keys(groups).sort();
    for (let i = 0; i < groupKeys.length; i++) {
      const g = groups[groupKeys[i]];
      if (!g || !groups[groupKeys[i]]) continue;
      const emp = DATABASE.employees.find(e => String(e.id) === String(g.empId));

      const currShift = DATABASE.shifts.find(s => String(s.empId) === String(emp ? emp.id : g.empId) && s.date === g.date && s.status === 'Approved');
      let currShiftEndMin = 0;
      if (currShift) {
        const st = DATABASE.shiftTypes.find(t => t.name === currShift.type);
        currShiftEndMin = timeToMinutes(st ? st.endTime : (currShift.end || ''));
      }

      const prevDate = addDaysToDate(g.date, -1);
      const prevShift = DATABASE.shifts.find(s => String(s.empId) === String(emp ? emp.id : g.empId) && s.date === prevDate && s.status === 'Approved');
      let prevNightEndMin = -1;
      if (prevShift) {
        const prevSt = DATABASE.shiftTypes.find(t => t.name === prevShift.type);
        if (prevSt) {
          const ps = timeToMinutes(prevSt.startTime), pe = timeToMinutes(prevSt.endTime);
          if (pe <= ps) prevNightEndMin = pe;
        }
      }

      const early = [];
      const keepOnDay = [];
      g.punches.forEach(p => {
        const pMin = timeToMinutes(p.time);
        let movedToPrev = false;
        if (prevNightEndMin >= 0 && pMin <= prevNightEndMin + 120 && pMin >= prevNightEndMin - 120) {
          early.push(p);
          movedToPrev = true;
        }
        if (!movedToPrev) {
          if (pMin <= 360 && !(currShiftEndMin > 0 && currShiftEndMin <= 420 && pMin <= currShiftEndMin + 60)) {
            early.push(p);
          } else {
            keepOnDay.push(p);
          }
        }
      });

      if (early.length > 0) {
        if (prevShift) {
          const prevKey = g.empId + '|' + prevDate;
          if (!groups[prevKey]) groups[prevKey] = { empId: g.empId, empName: g.empName, date: prevDate, punches: [] };
          groups[prevKey].punches.push(...early);
        } else {
          keepOnDay.push(...early);
        }
      }

      if (keepOnDay.length > 0) {
        g.punches = keepOnDay;
      } else {
        delete groups[groupKeys[i]];
      }
    }

    const results = Object.values(groups).map(g => {
      g.punches.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
      let emp = DATABASE.employees.find(e => String(e.id) === String(g.empId));
      if (!emp && g.empName) emp = DATABASE.employees.find(e => e.name && e.name.trim() === g.empName.trim());
      const branchId = emp ? emp.branchId : '';
      const shift = DATABASE.shifts.find(s => String(s.empId) === String(emp ? emp.id : g.empId) && s.date === g.date && s.status === 'Approved');
      let shiftTypeName = '';
      let shiftStart = '', shiftEnd = '';
      if (shift) {
        shiftTypeName = shift.type || '';
        const stObj = DATABASE.shiftTypes.find(t => t.name === shift.type);
        shiftStart = stObj ? stObj.startTime : (shift.start || '');
        shiftEnd = stObj ? stObj.endTime : (shift.end || '');
      }
      const rules = getAttendanceRules(shiftTypeName);
      let punchIn = '', punchOut = '';
      const isSingle = g.punches.length === 1;
      if (isSingle) {
        punchIn = g.punches[0].time;
        punchOut = '';
      } else if (g.punches.length >= 2) {
        punchIn = g.punches[0].time;
        punchOut = g.punches[g.punches.length - 1].time;
      }
      let delayMin = 0, earlyLeaveMin = 0;
      if (shiftStart && shiftEnd && punchIn) {
        let sStart = timeToMinutes(shiftStart);
        let sEnd = timeToMinutes(shiftEnd);
        let pIn = timeToMinutes(punchIn);
        let pOut = punchOut ? timeToMinutes(punchOut) : null;
        if (sEnd <= sStart) {
          if (pIn < sStart && pIn <= 480) pIn += 1440;
          if (pOut !== null && pOut < sStart && pOut <= 480) pOut += 1440;
          sEnd += 1440;
        }
        delayMin = Math.max(0, pIn - sStart);
        if (pOut !== null) earlyLeaveMin = Math.max(0, sEnd - pOut);
      }
      const dayNames = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
      const dayOfWeek = new Date(g.date + 'T12:00:00').getDay();
      return {
        id: 'att' + Date.now() + '_' + g.empId,
        empId: emp ? emp.id : g.empId,
        empName: emp ? emp.name : (g.empName || g.empId),
        branchId,
        date: g.date,
        day: dayNames[dayOfWeek],
        shiftType: shiftTypeName,
        punchInTime: punchIn,
        punchOutTime: punchOut,
        start: punchIn,
        end: punchOut,
        shiftStart,
        shiftEnd,
        delayMin,
        earlyLeaveMin,
        delay: delayMin > 0 ? delayMin + ' د' : '',
        earlyLeave: earlyLeaveMin > 0 ? earlyLeaveMin + ' د' : '',
        noPunchIn: false,
        noPunchOut: isSingle,
        singlePunch: isSingle,
        overtime: '',
        punchCount: g.punches.length,
        notes: shift ? '' : '⚠️ بدون شفت',
        status: 'Approved'
      };
    });

    if (!results.length) return showToast('لا توجد نتائج', 'error');

    const existing = new Set(DATABASE.attendance.map(a => a.empId + '|' + a.date));
    const newRecords = results.filter(r => !existing.has(r.empId + '|' + r.date));
    const dupCount = results.length - newRecords.length;
    if (!newRecords.length) return showToast('كلها مكررة', 'warning');

    let summary = '📥 <strong>' + newRecords.length + '</strong> سجل جديد';
    if (dupCount) summary += ' — <span style="color:var(--warning)">' + dupCount + ' مكرر تم تجاهله</span>';
    const withShift = newRecords.filter(r => r.shiftType).length;
    const noShift = newRecords.length - withShift;
    const delayed = newRecords.filter(r => r.delayMin > 0).length;
    summary += '<br><br>';
    if (withShift) summary += '✅ ' + withShift + ' عندهم شفت<br>';
    if (noShift) summary += '⚠️ ' + noShift + ' بدون شفت<br>';
    if (delayed) summary += '⏰ ' + delayed + ' متأخرون<br>';
    summary += '<br>';
    summary += newRecords.slice(0, 5).map((r, i) => `${i+1}. ${escapeHtml(r.empName)} — ${r.date} — ${r.punchInTime}→${r.punchOutTime} ${r.delayMin > 0 ? '(تأخير '+r.delayMin+' د)' : ''}`).join('<br>');
    if (newRecords.length > 5) summary += '<br>...و ' + (newRecords.length - 5) + ' أخرى';

    showAttendanceImportConfirm(newRecords, summary);
  };
  reader.readAsText(file);
}

function parseZKTecoDateTime(raw) {
  if (!raw) return null;
  const s = raw.trim();
  const m12 = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)/i);
  if (m12) {
    let h = parseInt(m12[4], 10);
    const mm = m12[5];
    const ap = m12[7].toLowerCase();
    if (ap === 'pm' && h !== 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    const day = m12[1].padStart(2, '0'), month = m12[2].padStart(2, '0');
    let year = m12[3]; if (year.length === 2) year = '20' + year;
    const date = `${year}-${month}-${day}`;
    const time = String(h).padStart(2, '0') + ':' + mm;
    return { date, time, sortKey: date + 'T' + time };
  }
  const m24 = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m24) {
    const day = m24[1].padStart(2, '0'), month = m24[2].padStart(2, '0');
    let year = m24[3]; if (year.length === 2) year = '20' + year;
    const h = m24[4].padStart(2, '0');
    const date = `${year}-${month}-${day}`;
    const time = `${h}:${m24[5]}`;
    return { date, time, sortKey: date + 'T' + time };
  }
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    const time = `${iso[4]}:${iso[5]}`;
    return { date, time, sortKey: date + 'T' + time };
  }
  return null;
}

function showAttendanceImportConfirm(data, summary) {
  document.getElementById('confirmIcon').textContent = '📥';
  document.getElementById('confirmTitle').innerHTML = `<div style="text-align:right;font-size:14px;line-height:1.8">${summary}</div>`;
  document.getElementById('confirmBtn').textContent = '✅ تأكيد الاستيراد';
  document.getElementById('confirmBtn').className = 'btn btn-success';
  const count = data.length;
  _confirmHandler = async function() {
    if (currentRole === 'branch') { closeModal('confirmModal'); return showToast('غير مسموح', 'error'); }
    closeModal('confirmModal');
    showLoading(true);
    const batchSize = 50;
    for (let i = 0; i < data.length; i += batchSize) {
      if (!(await cloudAction('Attendance', 'bulk_insert', data.slice(i, i + batchSize)))) { showToast('فشل', 'error'); showLoading(false); return; }
    }
    data.forEach(r => { const idx = DATABASE.attendance.findIndex(a => String(a.empId) === String(r.empId) && a.date === r.date); if (idx > -1) DATABASE.attendance[idx] = r; else DATABASE.attendance.push(r); });
    cacheAttendance(DATABASE.attendance);
    showToast(`✅ تم استيراد ${count} سجل`, 'success');
    renderAttendance();
    resetConfirmBtn();
  };
  openModal('confirmModal');
}

function parseCSV(text) {
  const lines = []; let current = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { current.push(field); field = ''; }
      else if (ch === '\n' || (ch === '\r' && text[i+1] === '\n')) { current.push(field); if (current.some(f => f)) lines.push(current); current = []; field = ''; if (ch === '\r') i++; }
      else if (ch === '\r') { current.push(field); if (current.some(f => f)) lines.push(current); current = []; field = ''; }
      else field += ch;
    }
  }
  if (field || current.some(f => f)) { current.push(field); if (current.some(f => f)) lines.push(current); }
  return lines;
}



// === Change Status & Delete ===

// === Employees ===
function renderEmployees() {
  let filtered = DATABASE.employees;
  const branchVal = document.getElementById('empBranchFilter')?.value, search = (document.getElementById('empSearch')?.value||'').toLowerCase(), posSearch = (document.getElementById('empPosFilter')?.value||'').toLowerCase(), statusVal = document.getElementById('empStatusFilter')?.value;
  if (search) filtered = filtered.filter(e => e.name.toLowerCase().includes(search) || String(e.id).includes(search));
  if (posSearch) filtered = filtered.filter(e => (e.position||'').toLowerCase().includes(posSearch));
  if (branchVal) filtered = filtered.filter(e => String(e.branchId) === String(branchVal));
  if (statusVal) filtered = filtered.filter(e => e.status === statusVal);
  const bMap = {}; DATABASE.branches.forEach(b => bMap[b.id] = b.name);
  if (!filtered.length) { document.getElementById('employeesTable').innerHTML = '<tr><td colspan="6" style="text-align:center">لا يوجد موظفون</td></tr>'; return; }
  document.getElementById('employeesTable').innerHTML = filtered.map(e => {
    const empShifts = DATABASE.shifts.filter(s => String(s.empId) === String(e.id) && s.status === 'Approved');
    const empAtt = DATABASE.attendance.filter(a => String(a.empId) === String(e.id));
    const empLeaves = DATABASE.leaves.filter(l => String(l.empId) === String(e.id) && l.status === 'Approved');
    const delayed = empAtt.filter(a => a.delayMin > 0).length;
    return `<tr><td data-label="الكود">${e.id}</td><td data-label="الاسم"><strong>${e.name}</strong></td><td data-label="الفرع">${bMap[e.branchId]||e.branchId}</td><td data-label="الوظيفة">${e.position||'-'}</td><td data-label="الإحصائيات" style="font-size:10px;line-height:1.6"><span style="color:var(--primary)">📅 ${empShifts.length} شفت</span> · <span style="color:var(--success)">✅ ${empAtt.length} حضور</span> · <span style="color:var(--danger)">⏰ ${delayed} تأخير</span> · <span style="color:var(--warning)">🏖️ ${empLeaves.length} إجازة</span></td><td data-label="الحالة">${e.status === 'active' ? 'نشط' : 'غير نشط'}</td><td data-label="إجراءات" class="action-btns-cell"><button class="btn btn-warning btn-sm" onclick="openEmpModal('${e.id}')">✏️</button></td></tr>`;
  }).join('');
}
function openEmpModal(id = null) {
  if (currentRole !== 'admin') return showToast('غير مسموح', 'error');
  document.getElementById('empEditId').value = id || '';
  document.getElementById('empBranch').innerHTML = DATABASE.branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  if (id) { const e = DATABASE.employees.find(x => String(x.id) === String(id)); document.getElementById('empId').value = e.id; document.getElementById('empId').disabled = true; document.getElementById('empName').value = e.name; document.getElementById('empBranch').value = e.branchId; document.getElementById('empPosition').value = e.position||''; document.getElementById('empStatus').value = e.status; }
  else { document.getElementById('empId').disabled = false; document.getElementById('empId').value = ''; document.getElementById('empName').value = ''; document.getElementById('empPosition').value = ''; document.getElementById('empStatus').value = 'active'; }
  openModal('empModal');
}
async function saveEmployee() {
  if (currentRole !== 'admin') return showToast('غير مسموح', 'error');
  const id = document.getElementById('empId').value.trim(), editId = document.getElementById('empEditId').value;
  if (!id || !document.getElementById('empName').value.trim()) return showToast('أكمل الحقول', 'error');
  const data = { id: editId || id, name: document.getElementById('empName').value, branchId: document.getElementById('empBranch').value, position: document.getElementById('empPosition').value, status: document.getElementById('empStatus').value };
  if (await cloudAction('Employees', 'save', data)) {
    showToast('تم الحفظ', 'success'); closeModal('empModal');
  }
}

// === Reports ===
function renderReport() {
  const rType = document.getElementById('reportType').value, bId = document.getElementById('reportBranch').value;
  const dStart = document.getElementById('reportStart').value, dEnd = document.getElementById('reportEnd').value;
  const nameF = (document.getElementById('reportName').value||'').toLowerCase(), posF = (document.getElementById('reportPos').value||'').toLowerCase();
  const bMap = {}; DATABASE.branches.forEach(b => bMap[b.id] = b.name);
  const pMap = {}; DATABASE.employees.forEach(e => pMap[e.id] = e.position||'');

  if (rType === 'shifts-format') {
    let list = DATABASE.shifts.filter(x => x.status === 'Approved');
    if (bId) list = list.filter(x => String(x.branchId) === String(bId));
    if (dStart) list = list.filter(x => x.date >= dStart);
    if (dEnd) list = list.filter(x => x.date <= dEnd);
    if (nameF) list = list.filter(x => (x.empName||'').toLowerCase().includes(nameF));
    if (posF) list = list.filter(x => (pMap[x.empId]||'').toLowerCase().includes(posF));
    let html = `<table><thead><tr><th>الموظف</th><th>الوظيفة</th><th>التاريخ</th><th>اليوم</th><th>النوع</th><th>من</th><th>إلى</th><th>الحالة</th></tr></thead><tbody>`;
    if (!list.length) html += '<tr><td colspan="8" style="text-align:center">لا توجد بيانات</td></tr>';
    else list.forEach(i => {
      const dayNames = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
      let day = i.day || '';
      if (!day && i.date) { try { day = dayNames[new Date(i.date+'T12:00:00').getDay()]; } catch(e){} }
      html += `<tr><td data-label="الموظف">${escapeHtml(i.empName||i.empId)}</td><td data-label="الوظيفة">${pMap[i.empId]||'-'}</td><td data-label="التاريخ">${formatDate(i.date)}</td><td data-label="اليوم">${day||'-'}</td><td data-label="النوع">${i.type||'-'}</td><td data-label="من">${i.start||'-'}</td><td data-label="إلى">${i.end||'-'}</td><td data-label="الحالة">${statusBadge(i.status)}</td></tr>`;
    });
    document.getElementById('reportContainer').innerHTML = html + '</tbody></table>';
    return;
  }

  if (rType === 'attendance') {
    let list = DATABASE.attendance;
    if (bId) list = list.filter(x => String(x.branchId) === String(bId));
    if (dStart) list = list.filter(x => x.date >= dStart);
    if (dEnd) list = list.filter(x => x.date <= dEnd);
    if (nameF) list = list.filter(x => (x.empName||'').toLowerCase().includes(nameF));
    if (posF) list = list.filter(x => (pMap[x.empId]||'').toLowerCase().includes(posF));
    let html = `<table><thead><tr><th>الموظف</th><th>الوظيفة</th><th>التاريخ</th><th>اليوم</th><th>الشفت</th><th>وقت الشفت</th><th>دخول</th><th>خروج</th><th>التأخير</th><th>خروج مبكر</th><th>الحالة</th></tr></thead><tbody>`;
    if (!list.length) html += '<tr><td colspan="11" style="text-align:center">لا توجد بيانات</td></tr>';
    else list.forEach(i => {
      const stObj = DATABASE.shiftTypes.find(t => t.name === i.shiftType);
      const shStart = stObj ? stObj.startTime : (i.shiftStart||'');
      const shEnd = stObj ? stObj.endTime : (i.shiftEnd||'');
      const shiftTime = shStart + ' - ' + shEnd;
      const punchIn = i.punchInTime || i.start || '';
      const punchOut = i.punchOutTime || i.end || '';
      let liveDelay = 0, liveEarly = 0;
      if (shStart && shEnd && punchIn) {
        let sS = timeToMinutes(shStart), sE = timeToMinutes(shEnd);
        let pI = timeToMinutes(punchIn), pO = punchOut ? timeToMinutes(punchOut) : null;
      if (sE <= sS) { if (pI < sS && pI <= 480) pI += 1440; if (pO !== null && pO < sS && pO <= 480) pO += 1440; sE += 1440; }
        liveDelay = Math.max(0, pI - sS);
        if (pO !== null) liveEarly = Math.max(0, sE - pO);
      }
      const delayStr = liveDelay > 0 ? `<span style="color:var(--danger);font-weight:600">${liveDelay} د</span>` : '<span style="color:var(--success)">✓</span>';
      const earlyStr = liveEarly > 0 ? `<span style="color:var(--danger);font-weight:600">${liveEarly} د</span>` : '<span style="color:var(--success)">✓</span>';
      html += `<tr><td data-label="الموظف">${escapeHtml(i.empName||i.empId)}</td><td data-label="الوظيفة">${pMap[i.empId]||'-'}</td><td data-label="التاريخ">${formatDate(i.date)}</td><td data-label="اليوم">${i.day||'-'}</td><td data-label="الشفت">${i.shiftType||'-'}</td><td data-label="وقت الشفت">${shiftTime}</td><td data-label="دخول">${punchIn}</td><td data-label="خروج">${punchOut}</td><td data-label="التأخير">${delayStr}</td><td data-label="خروج مبكر">${earlyStr}</td><td data-label="الحالة">${statusBadge(i.status)}</td></tr>`;
    });
    document.getElementById('reportContainer').innerHTML = html + '</tbody></table>';
    return;
  }

  if (rType === 'leave-balances') {
    const year = new Date().getFullYear();
    let emps = DATABASE.employees.filter(e => e.status === 'active');
    if (bId) emps = emps.filter(e => String(e.branchId) === String(bId));
    if (nameF) emps = emps.filter(e => (e.name||'').toLowerCase().includes(nameF));
    if (posF) emps = emps.filter(e => (pMap[e.id]||'').toLowerCase().includes(posF));
    let html = `<table><thead><tr><th>الموظف</th><th>الوظيفة</th><th>الفرع</th><th>نوع الإجازة</th><th>الافتتاحي</th><th>المستهلك</th><th>المتبقي</th></tr></thead><tbody>`;
    if (!emps.length) html += '<tr><td colspan="7" style="text-align:center">لا يوجد موظفون</td></tr>';
    else {
      const leaveTypeNames = DATABASE.leaveTypes.map(t => t.name);
      emps.forEach(emp => {
        leaveTypeNames.forEach(ltName => {
          if (ltName === 'أعياد') return;
          const bal = getLeaveBalance(emp.id, ltName);
          if (bal.opening === 0 && bal.consumed === 0) return;
          const remColor = bal.remaining > 0 ? 'var(--success)' : 'var(--danger)';
          html += `<tr><td data-label="الموظف"><strong>${escapeHtml(emp.name)}</strong><br><span style="font-size:10px;color:#888">${emp.id}</span></td><td data-label="الوظيفة">${emp.position||'-'}</td><td data-label="الفرع">${bMap[emp.branchId]||emp.branchId}</td><td data-label="النوع">${ltName}</td><td data-label="الافتتاحي" style="font-weight:600">${bal.opening}</td><td data-label="المستهلك" style="font-weight:600">${bal.consumed}</td><td data-label="المتبقي" style="font-weight:700;color:${remColor}">${bal.remaining}</td></tr>`;
        });
      });
    }
    document.getElementById('reportContainer').innerHTML = html + '</tbody></table>';
    return;
  }

  let list = (rType === 'shifts' ? DATABASE.shifts : DATABASE.leaves).filter(x => x.status === 'Approved');
  if (bId) list = list.filter(x => String(x.branchId) === String(bId));
  if (dStart) list = list.filter(x => x.date >= dStart);
  if (dEnd) list = list.filter(x => x.date <= dEnd);
  if (nameF) list = list.filter(x => (x.empName||'').toLowerCase().includes(nameF));
  if (posF) list = list.filter(x => (pMap[x.empId]||'').toLowerCase().includes(posF));
  let html = `<table><thead><tr><th>الفرع</th><th>الموظف</th><th>الوظيفة</th><th>التاريخ</th><th>النوع</th>${rType==='shifts'?'<th>من</th><th>إلى</th>':'<th>الكمية</th><th>ملاحظات</th>'}</tr></thead><tbody>`;
  if (!list.length) html += '<tr><td colspan="7" style="text-align:center">لا يوجد بيانات معتمدة</td></tr>';
  else list.forEach(i => { html += `<tr><td data-label="الفرع">${bMap[i.branchId]||i.branchId}</td><td data-label="الموظف">${i.empName}</td><td data-label="الوظيفة">${pMap[i.empId]||'-'}</td><td data-label="التاريخ">${i.date}</td><td data-label="النوع">${i.type}</td>${rType==='shifts'?`<td data-label="من">${i.start}</td><td data-label="إلى">${i.end}</td>`:`<td data-label="الكمية">${i.quantity||'-'}</td><td data-label="ملاحظات">${i.notes||'-'}</td>`}</tr>`; });
  document.getElementById('reportContainer').innerHTML = html + '</tbody></table>';
}

// === Settings ===
function renderSettings() {
  document.getElementById('branchesTableBody').innerHTML = DATABASE.branches.map(b => `<tr><td data-label="الكود">${b.id}</td><td data-label="الاسم">${b.name}</td><td data-label="كلمة السر">***</td><td data-label="إجراء" class="action-btns-cell"><button class="btn btn-warning btn-sm" onclick="openBranchModal('${b.id}')">✏️</button></td></tr>`).join('');
  document.getElementById('typesTableBody').innerHTML = DATABASE.shiftTypes.map(t => `<tr><td data-label="المسمى">${t.name}</td><td data-label="من">${t.startTime}</td><td data-label="إلى">${t.endTime}</td><td data-label="بداية حضور">${t.checkInStart || '--'}</td><td data-label="نهاية حضور">${t.checkInEnd || '--'}</td><td data-label="نوع">${t.isOpeningShift === 'true' || t.isOpeningShift === true ? '<span class="badge badge-approved">🏪 فتح</span>' : '<span style="color:#94a3b8">عادية</span>'}</td><td data-label="إجراء" class="action-btns-cell"><button class="btn btn-warning btn-sm" onclick="openTypeModal('shift','${t.id}')">✏️</button></td></tr>`).join('');
  document.getElementById('leaveTypesTableBody').innerHTML = DATABASE.leaveTypes.map(t => `<tr><td data-label="المسمى">${t.name} (${t.id})</td><td data-label="الرصيد السنوي" style="font-weight:600">${t.annualBalance || 0} يوم</td><td data-label="إجراء" class="action-btns-cell"><button class="btn btn-warning btn-sm" onclick="openTypeModal('leave','${t.id}')">✏️</button></td></tr>`).join('');
  const a = DATABASE.settings.find(s => s.key === 'admin_password'), b = DATABASE.settings.find(s => s.key === 'supervisor_password');
  if (document.getElementById('newAdminPass')) document.getElementById('newAdminPass').value = a?.value||'';
  if (document.getElementById('supervisorPassInput')) document.getElementById('supervisorPassInput').value = b?.value||'';
  const rules = getAttendanceRules();
  const ruleStart = document.getElementById('ruleCheckInStart');
  const ruleEnd = document.getElementById('ruleCheckInEnd');
  if (ruleStart) ruleStart.value = rules.start;
  if (ruleEnd) ruleEnd.value = rules.end;
  loadLeaveSettings();
}
function openBranchModal(id = null) {
  if (currentRole !== 'admin') return showToast('غير مسموح', 'error');
  document.getElementById('branchEditId').value = id||'';
  if (id) { const b = DATABASE.branches.find(x => String(x.id) === String(id)); document.getElementById('branchId').value = b.id; document.getElementById('branchId').disabled = true; document.getElementById('branchName').value = b.name; document.getElementById('branchPass').value = b.password; }
  else { document.getElementById('branchId').disabled = false; document.getElementById('branchId').value = ''; document.getElementById('branchName').value = ''; document.getElementById('branchPass').value = ''; }
  openModal('branchModal');
}
async function saveBranch() {
  if (currentRole !== 'admin') return showToast('غير مسموح', 'error');
  const editId = document.getElementById('branchEditId').value, data = { id: document.getElementById('branchId').value.trim(), name: document.getElementById('branchName').value, password: document.getElementById('branchPass').value };
  if (!data.id || !data.name) return showToast('أكمل الحقول', 'error');
  if (await cloudAction('Branches', 'save', data)) { showToast('تم الحفظ','success'); closeModal('branchModal'); }
}
function openTypeModal(cat, id = null) {
  if (currentRole !== 'admin') return showToast('غير مسموح', 'error');
  document.getElementById('typeEditId').value = id||''; document.getElementById('typeCategory').value = cat;
  document.getElementById('typeTimeGroup').style.display = cat === 'shift' ? 'grid' : 'none';
  document.getElementById('typeCheckInGroup').style.display = cat === 'shift' ? 'grid' : 'none';
  document.getElementById('typeCheckInHint').style.display = cat === 'shift' ? 'block' : 'none';
  document.getElementById('typeOpeningGroup').style.display = cat === 'shift' ? 'block' : 'none';
  document.getElementById('typeAnnualGroup').style.display = cat === 'leave' ? 'block' : 'none';
  if (id) { const t = (cat==='shift'?DATABASE.shiftTypes:DATABASE.leaveTypes).find(x => String(x.id) === String(id)); document.getElementById('typeId').value = t.id; document.getElementById('typeId').disabled = true; document.getElementById('typeName').value = t.name; if (cat==='shift') { document.getElementById('typeStart').value = t.startTime; document.getElementById('typeEnd').value = t.endTime; document.getElementById('typeCheckInStart').value = t.checkInStart || ''; document.getElementById('typeCheckInEnd').value = t.checkInEnd || ''; document.getElementById('typeIsOpening').checked = t.isOpeningShift === 'true' || t.isOpeningShift === true; } else { document.getElementById('typeAnnualBalance').value = t.annualBalance || 0; } }
  else { document.getElementById('typeId').disabled = false; document.getElementById('typeId').value = ''; document.getElementById('typeName').value = ''; document.getElementById('typeStart').value = ''; document.getElementById('typeEnd').value = ''; document.getElementById('typeCheckInStart').value = ''; document.getElementById('typeCheckInEnd').value = ''; document.getElementById('typeIsOpening').checked = false; document.getElementById('typeAnnualBalance').value = 0; }
  openModal('typeModal');
}
async function saveType() {
  if (currentRole !== 'admin') return showToast('غير مسموح', 'error');
  const cat = document.getElementById('typeCategory').value, editId = document.getElementById('typeEditId').value;
  const data = { id: document.getElementById('typeId').value.trim(), name: document.getElementById('typeName').value };
  if (cat === 'shift') { data.startTime = document.getElementById('typeStart').value; data.endTime = document.getElementById('typeEnd').value; data.checkInStart = document.getElementById('typeCheckInStart').value; data.checkInEnd = document.getElementById('typeCheckInEnd').value; data.isOpeningShift = document.getElementById('typeIsOpening').checked ? 'true' : 'false'; }
  else { data.annualBalance = parseInt(document.getElementById('typeAnnualBalance').value) || 0; }
  if (!data.id || !data.name) return showToast('أكمل الحقول', 'error');
  if (await cloudAction(cat==='shift'?'ShiftTypes':'LeaveTypes','save',data)) {
    showToast('تم الحفظ','success'); closeModal('typeModal');
  }
}
async function savePasswords() {
  if (currentRole !== 'admin') return showToast('غير مسموح', 'error');
  const adminPass = document.getElementById('newAdminPass').value.trim(), supPass = document.getElementById('supervisorPassInput').value.trim();
  if (!adminPass && !supPass) return showToast('أدخل كلمة سر', 'warning');
  if (adminPass) { const s = DATABASE.settings.find(x => x.key === 'admin_password'); await cloudAction('Settings','save', { id: s ? s.id : ('S_'+Date.now()), key: 'admin_password', value: adminPass }); }
  if (supPass) { const s = DATABASE.settings.find(x => x.key === 'supervisor_password'); await cloudAction('Settings','save', { id: s ? s.id : ('S_'+(Date.now()+1)), key: 'supervisor_password', value: supPass }); }
  showToast('تم حفظ كلمات السر', 'success');
}

function getAttendanceRules(shiftTypeName) {
  if (shiftTypeName) {
    const st = DATABASE.shiftTypes.find(t => t.name === shiftTypeName);
    if (st && st.checkInStart && st.checkInEnd) return { start: st.checkInStart, end: st.checkInEnd };
  }
  const start = DATABASE.settings.find(s => s.key === 'checkin_start');
  const end = DATABASE.settings.find(s => s.key === 'checkin_end');
  return { start: start?.value || '06:00', end: end?.value || '12:00' };
}
async function saveAttendanceRules() {
  if (currentRole !== 'admin') return showToast('غير مسموح', 'error');
  const startVal = document.getElementById('ruleCheckInStart').value;
  const endVal = document.getElementById('ruleCheckInEnd').value;
  if (!startVal || !endVal) return showToast('أدخل الوقتين', 'error');
  const pairs = [
    { key: 'checkin_start', value: startVal },
    { key: 'checkin_end', value: endVal }
  ];
  for (const p of pairs) {
    const existing = DATABASE.settings.find(s => s.key === p.key);
    await cloudAction('Settings', 'save', { id: existing ? existing.id : ('S_' + Date.now() + '_' + p.key), key: p.key, value: p.value });
  }
  showToast('تم حفظ قواعد الاستنتاج', 'success');
}

// === Delete & Confirm ===
function deleteFromModal(type) {
  if (currentRole === 'branch') return showToast('غير مسموح', 'error');
  const id = document.getElementById(type+'EditId').value; confirmDelete(id, type); closeModal(type+'Modal');
}
function confirmDelete(id, type) {
  let isBulk = false;
  if (type === 'shift' || type === 'leave' || type === 'attendance') {
    const cls = type === 'shift' ? 'shift-cb' : (type === 'attendance' ? 'attendance-cb' : 'leave-cb');
    if (document.querySelectorAll('.' + cls + ':checked').length > 0) isBulk = true;
  }
  pendingDel = { ids: [id], type, isBulk };
  document.getElementById('confirmTitle').textContent = isBulk ? 'تأكيد الحذف الجماعي' : 'تأكيد الحذف';
  openModal('confirmModal');
}

document.getElementById('confirmBtn').onclick = async () => {
  if (_confirmHandler) { await _confirmHandler(); _confirmHandler = null; return; }
  if (!pendingDel) return;
  if (currentRole === 'branch') { pendingDel = null; resetConfirmBtn(); closeModal('confirmModal'); return showToast('غير مسموح', 'error'); }
  const { ids, type, isBulk } = pendingDel;
  const tMap = { shift:'Shifts', leave:'Leaves', attendance:'Attendance', employee:'Employees', branch:'Branches', shiftType:'ShiftTypes', leaveType:'LeaveTypes' };
  if (isBulk) {
    if (await cloudAction(tMap[type]||type+'s', 'bulk_delete', { ids })) {
      if (type === 'shift') DATABASE.shifts = DATABASE.shifts.filter(s => !ids.includes(String(s.id)));
      else if (type === 'leave') {
        const deletedLeaves = DATABASE.leaves.filter(s => ids.includes(String(s.id)));
        DATABASE.leaves = DATABASE.leaves.filter(s => !ids.includes(String(s.id)));
        const affectedEmps = [...new Set(deletedLeaves.map(l => l.empId))];
        const affectedTypes = [...new Set(deletedLeaves.map(l => l.type))];
        for (const empId of affectedEmps) for (const lt of affectedTypes) await recalcLeaveBalance(empId, lt);
      }
      else if (type === 'attendance') DATABASE.attendance = DATABASE.attendance.filter(a => !ids.includes(String(a.id)));
      showToast('تم الحذف', 'warning');
    }
  } else {
    const id = ids[0];
    if (await cloudAction(tMap[type]||type+'s', 'delete', { id })) {
      if (type === 'shift') DATABASE.shifts = DATABASE.shifts.filter(s => String(s.id) !== String(id));
      else if (type === 'leave') {
        const lv = DATABASE.leaves.find(s => String(s.id) === String(id));
        DATABASE.leaves = DATABASE.leaves.filter(s => String(s.id) !== String(id));
        if (lv) await recalcLeaveBalance(lv.empId, lv.type);
      }
      else if (type === 'attendance') DATABASE.attendance = DATABASE.attendance.filter(a => String(a.id) !== String(id));
      else if (type === 'employee') DATABASE.employees = DATABASE.employees.filter(s => String(s.id) !== String(id));
      showToast('تم الحذف', 'warning');
    }
  }
  pendingDel = null; resetConfirmBtn(); closeModal('confirmModal'); refreshActivePage();
};

// ===== Modal Overlay =====
document.querySelectorAll('.modal-overlay').forEach(o => { o.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); }); });

// ===== Print with Report Header =====
const PRINT_TITLES = {
  pageCalendar: { title: 'جدول التوزيع', subtitle: 'استعراض الشفتات والإجراءات بالتقويم' },
  pageBranchShifts: { title: 'الشفتات', subtitle: 'إدارة شفتات الفرع' },
  pageLeaves: { title: 'الإجراءات والأذونات', subtitle: 'إدارة الإجازات والأذونات للموظفين' },
  pageAdminShifts: { title: 'اعتمادات الشفتات', subtitle: 'مراجعة شفتات الفروع والاعتماد الجماعي' },
  pageEmployees: { title: 'الموظفون', subtitle: 'قائمة جميع الموظفين' },
  pageReports: { title: 'التقارير', subtitle: 'تقرير شامل للنظام' },
  pageAttendance: { title: 'الحضور والانصراف', subtitle: 'سجل بصمات الموظفين والالتزام بالشيفتات' }
};
function printPage(pageId) {
  const info = PRINT_TITLES[pageId] || { title: 'تقرير', subtitle: '' };
  const now = new Date();
  const dateStr = now.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  let summaryHtml = '';
  const page = document.getElementById(pageId);
  if (page) {
    const table = page.querySelector('table');
    if (table) {
      const rowCount = table.querySelectorAll('tbody tr').length;
      const thCount = table.querySelectorAll('thead th').length;
      summaryHtml = `<div style="display:flex;gap:16px;margin-top:8px;justify-content:center;flex-wrap:wrap">`;
      summaryHtml += `<div class="summary-box"><div class="num">${rowCount}</div><div class="label">إجمالي السجلات</div></div>`;
      summaryHtml += `<div class="summary-box"><div class="num">${thCount}</div><div class="label">عدد الأعمدة</div></div>`;
      if (pageId === 'pageAttendance') {
        const rows = table.querySelectorAll('tbody tr');
        let delayed = 0, absent = 0;
        rows.forEach(r => { const txt = r.innerText; if (txt.includes('متأخر') || txt.match(/\d+ د/)) delayed++; });
        summaryHtml += `<div class="summary-box"><div class="num" style="color:#ef4444">${delayed}</div><div class="label">متأخرون</div></div>`;
      }
      summaryHtml += `</div>`;
    }
  }
  const headerHtml = `<div class="print-report-header" id="printReportHeader"><h1>${info.title}</h1><p>${info.subtitle}</p><p class="print-date">${dateStr} — ${timeStr}</p>${summaryHtml}</div>`;
  const existing = document.getElementById('printReportHeader');
  if (existing) existing.remove();
  if (page) page.insertAdjacentHTML('afterbegin', headerHtml);
  window.print();
  setTimeout(() => { const h = document.getElementById('printReportHeader'); if (h) h.remove(); }, 1000);
}

// ===== Debounced Renders =====
const debouncedRenderBranchShifts = debounce(() => renderBranchShifts(), 300);
const debouncedRenderAdminShifts = debounce(() => renderAdminShifts(), 300);
const debouncedRenderLeaves = debounce(() => renderLeaves(), 300);
const debouncedRenderEmployees = debounce(() => renderEmployees(), 300);
const debouncedRenderReport = debounce(() => renderReport(), 300);
const debouncedRenderAttendance = debounce(() => renderAttendance(), 300);

// ===== Enhanced Export Functions =====
function exportTableById(tableId, filename) {
  const table = document.getElementById(tableId);
  if (!table) return showToast('لا توجد بيانات', 'warning');
  const rows = table.querySelectorAll('tr');
  let csv = [];
  rows.forEach(row => {
    const cols = row.querySelectorAll('td:not(.action-btns-cell):not(.custom-checkbox-cell), th:not(.action-btns-cell):not(.custom-checkbox-cell)');
    csv.push(Array.from(cols).map(c => '"' + c.innerText.replace(/"/g, '""').trim() + '"').join(','));
  });
  downloadCSV(csv.join('\n'), filename);
}

function exportPageToExcel(pageId) {
  const page = document.getElementById(pageId);
  if (!page) return showToast('لا توجد بيانات', 'warning');
  const tables = page.querySelectorAll('table');
  if (!tables.length) return showToast('لا توجد جداول للتصدير', 'warning');
  let allCsv = [];
  tables.forEach((table, idx) => {
    const rows = table.querySelectorAll('tr');
    if (idx > 0) allCsv.push(''); 
    rows.forEach(row => {
      const cols = row.querySelectorAll('td:not(.action-btns-cell):not(.custom-checkbox-cell), th:not(.action-btns-cell):not(.custom-checkbox-cell)');
      allCsv.push(Array.from(cols).map(c => '"' + c.innerText.replace(/"/g, '""').trim() + '"').join(','));
    });
  });
  const pageNames = {
    pageCalendar: 'التقويم', pageBranchShifts: 'الشفتات', pageLeaves: 'الإجازات',
    pageAdminShifts: 'اعتمادات_الشفتات', pageEmployees: 'الموظفين', pageReports: 'التقارير',
    pageSettings: 'الإعدادات', pageAttendance: 'الحضور_والانصراف'
  };
  downloadCSV(allCsv.join('\n'), (pageNames[pageId] || 'تقرير') + '_' + getToday() + '.csv');
}

function exportPageToPDF(pageId) {
  const page = document.getElementById(pageId);
  if (!page) return showToast('لا توجد بيانات', 'warning');
  const tables = page.querySelectorAll('table');
  if (!tables.length) return showToast('لا توجد جداول للتصدير', 'warning');
  if (typeof window.jspdf !== 'undefined') {
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      doc.setFont('helvetica');
      const pageNames = { pageCalendar: 'التقويم', pageBranchShifts: 'الشفتات', pageLeaves: 'الإجازات', pageAdminShifts: 'اعتمادات الشفتات', pageEmployees: 'الموظفين', pageReports: 'التقارير', pageSettings: 'الإعدادات', pageAttendance: 'الحضور والانصراف' };
      let firstTable = true;
      tables.forEach((table, idx) => {
        if (!firstTable) doc.addPage();
        firstTable = false;
        const title = pageNames[pageId] || 'تقرير';
        doc.setFontSize(16);
        doc.text(title + (tables.length > 1 ? ' - ' + (idx + 1) : ''), 148, 15);
        doc.setFontSize(8);
        doc.text(new Date().toLocaleDateString('ar-EG') + ' ' + new Date().toLocaleTimeString('ar-EG'), 148, 22);
        const headers = [], body = [];
        const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
        if (headerRow) headerRow.querySelectorAll('th').forEach(th => { if (!th.classList.contains('action-btns-cell') && !th.classList.contains('custom-checkbox-cell')) headers.push(th.innerText.trim()); });
        const dataRows = table.querySelectorAll('tbody tr, tr');
        dataRows.forEach(row => {
          if (row === headerRow) return;
          const rowData = [];
          row.querySelectorAll('td').forEach(td => { if (!td.classList.contains('action-btns-cell') && !td.classList.contains('custom-checkbox-cell')) rowData.push(td.innerText.trim().replace(/[✅❌⏳✓✗🚶⏰📋🏢📊🖨️💾🗑️✏️➕📥🔄📊📄]/g, '').trim()); });
          if (rowData.length > 0 && rowData.some(c => c !== '')) body.push(rowData);
        });
        if (headers.length && body.length) doc.autoTable({ head: [headers], body: body, startY: 28, margin: { left: 14, right: 14 }, styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, halign: 'center', valign: 'middle' }, headStyles: { fillColor: [26, 58, 92], textColor: 255, fontStyle: 'bold', halign: 'center' }, alternateRowStyles: { fillColor: [240, 244, 248] } });
      });
      const pageNames2 = { pageCalendar: 'التقويم', pageBranchShifts: 'الشفتات', pageLeaves: 'الإجازات', pageAdminShifts: 'اعتمادات_الشفتات', pageEmployees: 'الموظفين', pageReports: 'التقارير', pageSettings: 'الإعدادات', pageAttendance: 'الحضور_والانصراف' };
      doc.save((pageNames2[pageId] || 'تقرير') + '_' + getToday() + '.pdf');
      showToast('تم التصدير بنجاح', 'success');
    } catch (e) {
      console.error('PDF export error:', e);
      printPage(pageId);
    }
  } else {
    printPage(pageId);
  }
}

// ===== Global Search =====
function handleGlobalSearch(query) {
  const q = (query || '').trim().toLowerCase();
  const clearBtn = document.getElementById('globalSearchClear');
  const resultsDiv = document.getElementById('globalSearchResults');
  if (clearBtn) clearBtn.classList.toggle('show', q.length > 0);
  if (!q || q.length < 2) { resultsDiv.innerHTML = ''; resultsDiv.classList.remove('show'); return; }
  const bMap = {}; DATABASE.branches.forEach(b => bMap[b.id] = b.name);
  const pMap = {}; DATABASE.employees.forEach(e => pMap[e.id] = e.position || '');
  const isBranch = currentRole === 'branch';
  const myBranchId = isBranch ? String(currentBranch.id) : null;
  let html = '';
  // Employees
  let emps = DATABASE.employees.filter(e => (e.name||'').toLowerCase().includes(q) || String(e.id).includes(q) || (e.position||'').toLowerCase().includes(q));
  if (isBranch) emps = emps.filter(e => String(e.branchId) === myBranchId);
  if (emps.length) {
    html += '<div class="gs-section-title">👥 الموظفين (' + emps.length + ')</div>';
    emps.slice(0, 8).forEach(e => {
      const badge = e.status === 'active' ? '<span class="gs-result-badge" style="background:#d1fae5;color:#065f46">نشط</span>' : '<span class="gs-result-badge" style="background:#fee2e2;color:#991b1b">غير نشط</span>';
      html += `<div class="gs-result-item" onclick="navigateTo('pageEmployees')"><div class="gs-result-icon">👤</div><div class="gs-result-info"><div class="gs-result-title">${escapeHtml(e.name)}</div><div class="gs-result-sub">${e.id} — ${bMap[e.branchId]||e.branchId} — ${e.position||'-'}</div></div>${badge}</div>`;
    });
  }
  // Shifts
  let shifts = DATABASE.shifts.filter(s => (s.empName||'').toLowerCase().includes(q) || (s.type||'').toLowerCase().includes(q) || (s.date||'').includes(q) || formatDate(s.date).includes(q));
  if (isBranch) shifts = shifts.filter(s => String(s.branchId) === myBranchId);
  if (shifts.length) {
    html += '<div class="gs-section-title">📅 الشفتات (' + shifts.length + ')</div>';
    shifts.slice(0, 6).forEach(s => {
      html += `<div class="gs-result-item" onclick="navigateTo('pageBranchShifts')"><div class="gs-result-icon">📅</div><div class="gs-result-info"><div class="gs-result-title">${escapeHtml(s.empName||s.empId)} — ${s.type||''}</div><div class="gs-result-sub">${s.date} | ${s.start||'--'} - ${s.end||'--'}</div></div>${statusBadge(s.status)}</div>`;
    });
  }
  // Leaves
  let leaves = DATABASE.leaves.filter(l => (l.empName||'').toLowerCase().includes(q) || (l.type||'').toLowerCase().includes(q) || (l.notes||'').toLowerCase().includes(q) || (l.date||'').includes(q) || formatDate(l.date).includes(q));
  if (isBranch) leaves = leaves.filter(l => String(l.branchId) === myBranchId);
  if (leaves.length) {
    html += '<div class="gs-section-title">🏖️ الإجازات (' + leaves.length + ')</div>';
    leaves.slice(0, 5).forEach(l => {
      html += `<div class="gs-result-item" onclick="navigateTo('pageLeaves')"><div class="gs-result-icon">🏖️</div><div class="gs-result-info"><div class="gs-result-title">${escapeHtml(l.empName||l.empId)} — ${l.type||''}</div><div class="gs-result-sub">${l.date} | ${l.quantity||''}</div></div>${statusBadge(l.status)}</div>`;
    });
  }
  // Attendance
  let att = DATABASE.attendance.filter(a => (a.empName||'').toLowerCase().includes(q) || (a.date||'').includes(q) || formatDate(a.date).includes(q));
  if (isBranch) att = att.filter(a => String(a.branchId) === myBranchId);
  if (att.length) {
    html += '<div class="gs-section-title">⏰ الحضور (' + att.length + ')</div>';
    att.slice(0, 5).forEach(a => {
      html += `<div class="gs-result-item" onclick="navigateTo('pageAttendance')"><div class="gs-result-icon">⏰</div><div class="gs-result-info"><div class="gs-result-title">${escapeHtml(a.empName||a.empId)}</div><div class="gs-result-sub">${a.date} | ${a.punchInTime||a.start||'--'} → ${a.punchOutTime||a.end||'--'}</div></div>${statusBadge(a.status)}</div>`;
    });
  }
  if (!html) html = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">لا توجد نتائج لـ "' + escapeHtml(q) + '"</div>';
  resultsDiv.innerHTML = html;
  resultsDiv.classList.add('show');
}
function showGlobalSearchResults() { const r = document.getElementById('globalSearchResults'); const q = document.getElementById('globalSearchInput').value.trim(); if (q.length >= 2 && r) r.classList.add('show'); }
function hideGlobalSearchResults() { const r = document.getElementById('globalSearchResults'); if (r) r.classList.remove('show'); }
function clearGlobalSearch() { document.getElementById('globalSearchInput').value = ''; document.getElementById('globalSearchClear').classList.remove('show'); document.getElementById('globalSearchResults').innerHTML = ''; document.getElementById('globalSearchResults').classList.remove('show'); }
function navigateTo(pageId) {
  hideGlobalSearchResults();
  clearGlobalSearch();
  const allowedPages = (NAV_CONF[currentRole] || []).map(n => n.p);
  const allAllowed = [...allowedPages, ...((NAV_MORE[currentRole] || []).map(n => n.p))];
  if (!allAllowed.includes(pageId)) return showToast('غير مسموح بالوصول لهذه الصفحة', 'error');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
  document.querySelectorAll('.nav-item, .bnav-item').forEach(n => n.classList.remove('active'));
  const nav = document.querySelector(`.nav-item[data-page="${pageId}"]`) || document.getElementById('nav_' + pageId);
  if (nav) nav.classList.add('active');
  refreshActivePage();
}
document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); const input = document.getElementById('globalSearchInput'); if (input) input.focus(); }
  if (e.key === 'Escape') { hideGlobalSearchResults(); clearGlobalSearch(); }
});

// ===== Inline Status Change =====
function quickChangeStatus(id, newStatus, type) {
  if (currentRole === 'branch') return showToast('غير مسموح', 'error');
  const table = type === 'shift' ? 'Shifts' : type === 'leave' ? 'Leaves' : 'Attendance';
  cloudAction(table, 'save', { id, status: newStatus }).then(async ok => {
    if (ok) {
      const list = type === 'shift' ? DATABASE.shifts : type === 'leave' ? DATABASE.leaves : DATABASE.attendance;
      const item = list.find(x => String(x.id) === String(id));
      if (item) item.status = newStatus;
      if (type === 'leave' && item) await recalcLeaveBalance(item.empId, item.type);
      refreshActivePage();
      showToast('تم التحديث', 'success');
    }
  });
}

// ===== Copy Shifts Month to Month =====
function copyMonthShifts() {
  if (currentRole !== 'admin') return showToast('هذه الميزة للمدير فقط', 'error');
  const fromMonth = prompt('من شهر (YYYY-MM):');
  const toMonth = prompt('لشهر (YYYY-MM):');
  if (!fromMonth || !toMonth) return;
  const fromShifts = DATABASE.shifts.filter(s => s.date && s.date.startsWith(fromMonth) && s.status === 'Approved');
  if (!fromShifts.length) return showToast('لا توجد شفتات معتمدة في الشهر المصدر', 'warning');
  const dayCount = new Date(parseInt(toMonth.split('-')[0]), parseInt(toMonth.split('-')[1]), 0).getDate();
  const fromDays = new Date(parseInt(fromMonth.split('-')[0]), parseInt(fromMonth.split('-')[1]), 0).getDate();
  const toSave = fromShifts.map(s => {
    const day = parseInt(s.date.split('-')[2]);
    const newDay = Math.min(day, dayCount);
    const newDate = toMonth + '-' + String(newDay).padStart(2, '0');
    return { ...s, id: 'sh' + Date.now() + '_' + Math.random().toString(36).substr(2, 4), date: newDate, status: 'Pending' };
  });
  if (toSave.length) {
    cloudAction('Shifts', 'bulk_save', toSave).then(ok => {
      if (ok) showToast('تم نسخ ' + toSave.length + ' شفت', 'success');
    });
  }
}

async function duplicateShift(shiftId) {
  const shift = DATABASE.shifts.find(s => String(s.id) === String(shiftId));
  if (!shift) return;
  const nextDay = addDaysToDate(shift.date, 1);
  const existing = DATABASE.shifts.find(s => String(s.empId) === String(shift.empId) && s.date === nextDay);
  if (existing) return showToast('الموظف عنده شفت في ' + formatDate(nextDay), 'warning');
  const newShift = { ...shift, id: 'sh' + Date.now() + '_' + Math.random().toString(36).substr(2, 4), date: nextDay, status: 'Pending', notes: 'تم النسخ من ' + formatDate(shift.date) };
  if (await cloudAction('Shifts', 'save', newShift)) {
    showToast('تم نسخ الشفت لـ ' + formatDate(nextDay), 'success');
    renderCalendar();
  }
}

// ===== Smart Alerts =====
function getSmartAlerts() {
  const alerts = [];
  const today = getToday();
  const todayAtt = DATABASE.attendance.filter(a => a.date === today && a.status === 'Approved');
  const delayed = todayAtt.filter(a => a.delayMin > 0);
  const earlyLeft = todayAtt.filter(a => a.earlyLeaveMin > 0);
  if (delayed.length) alerts.push({ icon: '⏰', msg: delayed.length + ' موظف متأخر اليوم', type: 'warning', page: 'pageAttendance' });
  if (earlyLeft.length) alerts.push({ icon: '🚶', msg: earlyLeft.length + ' موظف خرج بدري اليوم', type: 'danger', page: 'pageAttendance' });
  const empShifts = {};
  DATABASE.shifts.filter(s => s.status === 'Approved' && s.date <= today).forEach(s => {
    if (currentRole === 'branch' && String(s.branchId) !== String(currentBranch?.id)) return;
    if (!empShifts[s.empId]) empShifts[s.empId] = [];
    empShifts[s.empId].push(s.date);
  });
  Object.entries(empShifts).forEach(([empId, dates]) => {
    const emp = DATABASE.employees.find(e => String(e.id) === String(empId));
    if (!emp) return;
    const sorted = [...new Set(dates)].sort().reverse();
    let consecutive = 0;
    const d = new Date(today + 'T12:00:00');
    for (let i = 0; i < 7; i++) {
      const ds = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      if (sorted.includes(ds) && !todayAtt.find(a => String(a.empId) === String(empId) && a.date === ds)) consecutive++;
      d.setDate(d.getDate() - 1);
    }
    if (consecutive >= 3) alerts.push({ icon: '🔴', msg: emp.name + ' عنده ' + consecutive + ' غياب متتالي', type: 'danger', page: 'pageAttendance' });
  });
  if (currentRole !== 'branch') {
    const pendingShifts = DATABASE.shifts.filter(s => s.status === 'Pending').length;
    const pendingLeaves = DATABASE.leaves.filter(l => l.status === 'Pending').length;
    if (pendingShifts > 0) alerts.push({ icon: '📋', msg: pendingShifts + ' شفت بانتظار الاعتماد', type: 'info', page: 'pageAdminShifts' });
    if (pendingLeaves > 0) alerts.push({ icon: '📋', msg: pendingLeaves + ' إجراء بانتظار الاعتماد', type: 'info', page: 'pageLeaves' });
  }
  const openingTypes = getOpeningShiftTypes();
  if (openingTypes.length) {
    const branches = currentRole === 'branch' ? DATABASE.branches.filter(b => String(b.id) === String(currentBranch?.id)) : DATABASE.branches;
    let missingCount = 0;
    branches.forEach(b => {
      const hasOpening = DATABASE.shifts.some(s => String(s.branchId) === String(b.id) && s.date === today && (s.status === 'Approved' || s.status === 'Pending') && isOpeningShiftType(s.type));
      if (!hasOpening) missingCount++;
    });
    if (missingCount > 0) alerts.push({ icon: '🏪', msg: missingCount + ' فرع بدون مسئول فتح اليوم', type: 'danger', page: 'pageReview' });
  }
  return alerts;
}

function renderAlerts() {
  const alerts = getSmartAlerts();
  const container = document.getElementById('alertsContainer');
  if (!container) return;
  if (!alerts.length) { container.innerHTML = ''; container.style.display = 'none'; return; }
  container.style.display = 'block';
  container.innerHTML = alerts.map(a => {
    const colors = { warning: '#fef3c7', danger: '#fee2e2', info: '#dbeafe' };
    const textColors = { warning: '#92400e', danger: '#991b1b', info: '#1e40af' };
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;background:${colors[a.type]};border-radius:8px;font-size:12px;color:${textColors[a.type]};cursor:pointer" onclick="navigateTo('${a.page}')"><span style="font-size:16px">${a.icon}</span><strong>${a.msg}</strong><span style="margin-right:auto;font-size:10px;opacity:0.7">←</span></div>`;
  }).join('');
}

// ===== Monthly Report (printable) =====
function printMonthlyReport() {
  if (currentRole !== 'admin') return showToast('هذه الميزة للمدير فقط', 'error');
  const month = prompt('أدخل الشهر (YYYY-MM):', getToday().substring(0,7));
  if (!month) return;
  const shifts = DATABASE.shifts.filter(s => s.date && s.date.startsWith(month) && s.status === 'Approved');
  const attendance = DATABASE.attendance.filter(a => a.date && a.date.startsWith(month));
  const bMap = {}; DATABASE.branches.forEach(b => bMap[b.id] = b.name);
  const pMap = {}; DATABASE.employees.forEach(e => pMap[e.id] = e.position || '');
  const empStats = {};
  shifts.forEach(s => {
    if (!empStats[s.empId]) empStats[s.empId] = { name: s.empName || s.empId, shifts: 0, attended: 0, delayed: 0, earlyLeave: 0, totalDelay: 0 };
    empStats[s.empId].shifts++;
  });
  attendance.filter(a => a.status === 'Approved').forEach(a => {
    if (!empStats[a.empId]) empStats[a.empId] = { name: a.empName || a.empId, shifts: 0, attended: 0, delayed: 0, earlyLeave: 0, totalDelay: 0 };
    empStats[a.empId].attended++;
    if (a.delayMin > 0) { empStats[a.empId].delayed++; empStats[a.empId].totalDelay += a.delayMin; }
    if (a.earlyLeaveMin > 0) empStats[a.empId].earlyLeave++;
  });
  const rows = Object.entries(empStats).map(([id, s]) => `<tr><td>${escapeHtml(s.name)}</td><td>${s.shifts}</td><td>${s.attended}</td><td>${s.shifts - s.attended}</td><td style="color:${s.delayed > 0 ? 'var(--danger)' : 'var(--success)'}">${s.delayed}</td><td style="color:${s.earlyLeave > 0 ? 'var(--danger)' : 'var(--success)'}">${s.earlyLeave}</td><td>${s.totalDelay}</td></tr>`).join('');
  const html = `<html><head><meta charset="UTF-8"><title>تقرير شهري ${month}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Tajawal,sans-serif;padding:20mm;direction:rtl;color:#1e293b}.report-header{text-align:center;border-bottom:3px solid #1a3a5c;padding-bottom:10px;margin-bottom:20px}.report-header h1{font-size:22px;color:#1a3a5c}.report-header p{color:#64748b;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:11px}th{background:#1a3a5c;color:white;padding:8px 10px;border:1px solid #2c5282;font-size:10px}td{padding:6px 10px;border:1px solid #e2e8f0;text-align:center;font-size:10px}tr:nth-child(even) td{background:#f8fafc}.summary{display:flex;gap:16px;margin-top:20px;justify-content:center}.summary-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 20px;text-align:center}.summary-box .num{font-size:20px;font-weight:800;color:#1a3a5c}.summary-box .label{font-size:10px;color:#64748b;margin-top:2px}</style></head><body><div class="report-header"><h1>📊 التقرير الشهري — ${month}</h1><p>نظام إدارة الشفتات — تاريخ الإصدار: ${new Date().toLocaleDateString('ar-EG')}</p></div><table><thead><tr><th>الموظف</th><th>إجمالي الشفتات</th><th>الحضور</th><th>الغياب</th><th>التأخير</th><th>خروج مبكر</th><th>إجمالي التأخير (د)</th></tr></thead><tbody>${rows || '<tr><td colspan="7">لا توجد بيانات</td></tr>'}</tbody></table></body></html>`;
  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.print(); }, 500);
}

// === Dashboard ===
function renderDashboard() {
  const today = new Date();
  const month = today.toISOString().slice(0, 7);
  const todayStr = today.toISOString().slice(0, 10);
  const isBranch = currentRole === 'branch';
  const bId = isBranch ? currentBranch.id : null;

  let emps = DATABASE.employees; if (bId) emps = emps.filter(e => String(e.branchId) === String(bId));
  let shifts = DATABASE.shifts; if (bId) shifts = shifts.filter(s => String(s.branchId) === String(bId));
  let att = DATABASE.attendance; if (bId) att = att.filter(a => String(a.branchId) === String(bId));
  let leaves = DATABASE.leaves; if (bId) leaves = leaves.filter(l => String(l.branchId) === String(bId));

  const totalEmp = emps.length;
  const totalBranches = isBranch ? 1 : DATABASE.branches.length;
  const monthShifts = shifts.filter(s => s.date.startsWith(month));
  const pendingShifts = monthShifts.filter(s => s.status === 'Pending').length;
  const approvedShifts = monthShifts.filter(s => s.status === 'Approved').length;
  const todayShifts = monthShifts.filter(s => s.date === todayStr);
  const todayAtt = att.filter(a => a.date === todayStr);
  const delayedToday = todayAtt.filter(a => a.delayMin > 0);
  const pendingLeaves = leaves.filter(l => l.status === 'Pending').length;
  const absentToday = todayShifts.filter(s => !todayAtt.find(a => String(a.empId) === String(s.empId) && a.date === todayStr)).length;

  document.getElementById('dashboardStats').innerHTML = `
    <div class="stat-card"><div class="stat-icon">👥</div><div class="stat-value">${totalEmp}</div><div class="stat-label">إجمالي الموظفين</div></div>
    ${isBranch ? '' : `<div class="stat-card"><div class="stat-icon">🏢</div><div class="stat-value">${totalBranches}</div><div class="stat-label">الفروع</div></div>`}
    <div class="stat-card" style="border-right-color:var(--warning)"><div class="stat-icon">⏳</div><div class="stat-value">${pendingShifts}</div><div class="stat-label">شفتات معلقة</div></div>
    <div class="stat-card" style="border-right-color:var(--success)"><div class="stat-icon">✅</div><div class="stat-value">${approvedShifts}</div><div class="stat-label">شفتات معتمدة</div></div>
    <div class="stat-card" style="border-right-color:#ef4444"><div class="stat-icon">⏰</div><div class="stat-value">${delayedToday.length}</div><div class="stat-label">متأخرون اليوم</div></div>
    <div class="stat-card" style="border-right-color:#3b82f6"><div class="stat-icon">🏠</div><div class="stat-value">${absentToday}</div><div class="stat-label">غيّاب اليوم</div></div>
    <div class="stat-card" style="border-right-color:#8b5cf6"><div class="stat-icon">🏖️</div><div class="stat-value">${pendingLeaves}</div><div class="stat-label">إجازات معلقة</div></div>
    <div class="stat-card" style="border-right-color:var(--accent)"><div class="stat-icon">📅</div><div class="stat-value">${todayShifts.length}</div><div class="stat-label">شفتات اليوم</div></div>
  `;
  renderDashboardCharts(month);
}

function renderDashboardCharts(month) {
  try {
    const isBranch = currentRole === 'branch';
    const bId = isBranch ? currentBranch.id : null;
    let shifts = DATABASE.shifts; if (bId) shifts = shifts.filter(s => String(s.branchId) === String(bId));
    let att = DATABASE.attendance; if (bId) att = att.filter(a => String(a.branchId) === String(bId));
    let leaves = DATABASE.leaves; if (bId) leaves = leaves.filter(l => String(l.branchId) === String(bId));

    // Branch attendance chart
    const branchData = {};
    DATABASE.branches.forEach(b => { branchData[b.name] = { total: 0, attended: 0 }; });
    shifts.filter(s => s.date.startsWith(month) && s.status === 'Approved').forEach(s => {
      const bName = DATABASE.branches.find(b => String(b.id) === String(s.branchId))?.name || 'غير محدد';
      if (!branchData[bName]) branchData[bName] = { total: 0, attended: 0 };
      branchData[bName].total++;
    });
    att.filter(a => a.date.startsWith(month)).forEach(a => {
      const shift = DATABASE.shifts.find(s => String(s.empId) === String(a.empId) && s.date === a.date);
      if (shift) {
        const bName = DATABASE.branches.find(b => String(b.id) === String(shift.branchId))?.name || 'غير محدد';
        if (branchData[bName]) branchData[bName].attended++;
      }
    });
    const filteredBranch = isBranch ? Object.keys(branchData).filter(k => branchData[k].total > 0) : Object.keys(branchData);
    drawBarChart('chartAttendanceBranch', filteredBranch.map(k => ({ label: k.slice(0, 10), value: branchData[k].total })), filteredBranch.map(k => ({ label: k.slice(0, 10), value: branchData[k].attended })), ['#3b82f6', '#10b981']);

    // Shift status pie
    const statuses = { Approved: 0, Pending: 0, Rejected: 0 };
    shifts.filter(s => s.date.startsWith(month)).forEach(s => { statuses[s.status] = (statuses[s.status] || 0) + 1; });
    drawPieChart('chartShiftStatus', [
      { label: 'معتمد', value: statuses.Approved, color: '#10b981' },
      { label: 'مراجعة', value: statuses.Pending, color: '#f59e0b' },
      { label: 'مرفوض', value: statuses.Rejected, color: '#ef4444' }
    ]);

    // Top delayed
    const delayedEmps = {};
    att.filter(a => a.date.startsWith(month) && a.delayMin > 0).forEach(a => {
      const name = a.empName || a.empId;
      delayedEmps[name] = (delayedEmps[name] || 0) + a.delayMin;
    });
    const topDelayed = Object.entries(delayedEmps).sort((a, b) => b[1] - a[1]).slice(0, 8);
    drawBarChart('chartTopDelayed', topDelayed.map(([n]) => ({ label: n.slice(0, 12), value: 0 })), topDelayed.map(([, v]) => ({ label: '', value: v })), ['#f59e0b'], true);

    // Leaves
    const leaveTypes = {};
    leaves.filter(l => l.date >= month + '-01' && l.date <= month + '-31').forEach(l => {
      const type = l.type || 'أخرى';
      leaveTypes[type] = (leaveTypes[type] || 0) + 1;
    });
    drawPieChart('chartLeaves', Object.entries(leaveTypes).map(([k, v], i) => ({
      label: k, value: v, color: ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'][i % 5]
    })));

    // Attendance rate per branch
    const branchAttRate = {};
    const rateBranches = isBranch ? DATABASE.branches.filter(b => String(b.id) === String(bId)) : DATABASE.branches;
    rateBranches.forEach(b => { branchAttRate[b.name] = { total: 0, attended: 0 }; });
    shifts.filter(s => s.date.startsWith(month) && s.status === 'Approved').forEach(s => {
      const bName = DATABASE.branches.find(b => String(b.id) === String(s.branchId))?.name || 'غير محدد';
      if (!branchAttRate[bName]) branchAttRate[bName] = { total: 0, attended: 0 };
      branchAttRate[bName].total++;
    });
    att.filter(a => a.date.startsWith(month)).forEach(a => {
      const shift = DATABASE.shifts.find(s => String(s.empId) === String(a.empId) && s.date === a.date && s.status === 'Approved');
      if (shift) {
        const bName = DATABASE.branches.find(b => String(b.id) === String(shift.branchId))?.name || 'غير محدد';
        if (branchAttRate[bName]) branchAttRate[bName].attended++;
      }
    });
    const rateLabels = Object.keys(branchAttRate).filter(k => branchAttRate[k].total > 0);
    drawBarChart('chartAttendanceRate',
      rateLabels.map(k => ({ label: k.slice(0, 10), value: branchAttRate[k].total })),
      rateLabels.map(k => ({ label: k.slice(0, 10), value: branchAttRate[k].attended })),
      ['#94a3b8', '#10b981']);

    // Average delay per branch
    const branchDelay = {};
    const delayBranches = isBranch ? DATABASE.branches.filter(b => String(b.id) === String(bId)) : DATABASE.branches;
    delayBranches.forEach(b => { branchDelay[b.name] = { total: 0, count: 0 }; });
    att.filter(a => a.date.startsWith(month) && a.delayMin > 0).forEach(a => {
      const shift = DATABASE.shifts.find(s => String(s.empId) === String(a.empId) && s.date === a.date);
      if (shift) {
        const bName = DATABASE.branches.find(b => String(b.id) === String(shift.branchId))?.name || 'غير محدد';
        if (!branchDelay[bName]) branchDelay[bName] = { total: 0, count: 0 };
        branchDelay[bName].total += a.delayMin;
        branchDelay[bName].count++;
      }
    });
    const delayLabels = Object.keys(branchDelay).filter(k => branchDelay[k].count > 0);
    drawBarChart('chartAvgDelay',
      delayLabels.map(k => ({ label: k.slice(0, 10), value: 0 })),
      delayLabels.map(k => ({ label: '', value: Math.round(branchDelay[k].total / branchDelay[k].count) })),
      ['#f59e0b'], true);
  } catch (e) { console.warn('Chart render error:', e); }
}

function drawBarChart(canvasId, labels1, labels2, colors, stacked) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.parentElement.clientWidth - 40;
  const H = canvas.height = 200;
  ctx.clearRect(0, 0, W, H);
  const isDark = document.body.classList.contains('dark');
  const gridColor = isDark ? '#334155' : '#f0f0f0';
  const textColor = isDark ? '#94a3b8' : '#999';
  const labelColor = isDark ? '#cbd5e1' : '#666';
  const data = stacked ? labels2 : labels1.map((l, i) => ({ label: l.label, value: l.value + (labels2[i]?.value || 0) }));
  if (!data.length || data.every(d => d.value === 0)) { ctx.fillStyle = textColor; ctx.font = '14px Tajawal'; ctx.textAlign = 'center'; ctx.fillText('لا توجد بيانات', W / 2, H / 2); return; }
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barW = Math.min(40, (W - 80) / data.length - 8);
  const chartH = H - 50;
  const startY = 20;

  // Grid lines
  ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = startY + chartH - (chartH * i / 4);
    ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 10, y); ctx.stroke();
    ctx.fillStyle = textColor; ctx.font = '10px Tajawal'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal * i / 4), 35, y + 3);
  }

  data.forEach((d, i) => {
    const x = 50 + i * (barW + 8);
    const barH = (d.value / maxVal) * chartH;
    const gradient = ctx.createLinearGradient(x, startY + chartH - barH, x, startY + chartH);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(1, colors[0] + '88');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(x, startY + chartH - barH, barW, barH, [4, 4, 0, 0]);
    ctx.fill();
    ctx.fillStyle = colors[0]; ctx.font = '11px Tajawal'; ctx.textAlign = 'center';
    if (d.value > 0) ctx.fillText(d.value, x + barW / 2, startY + chartH - barH - 6);
    ctx.fillStyle = labelColor; ctx.font = '10px Tajawal';
    ctx.save(); ctx.translate(x + barW / 2, startY + chartH + 14); ctx.rotate(-0.4);
    ctx.fillText(d.label, 0, 0); ctx.restore();
  });
}

function drawPieChart(canvasId, segments) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.parentElement.clientWidth - 40;
  const H = canvas.height = 200;
  ctx.clearRect(0, 0, W, H);
  const isDark = document.body.classList.contains('dark');
  const pieTextColor = isDark ? '#cbd5e1' : '#333';
  const pieStroke = isDark ? '#1e293b' : 'white';
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) { ctx.fillStyle = isDark ? '#94a3b8' : '#999'; ctx.font = '14px Tajawal'; ctx.textAlign = 'center'; ctx.fillText('لا توجد بيانات', W / 2, H / 2); return; }
  const cx = W / 2 - 60, cy = H / 2, r = Math.min(W, H) / 2 - 30;
  let angle = -Math.PI / 2;
  segments.forEach(seg => {
    if (seg.value === 0) return;
    const sliceAngle = (seg.value / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, angle, angle + sliceAngle); ctx.closePath();
    ctx.fillStyle = seg.color; ctx.fill();
    ctx.strokeStyle = pieStroke; ctx.lineWidth = 2; ctx.stroke();
    angle += sliceAngle;
  });
  // Legend
  let ly = 20;
  segments.forEach(seg => {
    ctx.fillStyle = seg.color;
    ctx.fillRect(W - 120, ly, 12, 12);
    ctx.fillStyle = pieTextColor; ctx.font = '12px Tajawal'; ctx.textAlign = 'right';
    ctx.fillText(`${seg.label} (${seg.value})`, W - 140, ly + 10);
    ly += 22;
  });
}

// === Notifications ===
let NOTIFICATIONS = [];
function loadNotifications() {
  try { NOTIFICATIONS = JSON.parse(localStorage.getItem('hrm_notifications') || '[]'); } catch { NOTIFICATIONS = []; }
}
function saveNotifications() { localStorage.setItem('hrm_notifications', JSON.stringify(NOTIFICATIONS)); }
function addNotification(type, title, desc) {
  loadNotifications();
  NOTIFICATIONS.unshift({ id: 'n' + Date.now(), type, title, desc, time: new Date().toISOString(), read: false });
  if (NOTIFICATIONS.length > 200) NOTIFICATIONS = NOTIFICATIONS.slice(0, 200);
  saveNotifications();
}
function clearAllNotifications() { NOTIFICATIONS = []; saveNotifications(); renderNotifications(); showToast('تم مسح الإشعارات', 'success'); }
function dismissNotification(id) { NOTIFICATIONS = NOTIFICATIONS.filter(n => n.id !== id); saveNotifications(); renderNotifications(); }

function renderNotifications() {
  loadNotifications();
  const filter = document.getElementById('notifFilterType')?.value || '';
  let filtered = NOTIFICATIONS;
  if (filter) filtered = NOTIFICATIONS.filter(n => n.type === filter);
  const iconMap = { delay: '⏰', absence: '❌', early_leave: '🏠', pending_approval: '⏳', import: '📥', system: '⚙️' };
  const classMap = { delay: 'notif-delay', absence: 'notif-absence', early_leave: 'notif-early_leave', pending_approval: 'notif-pending_approval', import: 'notif-import', system: 'notif-system' };
  if (filtered.length === 0) {
    document.getElementById('notificationsList').innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-secondary)"><div style="font-size:48px;margin-bottom:12px">🔔</div>لا توجد إشعارات</div>';
    return;
  }
  document.getElementById('notificationsList').innerHTML = filtered.map(n => {
    const t = new Date(n.time);
    const timeStr = t.toLocaleDateString('ar-EG') + ' ' + t.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    return `<div class="notif-item ${classMap[n.type] || ''}" onclick="dismissNotification('${n.id}')">
      <div class="notif-icon">${iconMap[n.type] || '📋'}</div>
      <div class="notif-content">
        <div class="notif-title">${escapeHtml(n.title)}</div>
        <div class="notif-desc">${escapeHtml(n.desc || '')}</div>
        <div class="notif-time">${timeStr}</div>
      </div>
      <button class="notif-dismiss" onclick="event.stopPropagation();dismissNotification('${n.id}')">✕</button>
    </div>`;
  }).join('');
}

function generateNotificationsFromData() {
  const today = new Date().toISOString().slice(0, 10);
  loadNotifications();
  const existingTitles = new Set(NOTIFICATIONS.slice(0, 50).map(n => n.title));
  const todayAtt = DATABASE.attendance.filter(a => a.date === today);
  todayAtt.filter(a => a.delayMin > 0).forEach(a => {
    const title = `تأخير ${a.empName || a.empId} — ${a.delayMin} دقيقة`;
    if (!existingTitles.has(title)) addNotification('delay', title, `يوم ${today}`);
  });
  todayAtt.filter(a => a.earlyLeaveMin > 0).forEach(a => {
    const title = `خروج مبكر ${a.empName || a.empId} — ${a.earlyLeaveMin} دقيقة`;
    if (!existingTitles.has(title)) addNotification('early_leave', title, `يوم ${today}`);
  });
  const pendingLeaves = DATABASE.leaves.filter(l => l.status === 'Pending');
  if (pendingLeaves.length > 0) {
    const title = `${pendingLeaves.length} إجازات معلقة تحتاج اعتماد`;
    if (!existingTitles.has(title)) addNotification('pending_approval', title, '');
  }
  checkOpeningShiftsNotifications();
}

// ===== Opening Shifts Review =====
function getOpeningShiftTypes() {
  return DATABASE.shiftTypes.filter(t => t.isOpeningShift === 'true' || t.isOpeningShift === true);
}

function isOpeningShiftType(typeName) {
  const openingTypes = getOpeningShiftTypes();
  if (!openingTypes.length) return false;
  return openingTypes.some(t => {
    const tn = (t.name || '').trim().toLowerCase();
    const sn = (typeName || '').trim().toLowerCase();
    return tn === sn || tn.includes(sn) || sn.includes(tn);
  });
}

function checkOpeningShiftsNotifications() {
  const today = new Date().toISOString().slice(0, 10);
  const openingTypes = getOpeningShiftTypes();
  if (!openingTypes.length) return;
  loadNotifications();
  const existingTitles = new Set(NOTIFICATIONS.slice(0, 50).map(n => n.title));
  const branches = currentRole === 'branch' ? DATABASE.branches.filter(b => String(b.id) === String(currentBranch?.id)) : DATABASE.branches;
  branches.forEach(b => {
    const hasOpening = DATABASE.shifts.some(s => String(s.branchId) === String(b.id) && s.date === today && (s.status === 'Approved' || s.status === 'Pending') && isOpeningShiftType(s.type));
    if (!hasOpening) {
      const title = `⚠️ ${b.name} بدون مسئول فتح اليوم`;
      if (!existingTitles.has(title)) addNotification('system', title, 'تأكد من تعيين مسئول فتح الفرع');
    }
  });
}

function renderReview() {
  const reviewBranchFilter = document.getElementById('reviewBranchFilter');
  if (reviewBranchFilter && reviewBranchFilter.options.length <= 1) {
    const allBranches = currentRole === 'branch' ? [currentBranch] : DATABASE.branches;
    reviewBranchFilter.innerHTML = '<option value="">كل الفروع</option>' + allBranches.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  }

  const weekInput = document.getElementById('reviewWeek');
  let weekStart, weekEnd;
  if (weekInput && weekInput.value) {
    const parts = weekInput.value.split('-W');
    const y = parseInt(parts[0]);
    const w = parseInt(parts[1]);
    const jan1 = new Date(y, 0, 1);
    const dayOfWeek = jan1.getDay();
    const diff = (w - 1) * 7 + ((6 - dayOfWeek + 7) % 7);
    weekStart = new Date(y, 0, 1 + diff);
    weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  } else {
    const today = new Date();
    const day = today.getDay();
    weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - ((day + 1) % 7));
    weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
  }

  const days = [];
  const d = new Date(weekStart);
  while (d <= weekEnd) {
    days.push({ date: d.toISOString().slice(0, 10), label: ['الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','الأحد'][(d.getDay() + 6) % 7] });
    d.setDate(d.getDate() + 1);
  }

  const filterBranch = document.getElementById('reviewBranchFilter')?.value || '';
  let branches = currentRole === 'branch' ? DATABASE.branches.filter(b => String(b.id) === String(currentBranch?.id)) : DATABASE.branches;
  if (filterBranch) branches = branches.filter(b => String(b.id) === String(filterBranch));

  const thead = document.getElementById('reviewThead');
  const tbody = document.getElementById('reviewTable');
  if (!thead || !tbody) return;

  thead.innerHTML = `<tr><th style="position:sticky;right:0;background:#f8fafc;z-index:5">الفرع</th>${days.map(day => `<th>${day.label}<br><span style="font-size:9px;font-weight:400;opacity:0.7">${day.date.slice(5)}</span></th>`).join('')}<th>الحالة</th></tr>`;

  let html = '';
  let allMissing = [];

  branches.forEach(b => {
    let rowHtml = `<tr><td style="font-weight:700;position:sticky;right:0;background:white;z-index:5">${escapeHtml(b.name)}</td>`;
    let missing = 0;
    days.forEach(day => {
      const shift = DATABASE.shifts.find(s => String(s.branchId) === String(b.id) && s.date === day.date && (s.status === 'Approved' || s.status === 'Pending') && isOpeningShiftType(s.type));
      if (shift) {
        rowHtml += `<td style="text-align:center;color:#16a34a;font-size:12px;cursor:pointer" onclick="navigateTo('pageCalendar')" title="${escapeHtml(shift.empName || '')} — ${shift.type || ''}">✅<br><span style="font-size:9px;color:#666">${escapeHtml(shift.empName || '').split(' ').slice(0,2).join(' ')}</span></td>`;
      } else {
        missing++;
        rowHtml += `<td style="text-align:center;color:#dc2626;font-size:16px;cursor:pointer" onclick="navigateTo('pageCalendar')" title="اضغط لإضافة شفتة">❌</td>`;
        allMissing.push({ branch: b.name, branchId: b.id, date: day.date, dayLabel: day.label });
      }
    });
    const status = missing === 0 ? '<span class="badge badge-approved">✓ مكتمل</span>' : `<span class="badge badge-rejected">⚠️ ${missing} ناقص</span>`;
    rowHtml += `<td>${status}</td></tr>`;
    html += rowHtml;
  });

  tbody.innerHTML = html || '<tr><td colspan="10" style="text-align:center">لا توجد فروع</td></tr>';

  const alertsDiv = document.getElementById('reviewAlerts');
  if (alertsDiv) {
    if (allMissing.length === 0) {
      alertsDiv.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><div style="font-size:32px;margin-bottom:8px">✅</div>جميع الفروع لها مسئول فتح هذا الأسبوع</div>';
    } else {
      alertsDiv.innerHTML = allMissing.map(m => `<div class="notif-item notif-absence" onclick="navigateTo('pageCalendar')">
        <div class="notif-icon">⚠️</div>
        <div class="notif-content">
          <div class="notif-title">${escapeHtml(m.branch)}</div>
          <div class="notif-desc">${m.dayLabel} — ${m.date} بدون مسئول فتح</div>
        </div>
      </div>`).join('');
    }
  }
}


// PWA: فعّلها فقط عند الاستضافة على HTTPS
// if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('service-worker.js').catch(() => {}); }); });
loadNotifications();
fetchCloudData().then(() => { generateNotificationsFromData(); });
