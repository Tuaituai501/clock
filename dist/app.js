const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const STORAGE = {
  tasks: "light-time-tasks-v1",
  focus: "light-time-focus-v1",
  timeEntries: "light-time-time-entries-v1"
};

let tickHandle;
let deferredInstall;
let stopwatch = { running: false, accumulated: 0, startedAt: null, laps: [] };
let countdown = { running: false, duration: 25 * 60_000, remaining: 25 * 60_000, endAt: null };
let focus = { running: false, mode: "focus", duration: 25 * 60_000, remaining: 25 * 60_000, endAt: null };
let tasks = safeRead(STORAGE.tasks, []);
let focusData = safeRead(STORAGE.focus, { total: 0, days: {} });
let timeEntries = safeRead(STORAGE.timeEntries, []);
const ANALYTICS_COLORS = ["#5e967d", "#d88864", "#8477bd", "#d3aa49", "#5c9eaf", "#ca7291"];

function safeRead(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatTime(milliseconds, withHours = true) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const two = (number) => String(number).padStart(2, "0");
  return withHours ? `${two(hours)}:${two(minutes)}:${two(secs)}` : `${two(Math.floor(seconds / 60))}:${two(secs)}`;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function todayInputValue() {
  const now = new Date();
  const two = (number) => String(number).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

function dateKeyFromInput(value) {
  if (!value) return todayKey();
  const [year, month, day] = value.split("-").map(Number);
  return `${year}-${month}-${day}`;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2600);
}

function currentStopwatchTaskName() {
  return $("#stopwatch-name").value.trim() || "未命名事项";
}

function addTimeEntry(name, durationMs, source = "stopwatch") {
  if (!Number.isFinite(durationMs) || durationMs < 1_000) return;
  timeEntries.push({
    id: String(Date.now()) + Math.random().toString(16).slice(2),
    day: todayKey(),
    name: name || "未命名事项",
    durationMs: Math.round(durationMs),
    source
  });
  if (timeEntries.length > 1_000) timeEntries = timeEntries.slice(-1_000);
  save(STORAGE.timeEntries, timeEntries);
}

function notify(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    navigator.serviceWorker?.ready.then((registration) => {
      registration.showNotification(title, { body, icon: "./icon.svg", tag: "light-time" });
    }).catch(() => new Notification(title, { body }));
  }
  toast(body);
}

function updateTodayLabel() {
  const text = new Intl.DateTimeFormat("zh-CN", {
    month: "long", day: "numeric", weekday: "long"
  }).format(new Date());
  $("#today-label").textContent = text;
}

function updateStopwatch() {
  const elapsed = stopwatch.running ? stopwatch.accumulated + Date.now() - stopwatch.startedAt : stopwatch.accumulated;
  const taskName = currentStopwatchTaskName();
  $("#stopwatch-display").textContent = formatTime(elapsed);
  $("#stopwatch-state").textContent = stopwatch.running ? "正在进行" : elapsed ? "已暂停" : "准备开始";
  $("#stopwatch-task").textContent = taskName;
  $("#stopwatch-subtext").textContent = stopwatch.running ? "正在计时" : "累计用时";
  $("#stopwatch-start").textContent = stopwatch.running ? "暂停" : elapsed ? "继续" : "开始";
  $("#stopwatch-ring").style.setProperty("--progress", `${(elapsed % 3_600_000) / 3_600_000 * 360}deg`);
}

function stopwatchStartOrPause() {
  if (stopwatch.running) {
    const segment = Date.now() - stopwatch.startedAt;
    stopwatch.accumulated += segment;
    addTimeEntry(currentStopwatchTaskName(), segment);
    stopwatch.running = false;
    stopwatch.startedAt = null;
    toast("已暂停，随时可以继续。");
  } else {
    stopwatch.startedAt = Date.now();
    stopwatch.running = true;
  }
  updateStopwatch();
}

function renderLaps() {
  const list = $("#lap-list");
  $("#lap-count").textContent = `${stopwatch.laps.length} 段`;
  if (!stopwatch.laps.length) {
    list.innerHTML = '<li class="empty-row">开始后，随时为这一段留下标记。</li>';
    return;
  }
  list.innerHTML = stopwatch.laps.slice().reverse().map((lap, index) =>
    `<li><span>第 ${stopwatch.laps.length - index} 段</span><time>${formatTime(lap)}</time></li>`
  ).join("");
}

function addLap() {
  const elapsed = stopwatch.running ? stopwatch.accumulated + Date.now() - stopwatch.startedAt : stopwatch.accumulated;
  if (!elapsed) return toast("先开始一段计时吧。");
  stopwatch.laps.push(elapsed);
  renderLaps();
  toast("已记录这一段。");
}

function resetStopwatch() {
  if (stopwatch.running) {
    addTimeEntry(currentStopwatchTaskName(), Date.now() - stopwatch.startedAt);
  }
  stopwatch = { running: false, accumulated: 0, startedAt: null, laps: [] };
  updateStopwatch();
  renderLaps();
}

function updateCountdown() {
  const remaining = countdown.running ? Math.max(0, countdown.endAt - Date.now()) : countdown.remaining;
  if (countdown.running && remaining <= 0) {
    countdown.running = false;
    countdown.remaining = 0;
    $("#countdown-start").textContent = "重新开始";
    $("#countdown-message").textContent = "时间到，去做一件让自己开心的小事。";
    notify("轻时刻 · 倒计时结束", `${$("#countdown-name").value || "倒计时"} 已结束。`);
  }
  $("#countdown-display").textContent = formatTime(remaining, false);
  $("#countdown-label").textContent = $("#countdown-name").value || "倒计时";
  if (remaining > 0) {
    $("#countdown-start").textContent = countdown.running ? "暂停" : countdown.remaining !== countdown.duration ? "继续" : "开始计时";
    $("#countdown-message").textContent = countdown.running ? "放下杂念，时间正为你流动。" : `给自己 ${Math.ceil(countdown.duration / 60_000)} 分钟的专注。`;
  }
}

function setCountdownMinutes(minutes) {
  const validMinutes = Math.min(240, Math.max(1, Number(minutes) || 25));
  countdown = { running: false, duration: validMinutes * 60_000, remaining: validMinutes * 60_000, endAt: null };
  $("#countdown-minutes").value = validMinutes;
  $$("[data-minutes]").forEach((button) => button.classList.toggle("selected", Number(button.dataset.minutes) === validMinutes));
  updateCountdown();
}

function countdownStartOrPause() {
  if (countdown.running) {
    countdown.remaining = Math.max(0, countdown.endAt - Date.now());
    countdown.running = false;
    countdown.endAt = null;
  } else {
    if (countdown.remaining <= 0) countdown.remaining = countdown.duration;
    countdown.endAt = Date.now() + countdown.remaining;
    countdown.running = true;
  }
  updateCountdown();
}

function resetCountdown() {
  countdown = { running: false, duration: countdown.duration, remaining: countdown.duration, endAt: null };
  updateCountdown();
}

function focusModeDetails() {
  return focus.mode === "focus"
    ? { label: "专注", duration: 25 * 60_000, hint: "暂时不用做别的", button: "开始专注" }
    : { label: "短休息", duration: 5 * 60_000, hint: "喝口水，看看远处", button: "开始休息" };
}

function updateFocus() {
  const remaining = focus.running ? Math.max(0, focus.endAt - Date.now()) : focus.remaining;
  if (focus.running && remaining <= 0) completeFocusPhase();
  const details = focusModeDetails();
  $("#focus-mode").textContent = details.label;
  $("#focus-mode-chip").textContent = details.label;
  $("#focus-display").textContent = formatTime(focus.running ? Math.max(0, focus.endAt - Date.now()) : focus.remaining, false);
  $("#focus-hint").textContent = focus.running ? details.hint : `准备好开始 ${details.label} 吗？`;
  $("#focus-start").textContent = focus.running ? "暂停" : focus.remaining !== focus.duration ? "继续" : details.button;
  $("#focus-today-count").textContent = focusData.days[todayKey()] || 0;
}

function completeFocusPhase() {
  const wasFocus = focus.mode === "focus";
  if (wasFocus) {
    focusData.total += 1;
    focusData.days[todayKey()] = (focusData.days[todayKey()] || 0) + 1;
    save(STORAGE.focus, focusData);
    notify("完成一个专注回合", "做得好。现在休息 5 分钟吧。");
  } else {
    notify("休息结束", "准备好后，开始下一段专注。");
  }
  focus.mode = wasFocus ? "break" : "focus";
  const details = focusModeDetails();
  focus = { running: false, mode: focus.mode, duration: details.duration, remaining: details.duration, endAt: null };
  updateFocus();
  updateStats();
}

function focusStartOrPause() {
  if (focus.running) {
    focus.remaining = Math.max(0, focus.endAt - Date.now());
    focus.running = false;
    focus.endAt = null;
  } else {
    if (focus.remaining <= 0) focus.remaining = focus.duration;
    focus.endAt = Date.now() + focus.remaining;
    focus.running = true;
  }
  updateFocus();
}

function skipFocus() {
  const wasFocus = focus.mode === "focus";
  focus.mode = wasFocus ? "break" : "focus";
  const details = focusModeDetails();
  focus = { running: false, mode: focus.mode, duration: details.duration, remaining: details.duration, endAt: null };
  updateFocus();
  toast(wasFocus ? "切换为短休息。" : "回到专注状态。");
}

function todaysTasks() {
  return tasks.filter((task) => task.day === todayKey()).sort((a, b) => a.createdAt - b.createdAt);
}

function taskActualMilliseconds(task) {
  return task.actualMs + (task.startedAt ? Date.now() - task.startedAt : 0);
}

function formatTaskTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours) return `${hours}小时${minutes}分`;
  return `${minutes}分${String(remainingSeconds).padStart(2, "0")}秒`;
}

function formatSummaryTime(milliseconds) {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}小时${minutes % 60}分` : `${minutes} 分钟`;
}

function persistTasks() {
  save(STORAGE.tasks, tasks);
}

function pauseTask(task) {
  if (!task?.startedAt) return;
  task.actualMs += Date.now() - task.startedAt;
  task.startedAt = null;
}

function toggleTaskRecording(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  if (task.startedAt) {
    pauseTask(task);
    toast(`已暂停「${task.name}」。`);
  } else {
    tasks.forEach((item) => {
      if (item.id !== id) pauseTask(item);
    });
    task.completed = false;
    task.startedAt = Date.now();
    toast(`正在记录「${task.name}」。`);
  }
  persistTasks();
  renderEvents();
}

function setTaskCompletion(id, completed) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  if (completed) pauseTask(task);
  task.completed = completed;
  persistTasks();
  renderEvents();
  toast(completed ? `「${task.name}」已标记完成。` : `「${task.name}」已恢复为待办事项。`);
}

function renderEvents() {
  const list = $("#event-list");
  const dailyTasks = todaysTasks();
  if (!dailyTasks.length) {
    list.innerHTML = '<div class="event-empty">今天还没有计划。<br />先写下要做的事和预计时长吧。</div>';
  } else {
    list.innerHTML = dailyTasks.map((task) => {
      const actual = taskActualMilliseconds(task);
      const progress = Math.min(100, Math.round(actual / (task.plannedMinutes * 60_000) * 100));
      const status = task.startedAt ? "记录中" : task.completed ? "已完成" : "待开始";
      const statusClass = task.startedAt ? "running" : task.completed ? "completed" : "";
      const recordLabel = task.startedAt ? "暂停" : actual ? "继续" : "开始";
      return `<article class="plan-card ${task.completed ? "completed" : ""}">
        <label class="plan-check" aria-label="${task.completed ? "取消完成" : "标记完成"}：${escapeHtml(task.name)}">
          <input type="checkbox" data-task-toggle="${task.id}" ${task.completed ? "checked" : ""} />
          <span aria-hidden="true">✓</span>
        </label>
        <div class="plan-main">
          <div class="plan-top"><h3>${escapeHtml(task.name)}</h3><span class="plan-status ${statusClass}">${status}</span></div>
          <div class="plan-meta"><span>计划 <b>${task.plannedMinutes} 分钟</b></span><span>实际 <b>${formatTaskTime(actual)}</b></span></div>
          <div class="plan-progress" aria-label="已完成计划的 ${progress}%"><i style="width: ${progress}%"></i></div>
        </div>
        <div class="plan-actions">
          <button class="plan-record" data-task-action="record" data-task-id="${task.id}">${recordLabel}</button>
          <button class="plan-delete" data-task-action="delete" data-task-id="${task.id}">删除</button>
        </div>
      </article>`;
    }).join("");
  }
  updateStats();
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}

function updateStats() {
  const dailyTasks = todaysTasks();
  const planned = dailyTasks.reduce((sum, task) => sum + task.plannedMinutes * 60_000, 0);
  const actual = dailyTasks.reduce((sum, task) => sum + taskActualMilliseconds(task), 0);
  const completed = dailyTasks.filter((task) => task.completed).length;
  $("#planned-total").textContent = formatSummaryTime(planned);
  $("#actual-total").textContent = formatSummaryTime(actual);
  $("#plan-summary").textContent = dailyTasks.length
    ? `今天共 ${dailyTasks.length} 项计划，已完成 ${completed} 项；实际用时会在暂停或完成后保留。`
    : "先添加今天要做的事项，再开始记录实际用时。所有记录仅保存在当前设备。";
  $("#focus-today-count").textContent = focusData.days[todayKey()] || 0;
}

function formatAnalyticsDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  if (hours) return `${hours}小时${minutes}分`;
  if (minutes) return `${minutes} 分钟`;
  return remainingSeconds ? `${remainingSeconds} 秒` : "0 分钟";
}

function addAnalyticsCategory(categories, name, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 1_000) return;
  const label = name || "未命名事项";
  categories.set(label, (categories.get(label) || 0) + durationMs);
}

function collectAnalytics(dateValue) {
  const dateKey = dateKeyFromInput(dateValue);
  const categories = new Map();
  tasks.filter((task) => task.day === dateKey).forEach((task) => {
    addAnalyticsCategory(categories, task.name, taskActualMilliseconds(task));
  });
  timeEntries.filter((entry) => entry.day === dateKey).forEach((entry) => {
    addAnalyticsCategory(categories, entry.name, entry.durationMs);
  });
  const completedFocus = focusData.days[dateKey] || 0;
  if (completedFocus) addAnalyticsCategory(categories, "专注", completedFocus * 25 * 60_000);
  if (dateKey === todayKey() && stopwatch.running) {
    addAnalyticsCategory(categories, currentStopwatchTaskName(), Date.now() - stopwatch.startedAt);
  }
  return [...categories.entries()]
    .map(([name, durationMs]) => ({ name, durationMs }))
    .sort((a, b) => b.durationMs - a.durationMs);
}

function renderAnalytics() {
  const dateInput = $("#analytics-date");
  if (!dateInput.value) dateInput.value = todayInputValue();
  const dateKey = dateKeyFromInput(dateInput.value);
  const entries = collectAnalytics(dateInput.value);
  const total = entries.reduce((sum, entry) => sum + entry.durationMs, 0);
  const isToday = dateKey === todayKey();
  const donut = $("#analytics-donut");
  const legend = $("#analytics-legend");
  $("#analytics-total-label").textContent = isToday ? "今日累计" : "当日累计";
  $("#analytics-total").textContent = formatAnalyticsDuration(total);
  $("#analytics-total-caption").textContent = total ? `${entries.length} 类时间记录` : "暂无记录";
  $("#analytics-kicker").textContent = isToday ? "今天的时间" : "所选日期";
  $("#analytics-category-count").textContent = entries.length;

  if (!total) {
    donut.style.background = "#e9efeb";
    donut.setAttribute("aria-label", "所选日期暂无时间记录");
    $("#analytics-headline").textContent = "还没有计时记录";
    $("#analytics-description").textContent = "开始一项计划或正计时后，时间会自动归入对应事项。";
    $("#analytics-top-category").textContent = "—";
    legend.innerHTML = '<div class="analytics-empty">所选日期还没有可统计的时长。</div>';
    return;
  }

  let start = 0;
  const slices = entries.map((entry, index) => {
    const end = start + entry.durationMs / total * 360;
    const color = ANALYTICS_COLORS[index % ANALYTICS_COLORS.length];
    const slice = `${color} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
    start = end;
    return { ...entry, color, percent: entry.durationMs / total * 100, slice };
  });
  donut.style.background = `conic-gradient(${slices.map((slice) => slice.slice).join(", ")})`;
  donut.setAttribute("aria-label", `所选日期累计 ${formatAnalyticsDuration(total)}，共 ${entries.length} 类事项`);
  $("#analytics-headline").textContent = isToday ? `今天已记录 ${formatAnalyticsDuration(total)}` : `这一天记录了 ${formatAnalyticsDuration(total)}`;
  $("#analytics-description").textContent = `最多的时间花在「${slices[0].name}」，占总记录的 ${Math.round(slices[0].percent)}%。`;
  $("#analytics-top-category").textContent = slices[0].name;
  legend.innerHTML = slices.map((slice) => `<div class="analytics-legend-row">
    <i class="analytics-color" style="background:${slice.color}"></i>
    <div class="analytics-legend-main">
      <div class="analytics-legend-label"><b>${escapeHtml(slice.name)}</b><span>${slice.percent.toFixed(0)}%</span></div>
      <div class="analytics-legend-bar"><i style="width:${slice.percent}%;background:${slice.color}"></i></div>
    </div>
    <span class="analytics-legend-time">${formatAnalyticsDuration(slice.durationMs)}</span>
  </div>`).join("");
}

function addEvent(event) {
  event.preventDefault();
  const name = $("#event-name").value.trim();
  const plannedMinutes = Math.min(720, Math.max(1, Number($("#event-minutes").value) || 30));
  if (!name) return;
  tasks.push({ id: String(Date.now()), name, plannedMinutes, actualMs: 0, startedAt: null, completed: false, day: todayKey(), createdAt: Date.now() });
  persistTasks();
  $("#event-form").reset();
  $("#event-minutes").value = 30;
  $("#event-form").hidden = true;
  renderEvents();
  toast("已加入今天的计划。");
}

function switchView(viewName) {
  $$(".mode-tab").forEach((tab) => {
    const active = tab.dataset.view === viewName;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-pressed", String(active));
  });
  $$(".panel").forEach((panel) => {
    const active = panel.id === viewName;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function startTicker() {
  clearInterval(tickHandle);
  tickHandle = setInterval(() => {
    updateStopwatch();
    updateCountdown();
    updateFocus();
    renderEvents();
    renderAnalytics();
  }, 500);
}

function bindEvents() {
  $$(".mode-tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
  $("#stopwatch-start").addEventListener("click", stopwatchStartOrPause);
  $("#stopwatch-name").addEventListener("input", updateStopwatch);
  $("#stopwatch-reset").addEventListener("click", resetStopwatch);
  $("#stopwatch-lap").addEventListener("click", addLap);
  $$(".quick-action").forEach((button) => button.addEventListener("click", () => {
    if (stopwatch.running) {
      addTimeEntry(currentStopwatchTaskName(), Date.now() - stopwatch.startedAt);
    }
    stopwatch = { running: true, accumulated: 0, startedAt: Date.now(), laps: [] };
    $("#stopwatch-name").value = button.dataset.quickName;
    renderLaps();
    updateStopwatch();
    toast(`已开始「${button.dataset.quickName}」计时。`);
  }));
  $("#countdown-start").addEventListener("click", countdownStartOrPause);
  $("#countdown-reset").addEventListener("click", resetCountdown);
  $("#countdown-name").addEventListener("input", updateCountdown);
  $("#countdown-minutes").addEventListener("change", (event) => setCountdownMinutes(event.target.value));
  $$(".preset-row button").forEach((button) => button.addEventListener("click", () => setCountdownMinutes(button.dataset.minutes)));
  $("#focus-start").addEventListener("click", focusStartOrPause);
  $("#focus-skip").addEventListener("click", skipFocus);
  $("#show-event-form").addEventListener("click", () => {
    $("#event-form").hidden = false;
    $("#event-name").focus();
  });
  $("#cancel-event").addEventListener("click", () => $("#event-form").hidden = true);
  $("#event-form").addEventListener("submit", addEvent);
  $("#event-list").addEventListener("change", (event) => {
    const id = event.target.dataset.taskToggle;
    if (id) setTaskCompletion(id, event.target.checked);
  });
  $("#event-list").addEventListener("click", (event) => {
    const id = event.target.dataset.taskId;
    const action = event.target.dataset.taskAction;
    if (!id || !action) return;
    if (action === "record") toggleTaskRecording(id);
    if (action === "delete") {
      const task = tasks.find((item) => item.id === id);
      if (!task || !confirm(`删除「${task.name}」及其实际用时记录吗？`)) return;
      tasks = tasks.filter((item) => item.id !== id);
      persistTasks();
      renderEvents();
      toast("已删除事项。");
    }
  });
  $("#show-all-stats").addEventListener("click", () => $("#stats-sheet").hidden = false);
  $("#close-stats").addEventListener("click", () => $("#stats-sheet").hidden = true);
  $("#analytics-date").addEventListener("change", renderAnalytics);
  $("#clear-data").addEventListener("click", () => {
    if (!confirm("确定清除本机保存的计划和专注记录吗？此操作无法恢复。")) return;
    tasks = [];
    focusData = { total: 0, days: {} };
    timeEntries = [];
    localStorage.removeItem(STORAGE.tasks);
    localStorage.removeItem("light-time-events-v1");
    localStorage.removeItem(STORAGE.focus);
    localStorage.removeItem(STORAGE.timeEntries);
    renderEvents();
    updateStats();
    renderAnalytics();
    toast("本机记录已清除。");
  });
  $("#notification-button").addEventListener("click", async () => {
    if (!("Notification" in window)) return toast("当前浏览器不支持通知提醒。");
    const permission = await Notification.requestPermission();
    toast(permission === "granted" ? "提醒已开启。" : "未开启提醒，你仍可在页面内使用计时。");
  });
  $("#install-button").addEventListener("click", showInstall);
  $("#close-install-guide").addEventListener("click", dismissInstallGuide);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") dismissInstallGuide();
  });
}

async function showInstall() {
  if (deferredInstall) {
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (ios) {
    $("#install-guide").hidden = false;
  } else {
    toast("请在浏览器菜单中选择“安装应用”或“添加到主屏幕”。");
  }
}

function dismissInstallGuide() {
  $("#install-guide").hidden = true;
  toast("已关闭安装提示。");
}

function initInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event;
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    toast("轻时刻已安装到设备。");
  });
}

function init() {
  updateTodayLabel();
  bindEvents();
  initInstallPrompt();
  renderLaps();
  renderEvents();
  updateStopwatch();
  updateCountdown();
  updateFocus();
  updateStats();
  $("#analytics-date").value = todayInputValue();
  renderAnalytics();
  startTicker();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}

init();

