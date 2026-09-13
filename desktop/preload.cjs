const { contextBridge, ipcRenderer } = require('electron');

const send = (channel, payload) => ipcRenderer.send(channel, payload);

contextBridge.exposeInMainWorld('dailyPlanDesktop', {
  beginOrbDrag: () => send('orb:drag-start'),
  endOrbDrag: () => send('orb:drag-end'),
  setOrbHitTest: (interactive) => send('orb:hit-test', Boolean(interactive)),
  togglePanel: () => send('panel:toggle'),
  closePanel: () => send('panel:close'),
  setPanelPinned: (pinned) => send('panel:set-pinned', Boolean(pinned)),
  openMainWindow: () => send('main-window:open'),
  quitApp: () => send('app:quit'),
  onPanelState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('panel:state', listener);
    return () => ipcRenderer.removeListener('panel:state', listener);
  },
  onOrbState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('orb:state', listener);
    return () => ipcRenderer.removeListener('orb:state', listener);
  },
});
