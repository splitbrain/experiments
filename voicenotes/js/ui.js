// Small shared UI helpers.

import { icon } from './icons.js';

let toastTimer = null;

export function showToast(message, ms = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/**
 * Show a persistent, tappable "update available" prompt. Stays until tapped.
 * @param {() => void} onAccept invoked when the user taps to update
 */
export function showUpdatePrompt(onAccept) {
  if (document.getElementById('update-prompt')) return; // already showing
  const el = document.createElement('button');
  el.id = 'update-prompt';
  el.className = 'update-prompt';
  el.append(icon('refresh'), 'New version available — tap to update');
  el.addEventListener('click', () => { el.remove(); onAccept(); });
  document.body.appendChild(el);
}
