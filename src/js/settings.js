import { state, ACCENT_PRESETS, FIT_CYCLE } from './state.js';
import { $, $$, safeInvoke, showToast } from './util.js';

export function applyAppearance(settings) {
  const theme = ['dark', 'light'].includes(settings.theme) ? settings.theme : 'dark';
  const direction = ['ltr', 'rtl'].includes(settings.readingDirection) ? settings.readingDirection : 'ltr';
  const accent = /^#[0-9a-fA-F]{6}$/.test(settings.accentColor || '') ? settings.accentColor : '#e0555a';
  document.body.dataset.theme = theme;
  document.body.dataset.readingDirection = direction;
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-soft', accent + '22');
  document.body.style.setProperty('--accent', accent);
  document.body.style.setProperty('--accent-soft', accent + '22');
  const cardWidthMap = { small: '120px', medium: '160px', large: '210px' };
  const cardHeightMap = { small: '255px', medium: '320px', large: '395px' };
  const cardSize = settings.cardSize || 'medium';
  document.documentElement.style.setProperty('--card-width', cardWidthMap[cardSize] || cardWidthMap.medium);
  document.documentElement.style.setProperty('--card-placeholder-height', cardHeightMap[cardSize] || cardHeightMap.medium);
  document.body.classList.toggle('no-anim', settings.animationsEnabled === false);
  state.fitMode = FIT_CYCLE.includes(settings.defaultFit) ? settings.defaultFit : 'contain';
  updateSettingsUI(settings);
}

// Reflects the current in-memory settings onto every settings control
// (segmented buttons, toggles, slider, swatches) — called on boot and after
// any change so the UI never drifts from stored state.
export function updateSettingsUI(settings) {
  $$('.segmented[data-setting]').forEach((group) => {
    const key = group.dataset.setting;
    $$('.seg-btn', group).forEach((btn) => btn.classList.toggle('active', btn.dataset.value === settings[key]));
  });

  const animToggle = $('#animations-toggle');
  if (animToggle) animToggle.checked = settings.animationsEnabled !== false;

  const autoHideToggle = $('#toolbar-autohide-toggle');
  if (autoHideToggle) autoHideToggle.checked = settings.toolbarAutoHide !== false;

  const delayRow = $('#toolbar-delay-row');
  if (delayRow) delayRow.style.opacity = settings.toolbarAutoHide === false ? '0.4' : '1';
  const delaySlider = $('#toolbar-delay');
  if (delaySlider) {
    delaySlider.value = settings.toolbarHideDelay || 2500;
    delaySlider.disabled = settings.toolbarAutoHide === false;
  }
  const delayLabel = $('#toolbar-delay-label');
  if (delayLabel) delayLabel.textContent = `${((settings.toolbarHideDelay || 2500) / 1000).toFixed(1)}s`;

  renderAccentSwatches(settings.accentColor);
  const customInput = $('#accent-custom');
  if (customInput) customInput.value = settings.accentColor || '#e0555a';
}

function renderAccentSwatches(activeColor) {
  const wrap = $('#accent-swatches');
  if (!wrap) return;
  wrap.innerHTML = '';
  ACCENT_PRESETS.forEach((color) => {
    const btn = document.createElement('button');
    btn.className = 'swatch' + (color.toLowerCase() === (activeColor || '').toLowerCase() ? ' active' : '');
    btn.style.background = color;
    btn.title = color;
    btn.addEventListener('click', () => updateSetting('accentColor', color));
    wrap.appendChild(btn);
  });
}

// Single write-path for every customizable preference: persists via IPC,
// updates in-memory state, and re-applies appearance so the change is
// visible immediately without a restart. Queued so rapid-fire changes (e.g.
// dragging the delay slider) can't race and land out of order.
async function updateSetting(key, value) {
  updateSetting.queue = updateSetting.queue || Promise.resolve();
  const previous = state.settings[key];
  updateSetting.queue = updateSetting.queue.catch(() => {}).then(async () => {
    const ok = await safeInvoke(window.api.setSetting(key, value), false, "Couldn't save that setting.");
    if (!ok) {
      state.settings[key] = previous;
      updateSettingsUI(state.settings);
      return false;
    }
    state.settings[key] = value;
    applyAppearance(state.settings);
    return true;
  });
  await updateSetting.queue.catch(() => {});
}

let pinSetupMode = 'set';
function openPinSetup(mode) {
  pinSetupMode = mode;
  $('#pin-setup-title').textContent = mode === 'set' ? 'Set a PIN' : 'Enter current PIN to disable lock';
  $('#pin-setup-input').placeholder = mode === 'set' ? 'Enter 4-digit PIN' : 'Current PIN';
  $('#pin-setup-input').maxLength = mode === 'set' ? 4 : 6;
  $('#pin-setup-input').pattern = mode === 'set' ? '[0-9]{4}' : '[0-9]{4,6}';
  $('#pin-setup-modal').classList.remove('hidden');
  $('#pin-setup-input').value = '';
  $('#pin-setup-input').focus();
}
function closePinSetup() {
  $('#pin-setup-modal').classList.add('hidden');
}

export function bindSettingsEvents() {
  // Every segmented control (theme, cover size, reading direction, fit mode)
  // shares one handler: read data-setting off the group, data-value off the button.
  $$('.segmented[data-setting]').forEach((group) => {
    const key = group.dataset.setting;
    $$('.seg-btn', group).forEach((btn) => btn.addEventListener('click', () => updateSetting(key, btn.dataset.value)));
  });

  $('#accent-custom').addEventListener('change', (e) => updateSetting('accentColor', e.target.value));
  $('#animations-toggle').addEventListener('change', (e) => updateSetting('animationsEnabled', e.target.checked));
  $('#toolbar-autohide-toggle').addEventListener('change', (e) => updateSetting('toolbarAutoHide', e.target.checked));
  $('#toolbar-delay').addEventListener('input', (e) => {
    $('#toolbar-delay-label').textContent = `${(Number(e.target.value) / 1000).toFixed(1)}s`;
  });
  $('#toolbar-delay').addEventListener('change', (e) => updateSetting('toolbarHideDelay', Number(e.target.value)));

  $('#reset-settings').addEventListener('click', async () => {
    if (!confirm('Reset appearance and reading settings to defaults?')) return;
    const defaults = await safeInvoke(window.api.resetSettings(), state.settings, "Couldn't reset settings.");
    state.settings = { ...state.settings, ...defaults };
    applyAppearance(state.settings);
    showToast('Settings reset to defaults.');
  });

  $('#github-link').addEventListener('click', () => window.api.openExternal('https://github.com/izumicancode'));

  $('#pin-toggle').addEventListener('change', (e) => {
    if (e.target.checked) {
      openPinSetup('set');
    } else {
      // Revert immediately; the modal will re-check it on success.
      e.target.checked = true;
      openPinSetup('disable');
    }
  });

  $('#pin-setup-cancel').addEventListener('click', () => {
    closePinSetup();
    if (pinSetupMode === 'set') $('#pin-toggle').checked = false;
  });

  $('#pin-setup-input').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, pinSetupMode === 'set' ? 4 : 6);
  });

  $('#pin-setup-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#pin-setup-confirm').click();
  });

  $('#pin-setup-confirm').addEventListener('click', async () => {
    const val = $('#pin-setup-input').value.trim();
    if (pinSetupMode === 'set' && !/^\d{4}$/.test(val)) {
      showToast('PIN must be exactly 4 digits.');
      return;
    }

    if (pinSetupMode === 'set') {
      const ok = await safeInvoke(window.api.pinSet(val), false, "Couldn't set PIN. Try again.");
      if (ok) {
        closePinSetup();
        showToast('PIN lock enabled.');
      } else {
        $('#pin-toggle').checked = false;
      }
    } else {
      const ok = await safeInvoke(window.api.pinDisable(val), false, "Couldn't verify PIN. Try again.");
      if (ok) {
        $('#pin-toggle').checked = false;
        closePinSetup();
        showToast('PIN lock disabled.');
      } else {
        showToast('Incorrect PIN.');
        $('#pin-setup-input').value = '';
        $('#pin-setup-input').focus();
      }
    }
  });
}
