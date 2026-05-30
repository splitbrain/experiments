// Minimal hash router. Routes are registered as path patterns with a single
// optional ":param" segment, e.g. "/" and "/note/:id".

const routes = [];
let notFound = null;

/** Register a route. @param {string} pattern @param {(params:object)=>void} handler */
export function route(pattern, handler) {
  const parts = pattern.split('/').filter(Boolean);
  routes.push({ parts, handler });
}

export function setNotFound(handler) {
  notFound = handler;
}

function match(path) {
  const segs = path.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.parts.length; i++) {
      const p = r.parts[i];
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i]);
      else if (p !== segs[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

function resolve() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const m = match(hash);
  if (m) m.handler(m.params);
  else if (notFound) notFound();
}

export function navigate(path) {
  location.hash = path;
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  resolve();
}
