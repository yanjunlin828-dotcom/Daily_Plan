(function exposeDailyPlanApi(global) {
  const configuredPort = Number(new URLSearchParams(global.location.search).get('apiPort'));
  const localPort = Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535
    ? configuredPort
    : 8000;
  const baseUrl = global.location.protocol === 'file:' ? `http://127.0.0.1:${localPort}/api` : '/api';

  async function request(method, path, body) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.detail?.message || payload.detail || `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  global.DailyPlanApi = Object.freeze({
    getData: () => request('GET', '/data'),
    getTimer: () => request('GET', '/timer'),
    saveTasks: (dateKey, items, expectedRevision) => request('PUT', `/tasks/${dateKey}`, { items, expectedRevision }),
    saveGoals: (items, expectedRevision) => request('PUT', '/goals', { items, expectedRevision }),
    startTimer: (target = null) => request('POST', '/timer/start', target ? { target } : {}),
    pauseTimer: (sessionId) => request('POST', '/timer/pause', { sessionId }),
    resumeTimer: (sessionId) => request('POST', '/timer/resume', { sessionId }),
    finishTimer: (sessionId) => request('POST', '/timer/finish', { sessionId }),
    discardTimer: (sessionId) => request('POST', '/timer/discard', { sessionId }),
  });
})(window);
