import { state, DEFAULTS_FALLBACK, bus } from './state.js';
import { $, $$, safeInvoke, showToast } from './util.js';
import { applyAppearance, bindSettingsEvents } from './settings.js';
import { refreshLibrary, refreshHistory, bindLibraryEvents } from './library.js';
import { bindReaderEvents } from './reader.js';

// Surface unexpected errors instead of letting the UI silently freeze.
window.addEventListener('error', (e) => console.error('[renderer] error:', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[renderer] unhandled rejection:', e.reason));

// Closing the reader hands control back to app.js rather than the reader
// module importing the library module directly (see state.js for why).
bus.addEventListener('reader-closed', () => {
  refreshLibrary();
  refreshHistory();
});

async function boot() {
  try {
    const settings = await safeInvoke(window.api.getSettings(), {}, '');
    state.settings = { ...DEFAULTS_FALLBACK, ...settings };
    applyAppearance(state.settings);

    const pinStatus = await safeInvoke(window.api.pinStatus(), { enabled: false }, '');
    if (pinStatus.enabled) {
      showLockScreen();
    } else {
      await enterApp(state.settings);
    }
  } catch (err) {
    console.error('[renderer] boot failed:', err);
    document.body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#f2f2f2;background:#0d1117;font-family:sans-serif;text-align:center;padding:20px;">' +
      'Something went wrong starting the app. Please restart it.</div>';
  }
}

async function enterApp(settings) {
  $('#lock-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');

  state.settings = { ...DEFAULTS_FALLBACK, ...settings };
  applyAppearance(state.settings);

  $('#library-folder-path').textContent = settings.libraryFolder || 'Not set';
  $('#pin-toggle').checked = !!settings.pinEnabled;

  await refreshLibrary();
  await refreshHistory();
  bindEvents();
  window.api.onLibraryChanged(() => {
    showToast('Library changes detected. Refreshing…');
    refreshLibrary();
  });
}

// ---------- Lock screen ----------

let pinBuffer = '';
function showLockScreen() {
  $('#lock-screen').classList.remove('hidden');
  $('#app').classList.add('hidden');
  renderPinDots();
  $$('.pin-key').forEach((btn) => { btn.onclick = () => handlePinKey(btn.dataset.key); });
}

function renderPinDots() {
  const dots = $('#pin-dots');
  dots.innerHTML = '';
  const len = Math.max(pinBuffer.length, 4);
  for (let i = 0; i < len; i++) {
    const d = document.createElement('span');
    if (i < pinBuffer.length) d.classList.add('filled');
    dots.appendChild(d);
  }
}

async function handlePinKey(key) {
  if (key === 'clear') { pinBuffer = ''; renderPinDots(); return; }
  if (key === 'back') { pinBuffer = pinBuffer.slice(0, -1); renderPinDots(); return; }
  if (pinBuffer.length >= 6) return;
  pinBuffer += key;
  renderPinDots();
  if (pinBuffer.length >= 4) {
    const ok = await window.api.pinVerify(pinBuffer);
    if (ok) {
      pinBuffer = '';
      const settings = await window.api.getSettings();
      await enterApp(settings);
    } else if (pinBuffer.length === 6) {
      $('#pin-error').classList.remove('hidden');
      $('.lock-card').classList.add('shake');
      setTimeout(() => $('.lock-card').classList.remove('shake'), 320);
      pinBuffer = '';
      renderPinDots();
    }
  }
}

// ---------- Tabs ----------

function switchTab(tab) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $(`#view-${tab}`).classList.remove('hidden');
  if (tab === 'history') refreshHistory();
}

// ---------- Event binding ----------

function bindEvents() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  bindLibraryEvents();
  bindSettingsEvents();
  bindReaderEvents();
}

boot();
