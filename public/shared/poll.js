// Lightweight poller used by every display page.
// Calls `render` only when the JSON response changes.

function pollEvery(intervalMs, url, render) {
  let lastJson = '';
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      const json = JSON.stringify(data);
      if (json !== lastJson) {
        lastJson = json;
        render(data);
      }
    } catch (e) {
      console.error('poll error', url, e);
    }
  }

  tick();
  const timer = setInterval(tick, intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.pollEvery = pollEvery;
window.esc = esc;
