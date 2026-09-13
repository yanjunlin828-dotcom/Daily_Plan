const path = require('node:path');
const fs = require('node:fs');
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray,
} = require('electron');

const ROOT_DIR = path.resolve(__dirname, '..');
const FLOATING_DIR = path.join(ROOT_DIR, 'floating');
const ORB_SIZE = 72;
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 570;
const PANEL_GAP = 8;
const SCREEN_MARGIN = 10;

let orbWindow = null;
let panelWindow = null;
let mainWindow = null;
let tray = null;
let isQuitting = false;
let panelPinned = false;
let dragTimer = null;
let dragOffset = null;
let dragStartPoint = null;
let dragHasMoved = false;
let panelOpen = false;
let closeTimer = null;
let dockSide = null;
let collapsed = false;
let awaySince = Date.now();
let hoverSince = 0;
let hitTimer = null;
let ignoringMouse = false;

function orbState() {
  orbWindow?.webContents.send('orb:state', { side: dockSide, collapsed });
}

function settleOrb(save = true) {
  if (!orbWindow) return;
  const b = orbWindow.getBounds(), area = screen.getDisplayMatching(b).workArea;
  dockSide = b.x <= area.x + 20 ? 'left' : b.x + ORB_SIZE >= area.x + area.width - 20 ? 'right' : null;
  const x = dockSide === 'left' ? area.x : dockSide === 'right' ? area.x + area.width - ORB_SIZE : Math.max(area.x, Math.min(b.x, area.x + area.width - ORB_SIZE));
  const y = Math.max(area.y, Math.min(b.y, area.y + area.height - ORB_SIZE));
  orbWindow.setPosition(x, y, false);
  collapsed = false; awaySince = Date.now(); orbState();
  if (save) {
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'orb-position.json'), JSON.stringify({ x, y })); } catch (error) { console.warn('Orb position could not be saved:', error.message); }
  }
}

function trackOrbPointer() {
  if (!orbWindow || !orbWindow.isVisible()) return;
  const p = screen.getCursorScreenPoint(), b = orbWindow.getBounds();
  const x = p.x - b.x, y = p.y - b.y;
  const over = collapsed ? y >= 8 && y <= 64 && (dockSide === 'left' ? x >= 0 && x <= 24 : x >= 48 && x <= 72) : Math.hypot(x - 36, y - 36) <= 33;
  if (dragTimer || panelOpen) { collapsed = false; awaySince = Date.now(); hoverSince = 0; }
  else if (over) {
    awaySince = Date.now();
    if (!hoverSince) hoverSince = Date.now();
    if (Date.now() - hoverSince >= 180) collapsed = false;
  } else {
    hoverSince = 0;
    if (dockSide && Date.now() - awaySince >= 1200) collapsed = true;
  }
  // Main-process cursor tracking always restores hit testing, even when the renderer
  // no longer receives pointer events through a transparent part of the window.
  const ignore = !dragTimer && !over;
  if (ignore !== ignoringMouse) { ignoringMouse = ignore; orbWindow.setIgnoreMouseEvents(ignore, { forward: true }); }
  const state = `${dockSide}:${collapsed}`;
  if (trackOrbPointer.lastState !== state) { trackOrbPointer.lastState = state; orbState(); }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function createSafeWindow(options, preload = true) {
  const window = new BrowserWindow({
    ...options,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
      ...(preload ? { preload: path.join(__dirname, 'preload.cjs') } : {}),
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://127.0.0.1:8000/')) {
      event.preventDefault();
    }
  });
  return window;
}

function initialOrbPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'orb-position.json'), 'utf8'));
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y) && screen.getAllDisplays().some(d => saved.x >= d.workArea.x && saved.x < d.workArea.x + d.workArea.width && saved.y >= d.workArea.y && saved.y < d.workArea.y + d.workArea.height)) return saved;
  } catch {}
  return {
    x: workArea.x + workArea.width - ORB_SIZE - 18,
    y: Math.round(workArea.y + (workArea.height - ORB_SIZE) * 0.36),
  };
}

function createOrbWindow() {
  const position = initialOrbPosition();
  orbWindow = createSafeWindow({
    width: ORB_SIZE,
    height: ORB_SIZE,
    x: position.x,
    y: position.y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Daily Plan Orb',
  });
  orbWindow.setAlwaysOnTop(true, 'floating');
  orbWindow.loadFile(path.join(FLOATING_DIR, 'orb.html'));
  orbWindow.once('ready-to-show', () => { settleOrb(false); orbWindow?.showInactive(); });
  orbWindow.on('closed', () => {
    stopOrbDrag();
    orbWindow = null;
  });
}

function createPanelWindow() {
  panelWindow = createSafeWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    show: false,
    frame: false,
    transparent: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#0b0e0c',
    title: 'Daily Plan Quick Panel',
  });
  panelWindow.setAlwaysOnTop(true, 'floating');
  panelWindow.loadFile(path.join(FLOATING_DIR, 'panel.html'));
  panelWindow.on('blur', () => {
    setTimeout(() => {
      if (panelPinned || !panelOpen || panelWindow?.isFocused() || dragTimer) return;
      const p = screen.getCursorScreenPoint(), b = orbWindow?.getBounds();
      if (b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) return;
      hidePanel();
    }, 100);
  });
  panelWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hidePanel();
    }
  });
  panelWindow.on('closed', () => {
    panelWindow = null;
  });
}

function panelBoundsForOrb() {
  const orbBounds = orbWindow.getBounds();
  const display = screen.getDisplayMatching(orbBounds);
  const area = display.workArea;
  const spaceRight = area.x + area.width - (orbBounds.x + orbBounds.width);
  const openRight = spaceRight >= PANEL_WIDTH + PANEL_GAP;
  const idealX = openRight
    ? orbBounds.x + orbBounds.width + PANEL_GAP
    : orbBounds.x - PANEL_WIDTH - PANEL_GAP;
  const idealY = Math.round(orbBounds.y + orbBounds.height / 2 - PANEL_HEIGHT / 2);
  return {
    x: Math.max(area.x + SCREEN_MARGIN, Math.min(idealX, area.x + area.width - PANEL_WIDTH - SCREEN_MARGIN)),
    y: Math.max(area.y + SCREEN_MARGIN, Math.min(idealY, area.y + area.height - PANEL_HEIGHT - SCREEN_MARGIN)),
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
  };
}

function showPanel() {
  if (!orbWindow || !panelWindow) return;
  clearTimeout(closeTimer);
  panelOpen = true; collapsed = false; orbState();
  panelWindow.setBounds(panelBoundsForOrb(), false);
  panelWindow.show();
  panelWindow.webContents.send('panel:state', { open: true });
  panelWindow.focus();
}

function hidePanel() {
  if (!panelOpen) return;
  panelOpen = false;
  panelWindow?.webContents.send('panel:state', { open: false });
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { if (!panelOpen) panelWindow?.hide(); }, 170);
}

function togglePanel() {
  if (!panelWindow) return;
  if (panelOpen) hidePanel();
  else showPanel();
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reloadIgnoringCache();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = createSafeWindow({
    width: 1120,
    height: 780,
    minWidth: 760,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f0f0f',
    title: 'Daily Plan',
  }, false);
  mainWindow.loadURL(`http://127.0.0.1:8000/?desktop=${Date.now()}`);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.once('did-fail-load', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(ROOT_DIR, 'favicon.ico');
  let icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16, quality: 'best' });
  tray = new Tray(icon);
  tray.setToolTip('Daily Plan');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示悬浮球', click: () => orbWindow?.showInactive() },
    { label: '隐藏悬浮球', click: () => { hidePanel(); orbWindow?.hide(); } },
    { type: 'separator' },
    { label: '打开完整界面', click: createMainWindow },
    { type: 'separator' },
    { label: '退出 Daily Plan', click: quitApplication },
  ]));
  tray.on('click', () => {
    if (!orbWindow) return;
    if (orbWindow.isVisible()) {
      hidePanel();
      orbWindow.hide();
    } else {
      orbWindow.showInactive();
    }
  });
}

function startOrbDrag() {
  if (!orbWindow || dragTimer) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = orbWindow.getBounds();
  dragOffset = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
  dragStartPoint = cursor;
  dragHasMoved = false;
  const startedAt = Date.now();
  dragTimer = setInterval(() => {
    if (!orbWindow || Date.now() - startedAt > 15000) {
      stopOrbDrag();
      return;
    }
    const point = screen.getCursorScreenPoint();
    if (!dragHasMoved) {
      const distance = Math.hypot(point.x - dragStartPoint.x, point.y - dragStartPoint.y);
      if (distance < 6) return;
      dragHasMoved = true;
      hidePanel();
    }
    orbWindow.setPosition(Math.round(point.x - dragOffset.x), Math.round(point.y - dragOffset.y), false);
  }, 16);
}

function stopOrbDrag() {
  const moved = dragHasMoved;
  if (dragTimer) clearInterval(dragTimer);
  dragTimer = null;
  dragOffset = null;
  dragStartPoint = null;
  dragHasMoved = false;
  if (moved) settleOrb();
}

function quitApplication() {
  isQuitting = true;
  stopOrbDrag();
  app.quit();
}

function isTrustedSender(event, expectedWindow) {
  return Boolean(expectedWindow && !expectedWindow.isDestroyed() && event.sender === expectedWindow.webContents);
}

function registerIpc() {
  ipcMain.on('orb:drag-start', (event) => {
    if (isTrustedSender(event, orbWindow)) startOrbDrag();
  });
  ipcMain.on('orb:drag-end', (event) => {
    if (isTrustedSender(event, orbWindow)) stopOrbDrag();
  });
  ipcMain.on('orb:hit-test', (event, interactive) => {
    if (!isTrustedSender(event, orbWindow) || typeof interactive !== 'boolean') return;
    orbWindow.setIgnoreMouseEvents(!interactive, { forward: true });
  });
  ipcMain.on('panel:toggle', (event) => {
    if (isTrustedSender(event, orbWindow)) togglePanel();
  });
  ipcMain.on('panel:close', (event) => {
    if (isTrustedSender(event, panelWindow)) hidePanel();
  });
  ipcMain.on('panel:set-pinned', (event, pinned) => {
    if (!isTrustedSender(event, panelWindow) || typeof pinned !== 'boolean') return;
    panelPinned = pinned;
  });
  ipcMain.on('main-window:open', (event) => {
    if (isTrustedSender(event, panelWindow)) createMainWindow();
  });
  ipcMain.on('app:quit', (event) => {
    if (isTrustedSender(event, panelWindow)) quitApplication();
  });
}

app.on('second-instance', () => {
  orbWindow?.showInactive();
});

app.whenReady().then(() => {
  registerIpc();
  createOrbWindow();
  createPanelWindow();
  createTray();
  hitTimer = setInterval(trackOrbPointer, 60);
  screen.on('display-removed', () => { if (orbWindow) { const p = initialOrbPosition(); orbWindow.setPosition(p.x, p.y); settleOrb(false); } });
  screen.on('display-metrics-changed', () => { settleOrb(false); if (panelOpen) panelWindow?.setBounds(panelBoundsForOrb()); });
});

// Tray owns the application lifetime; closing all content windows should not quit it.
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  clearInterval(hitTimer);
  clearTimeout(closeTimer);
  isQuitting = true;
  stopOrbDrag();
});
