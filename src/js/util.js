export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function showToast(message) {
  let toast = $('#toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 3200);
}

export function updateLibraryStatus(message, tone = 'neutral') {
  const el = $('#library-status');
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
}

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Wraps an IPC call so a failure shows a toast instead of hanging the UI.
export async function safeInvoke(promise, fallback, errorMessage) {
  try {
    return await promise;
  } catch (err) {
    console.error(errorMessage || '[ipc error]', err);
    if (errorMessage) showToast(errorMessage);
    return fallback;
  }
}

export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
