(() => {
  'use strict';

  const STORAGE_KEY = 'line-weight-data-v1';
  const KG_PER_LB = 0.45359237;
  const DAY = 86400000;
  const $ = id => document.getElementById(id);

  const defaultState = () => ({ version: 1, unit: 'lb', theme: 'system', goal: null, entries: [] });
  let state = loadState();
  let rangeDays = 84;
  let editingId = null;
  let toastTimer;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) return defaultState();
      return { ...defaultState(), ...parsed };
    } catch { return defaultState(); }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function dateFromISO(value) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  }

  function isoFromDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function todayISO() { return isoFromDate(new Date()); }
  function daysBetween(a, b) { return Math.round((dateFromISO(b) - dateFromISO(a)) / DAY); }
  function round(value, places = 1) { const p = 10 ** places; return Math.round((value + Number.EPSILON) * p) / p; }
  function toKg(value, unit = state.unit) { return unit === 'lb' ? value * KG_PER_LB : value; }
  function fromKg(value, unit = state.unit) { return unit === 'lb' ? value / KG_PER_LB : value; }
  function unitDigits() { return state.unit === 'lb' ? 1 : 1; }
  function formatWeight(kg, withUnit = false) {
    if (!Number.isFinite(kg)) return '—';
    const text = fromKg(kg).toFixed(unitDigits());
    return withUnit ? `${text} ${state.unit}` : text;
  }

  function sortedEntries() { return [...state.entries].sort((a, b) => a.date.localeCompare(b.date)); }

  function recentSevenDayAverage(entries = sortedEntries()) {
    if (!entries.length) return null;
    const end = entries.at(-1).date;
    const window = entries.filter(entry => daysBetween(entry.date, end) >= 0 && daysBetween(entry.date, end) <= 6);
    return window.reduce((sum, entry) => sum + entry.kg, 0) / window.length;
  }

  function movingAverage(entries) {
    return entries.map((entry, index) => {
      const window = entries.filter((candidate, i) => i <= index && daysBetween(candidate.date, entry.date) >= 0 && daysBetween(candidate.date, entry.date) <= 6);
      return { date: entry.date, kg: window.reduce((sum, item) => sum + item.kg, 0) / window.length };
    });
  }

  function regression(entries = sortedEntries()) {
    if (entries.length < 3) return null;
    const end = entries.at(-1).date;
    const recent = entries.filter(entry => daysBetween(entry.date, end) <= 41);
    const span = daysBetween(recent[0].date, recent.at(-1).date);
    if (recent.length < 3 || span < 2) return null;
    const origin = recent[0].date;
    const points = recent.map(entry => ({ x: daysBetween(origin, entry.date), y: entry.kg }));
    const xMean = points.reduce((s, p) => s + p.x, 0) / points.length;
    const yMean = points.reduce((s, p) => s + p.y, 0) / points.length;
    const sxx = points.reduce((s, p) => s + (p.x - xMean) ** 2, 0);
    if (!sxx) return null;
    const slope = points.reduce((s, p) => s + (p.x - xMean) * (p.y - yMean), 0) / sxx;
    const intercept = yMean - slope * xMean;
    const residuals = points.map(p => p.y - (intercept + slope * p.x));
    const sse = residuals.reduce((s, value) => s + value ** 2, 0);
    const sst = points.reduce((s, p) => s + (p.y - yMean) ** 2, 0);
    const r2 = sst ? Math.max(0, 1 - sse / sst) : 0;
    const rmse = Math.sqrt(sse / Math.max(1, points.length - 2));
    let confidence = 'Early estimate';
    if (recent.length >= 14 && span >= 21 && r2 >= .35) confidence = 'Moderate confidence';
    else if (recent.length >= 6 && span >= 10) confidence = 'Low confidence';
    return { slope, intercept, origin, span, count: recent.length, r2, rmse, confidence };
  }

  function forecastGoal(model, currentTrend) {
    if (!model || !state.goal || !Number.isFinite(currentTrend)) return null;
    const delta = state.goal.weightKg - currentTrend;
    if (Math.abs(delta) < .05) return { date: new Date(), days: 0 };
    if (Math.abs(model.slope) < .003 || Math.sign(delta) !== Math.sign(model.slope)) return null;
    const days = delta / model.slope;
    if (!Number.isFinite(days) || days < 0 || days > 730) return null;
    const date = new Date();
    date.setDate(date.getDate() + Math.round(days));
    return { date, days };
  }

  function formatSigned(value, suffix = '') {
    if (Math.abs(value) < .05) return `0.0${suffix}`;
    return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}${suffix}`;
  }

  function friendlyDate(iso, options = { month: 'short', day: 'numeric' }) {
    return new Intl.DateTimeFormat(undefined, options).format(dateFromISO(iso));
  }

  function relativeDate(iso) {
    const delta = daysBetween(iso, todayISO());
    if (delta === 0) return 'Today';
    if (delta === 1) return 'Yesterday';
    if (delta > 1 && delta < 7) return `${delta} days ago`;
    return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(dateFromISO(iso));
  }

  function applyTheme() {
    const resolved = state.theme === 'system'
      ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : state.theme;
    document.documentElement.dataset.theme = resolved;
    const color = resolved === 'light' ? '#f3f5f7' : '#090a0d';
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.content = color);
  }

  function render() {
    applyTheme();
    const entries = sortedEntries();
    const trend = recentSevenDayAverage(entries);
    const model = regression(entries);
    const weeklyKg = model ? model.slope * 7 : null;
    const weeklyDisplay = weeklyKg == null ? null : fromKg(Math.abs(weeklyKg)) * Math.sign(weeklyKg);
    const goalForecast = forecastGoal(model, trend);

    $('trendWeight').textContent = formatWeight(trend);
    $('trendUnit').textContent = state.unit;
    if (weeklyDisplay == null || model.span < 7) $('weeklyChange').textContent = entries.length ? 'Building your trend' : 'Add your first weight';
    else $('weeklyChange').textContent = `${formatSigned(weeklyDisplay)} ${state.unit}/week`;

    if (state.goal && trend != null) {
      const distance = Math.abs(fromKg(state.goal.weightKg - trend));
      $('goalDistance').textContent = distance < .05 ? 'Goal reached' : `${distance.toFixed(1)} ${state.unit} to goal`;
    } else $('goalDistance').textContent = 'No goal yet';

    $('paceValue').textContent = weeklyDisplay == null || model.span < 7 ? '—' : `${formatSigned(weeklyDisplay)} ${state.unit}`;
    $('paceNote').textContent = model ? `${model.confidence} · ${model.span} days` : 'Needs 3 entries over 7+ days';

    if (goalForecast) {
      $('forecastDate').textContent = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(goalForecast.date);
      $('forecastNote').textContent = `${model.confidence} · if pace continues`;
    } else {
      $('forecastDate').textContent = '—';
      $('forecastNote').textContent = !state.goal ? 'Set a goal' : !model ? 'Needs more data' : 'Current trend is not moving toward goal';
    }

    renderGoal(entries, trend);
    renderHistory(entries);
    renderChart(entries);
    syncFormUnits();
  }

  function renderGoal(entries, trend) {
    if (!state.goal) {
      $('goalTitle').textContent = 'Set your direction';
      $('goalStart').textContent = 'Start —';
      $('goalTarget').textContent = 'Goal —';
      $('goalProgress').style.width = '0%';
      $('goalGuidance').textContent = 'A goal is optional. Your history stays useful without one.';
      $('editGoalButton').textContent = 'Set goal';
      return;
    }
    $('editGoalButton').textContent = 'Edit';
    $('goalTitle').textContent = `${formatWeight(state.goal.weightKg, true)}${state.goal.date ? ` by ${friendlyDate(state.goal.date, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}`;
    const startKg = state.goal.startWeightKg ?? entries[0]?.kg ?? trend;
    const total = state.goal.weightKg - startKg;
    const moved = (trend ?? startKg) - startKg;
    const progress = total ? Math.min(100, Math.max(0, moved / total * 100)) : 100;
    $('goalProgress').style.width = `${progress}%`;
    $('goalStart').textContent = `Start ${formatWeight(startKg, true)}`;
    $('goalTarget').textContent = `Goal ${formatWeight(state.goal.weightKg, true)}`;

    let guidance = `${Math.round(progress)}% of the planned change completed.`;
    if (state.goal.date && trend != null) {
      const days = daysBetween(todayISO(), state.goal.date);
      const changeLb = (trend - state.goal.weightKg) / KG_PER_LB;
      if (days > 0 && changeLb > 0) {
        const planned = changeLb / days * 7;
        if (planned > 2) guidance = `Your goal asks for about ${planned.toFixed(1)} lb/week. CDC guidance describes 1–2 lb/week as gradual; consider discussing a faster pace with a clinician.`;
        else if (planned >= 1) guidance = `Your goal asks for about ${planned.toFixed(1)} lb/week, within the CDC’s general gradual-loss range.`;
        else guidance = `Your goal asks for about ${planned.toFixed(1)} lb/week—a gradual pace.`;
      }
    }
    $('goalGuidance').textContent = guidance;
  }

  function renderHistory(entries) {
    const list = $('historyList');
    list.replaceChildren();
    $('historyCount').textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'history-empty';
      empty.textContent = 'Your weigh-ins will appear here.';
      list.append(empty);
      return;
    }
    [...entries].reverse().slice(0, 8).forEach((entry, reverseIndex, reversed) => {
      const chronologicalIndex = entries.findIndex(item => item.id === entry.id);
      const previous = entries[chronologicalIndex - 1];
      const delta = previous ? fromKg(entry.kg - previous.kg) : null;
      const row = document.createElement('div');
      row.className = 'history-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `Edit ${formatWeight(entry.kg, true)} from ${friendlyDate(entry.date, { dateStyle: 'long' })}`);
      button.innerHTML = `<span class="history-date">${friendlyDate(entry.date, { month: 'short', day: 'numeric' })}<span class="history-relative">${relativeDate(entry.date)}</span></span><span class="history-weight">${formatWeight(entry.kg, true)}<span class="history-delta">${delta == null ? 'First entry' : `${formatSigned(delta)} since prior`}</span></span>`;
      button.addEventListener('click', () => openWeightDialog(entry.id));
      row.append(button);
      list.append(row);
    });
  }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function renderChart(allEntries) {
    const canvas = $('weightChart');
    const empty = $('chartEmpty');
    if (!allEntries.length) {
      empty.classList.remove('hidden');
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    empty.classList.add('hidden');
    const endDate = allEntries.at(-1).date;
    const entries = rangeDays === 'all' ? allEntries : allEntries.filter(entry => daysBetween(entry.date, endDate) <= Number(rangeDays));
    const trend = movingAverage(entries);
    const model = regression(allEntries);
    const projectionDays = model && model.span >= 7 ? 28 : 0;
    const projectedKg = projectionDays ? trend.at(-1).kg + model.slope * projectionDays : null;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    const w = rect.width, h = rect.height;
    const pad = { top: 14, right: 10, bottom: 28, left: 43 };
    const values = entries.map(e => e.kg).concat(projectedKg == null ? [] : [projectedKg]);
    let min = Math.min(...values), max = Math.max(...values);
    const spread = Math.max(max - min, toKg(state.unit === 'lb' ? 4 : 2, state.unit));
    min -= spread * .18; max += spread * .18;
    const first = dateFromISO(entries[0].date).getTime();
    const lastMeasured = dateFromISO(entries.at(-1).date).getTime();
    let last = lastMeasured + projectionDays * DAY;
    if (last === first) last = first + DAY;
    const xTime = time => pad.left + (time - first) / (last - first) * (w - pad.left - pad.right);
    const x = iso => xTime(dateFromISO(iso).getTime());
    const y = kg => pad.top + (max - kg) / (max - min) * (h - pad.top - pad.bottom);
    const line = css('--line');
    const muted = css('--muted');
    const accent = css('--accent');
    const accent2 = css('--accent-2');

    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = muted;
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const yy = pad.top + i * (h - pad.top - pad.bottom) / 2;
      ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(w - pad.right, yy); ctx.stroke();
      const kg = max - i * (max - min) / 2;
      ctx.fillText(formatWeight(kg), 2, yy);
    }

    if (state.goal && state.goal.weightKg >= min && state.goal.weightKg <= max) {
      const gy = y(state.goal.weightKg);
      ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = muted; ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(w - pad.right, gy); ctx.stroke(); ctx.restore();
    }

    const gradient = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
    gradient.addColorStop(0, accent + '42'); gradient.addColorStop(1, accent + '00');
    if (trend.length > 1) {
      ctx.beginPath();
      trend.forEach((point, i) => i ? ctx.lineTo(x(point.date), y(point.kg)) : ctx.moveTo(x(point.date), y(point.kg)));
      ctx.lineTo(x(trend.at(-1).date), h - pad.bottom); ctx.lineTo(x(trend[0].date), h - pad.bottom); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
      ctx.beginPath();
      trend.forEach((point, i) => i ? ctx.lineTo(x(point.date), y(point.kg)) : ctx.moveTo(x(point.date), y(point.kg)));
      const stroke = ctx.createLinearGradient(pad.left, 0, w - pad.right, 0); stroke.addColorStop(0, accent2); stroke.addColorStop(1, accent);
      ctx.strokeStyle = stroke; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    }

    if (projectionDays) {
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = .72;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x(trend.at(-1).date), y(trend.at(-1).kg));
      ctx.lineTo(xTime(last), y(projectedKg));
      ctx.stroke();
      ctx.restore();
    }

    entries.forEach(entry => {
      ctx.beginPath(); ctx.arc(x(entry.date), y(entry.kg), 2.6, 0, Math.PI * 2); ctx.fillStyle = css('--surface'); ctx.fill(); ctx.lineWidth = 1.4; ctx.strokeStyle = muted; ctx.stroke();
    });

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = muted;
    ctx.fillText(friendlyDate(entries[0].date), pad.left, h - 4);
    const endLabel = projectionDays ? '+4 wk' : friendlyDate(entries.at(-1).date);
    const width = ctx.measureText(endLabel).width;
    ctx.fillText(endLabel, w - pad.right - width, h - 4);
    canvas.setAttribute('aria-label', `${entries.length} weigh-ins. Current seven-day trend ${formatWeight(trend.at(-1).kg, true)}${projectionDays ? `, projected four-week value ${formatWeight(projectedKg, true)}` : ''}.`);
  }

  function syncFormUnits() {
    ['formUnit', 'goalFormUnit', 'welcomeUnit'].forEach(id => $(id).textContent = state.unit);
    $('unitSelect').value = state.unit;
    $('themeSelect').value = state.theme;
  }

  function openWeightDialog(id = null) {
    editingId = id;
    const entry = id ? state.entries.find(item => item.id === id) : null;
    $('weightDialogTitle').textContent = entry ? 'Edit weigh-in' : 'Log weight';
    $('weightInput').value = entry ? formatWeight(entry.kg) : (state.entries.length ? formatWeight(sortedEntries().at(-1).kg) : '');
    $('dateInput').value = entry?.date ?? todayISO();
    $('dateInput').max = todayISO();
    $('deleteEntryButton').classList.toggle('hidden', !entry);
    $('weightDialog').showModal();
    setTimeout(() => $('weightInput').select(), 80);
  }

  function openGoalDialog() {
    $('goalWeightInput').value = state.goal ? formatWeight(state.goal.weightKg) : '';
    $('goalDateInput').value = state.goal?.date ?? '';
    $('clearGoalButton').classList.toggle('hidden', !state.goal);
    $('goalDialog').showModal();
    setTimeout(() => $('goalWeightInput').select(), 80);
  }

  function upsertWeight(weight, unit, date) {
    const kg = toKg(Number(weight), unit);
    if (!Number.isFinite(kg) || kg <= 0 || kg > 680) throw new Error('Enter a valid weight.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Enter a valid date.');
    if (date > todayISO()) throw new Error('A weigh-in cannot be in the future.');
    const existing = state.entries.find(entry => entry.date === date && entry.id !== editingId);
    if (existing) {
      existing.kg = kg;
      if (editingId) state.entries = state.entries.filter(entry => entry.id !== editingId);
    } else if (editingId) {
      const entry = state.entries.find(item => item.id === editingId);
      entry.kg = kg; entry.date = date;
    } else {
      state.entries.push({ id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, date, kg, createdAt: new Date().toISOString() });
    }
    saveState(); render();
    return { date, weight: round(fromKg(kg, unit)), unit };
  }

  function setGoal(weight, unit, date = null) {
    const kg = toKg(Number(weight), unit);
    if (!Number.isFinite(kg) || kg <= 0 || kg > 680) throw new Error('Enter a valid goal weight.');
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Enter a valid target date.');
    state.goal = { weightKg: kg, date: date || null, startWeightKg: state.goal?.startWeightKg ?? recentSevenDayAverage() ?? sortedEntries().at(-1)?.kg ?? null };
    saveState(); render();
    return { weight: round(fromKg(kg, unit)), unit, date: date || null };
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('show');
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2200);
  }

  function closeOnBackdrop(dialog) {
    dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) dialog.close();
    });
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function installEvents() {
    $('addButton').addEventListener('click', () => openWeightDialog());
    $('editGoalButton').addEventListener('click', openGoalDialog);
    $('settingsButton').addEventListener('click', () => $('settingsDialog').showModal());
    $('closeSettings').addEventListener('click', () => $('settingsDialog').close());
    ['weightDialog', 'goalDialog', 'settingsDialog'].forEach(id => closeOnBackdrop($(id)));

    $('weightForm').addEventListener('submit', event => {
      event.preventDefault();
      try { upsertWeight($('weightInput').value, state.unit, $('dateInput').value); $('weightDialog').close(); showToast(editingId ? 'Weigh-in updated' : 'Weigh-in saved'); editingId = null; }
      catch (error) { showToast(error.message); }
    });

    $('deleteEntryButton').addEventListener('click', () => {
      if (!editingId) return;
      state.entries = state.entries.filter(entry => entry.id !== editingId);
      saveState(); render(); $('weightDialog').close(); editingId = null; showToast('Weigh-in deleted');
    });

    $('goalForm').addEventListener('submit', event => {
      event.preventDefault();
      try { setGoal($('goalWeightInput').value, state.unit, $('goalDateInput').value || null); $('goalDialog').close(); showToast('Goal saved'); }
      catch (error) { showToast(error.message); }
    });

    $('clearGoalButton').addEventListener('click', () => { state.goal = null; saveState(); render(); $('goalDialog').close(); showToast('Goal cleared'); });

    $('welcomeForm').addEventListener('submit', event => {
      event.preventDefault();
      try { upsertWeight($('welcomeWeight').value, state.unit, todayISO()); $('welcomeDialog').close(); showToast('First weigh-in saved'); }
      catch (error) { showToast(error.message); }
    });

    document.querySelectorAll('.range-switch button').forEach(button => button.addEventListener('click', () => {
      rangeDays = button.dataset.range === 'all' ? 'all' : Number(button.dataset.range);
      document.querySelectorAll('.range-switch button').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', item === button ? 'true' : 'false'); });
      $('chartRange').textContent = rangeDays === 'all' ? 'All recorded data' : `Last ${rangeDays === 28 ? 4 : rangeDays === 84 ? 12 : 52} weeks`;
      renderChart(sortedEntries());
    }));

    $('unitSelect').addEventListener('change', event => { state.unit = event.target.value; saveState(); render(); });
    $('themeSelect').addEventListener('change', event => { state.theme = event.target.value; saveState(); render(); });
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (state.theme === 'system') { applyTheme(); renderChart(sortedEntries()); } });

    $('exportJsonButton').addEventListener('click', () => download(`line-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json'));
    $('exportCsvButton').addEventListener('click', () => {
      const rows = [['date', `weight_${state.unit}`], ...sortedEntries().map(entry => [entry.date, formatWeight(entry.kg)])];
      download(`line-weights-${todayISO()}.csv`, rows.map(row => row.join(',')).join('\n'), 'text/csv');
    });
    $('importInput').addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (parsed.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.some(entry => !entry.date || !Number.isFinite(entry.kg))) throw new Error();
        state = { ...defaultState(), ...parsed }; saveState(); render(); $('settingsDialog').close(); showToast('Backup imported');
      } catch { showToast('That backup could not be read'); }
      event.target.value = '';
    });
    $('resetButton').addEventListener('click', () => {
      if (!confirm('Erase every weigh-in and goal from this device? This cannot be undone.')) return;
      state = defaultState(); saveState(); render(); $('settingsDialog').close(); $('welcomeDialog').showModal();
    });

    $('sampleButton').addEventListener('click', () => {
      const start = new Date(); start.setDate(start.getDate() - 77);
      state.entries = Array.from({ length: 78 }, (_, i) => {
        const date = new Date(start); date.setDate(start.getDate() + i);
        const lb = 211 - i * .115 + Math.sin(i * 1.7) * .65 + Math.cos(i * .31) * .35;
        return { id: `sample-${i}`, date: isoFromDate(date), kg: toKg(lb, 'lb'), createdAt: date.toISOString() };
      });
      state.goal = { weightKg: toKg(190, 'lb'), date: null, startWeightKg: state.entries[0].kg };
      saveState(); render(); showToast('Sample data added');
    });

    let resizeTimer;
    addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => renderChart(sortedEntries()), 100); });
  }

  function registerWebMCP() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const tools = [
      {
        name: 'log_weight', title: 'Log weight', description: 'Save or replace a weigh-in for a date and update the visible trend.',
        inputSchema: { type: 'object', properties: { weight: { type: 'number', minimum: 1 }, unit: { type: 'string', enum: ['lb', 'kg'] }, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, required: ['weight', 'unit', 'date'], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: input => upsertWeight(input.weight, input.unit, input.date)
      },
      {
        name: 'set_weight_goal', title: 'Set weight goal', description: 'Set the target weight and optional target date shown in the app.',
        inputSchema: { type: 'object', properties: { weight: { type: 'number', minimum: 1 }, unit: { type: 'string', enum: ['lb', 'kg'] }, date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, required: ['weight', 'unit'], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: input => setGoal(input.weight, input.unit, input.date ?? null)
      },
      {
        name: 'read_weight_summary', title: 'Read weight summary', description: 'Read the current seven-day trend, weekly pace, goal, and forecast without changing data.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => {
          const trend = recentSevenDayAverage(); const model = regression(); const forecast = forecastGoal(model, trend);
          return { trendWeight: trend == null ? null : round(fromKg(trend)), unit: state.unit, weeklyChange: model ? round(fromKg(model.slope * 7)) : null, goalWeight: state.goal ? round(fromKg(state.goal.weightKg)) : null, forecastDate: forecast ? isoFromDate(forecast.date) : null, confidence: model?.confidence ?? null, entries: state.entries.length };
        }
      }
    ];
    tools.forEach(tool => { try { Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch {} });
  }

  installEvents();
  render();
  if (!state.entries.length) setTimeout(() => $('welcomeDialog').showModal(), 100);
  registerWebMCP();
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
})();
