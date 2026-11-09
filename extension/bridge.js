// Content script (isolated world). Creates the floating Rectangular Filter panel when
// the page first opens the camera, and mirrors the on/off switch to the page script
// through a data attribute on <html>.
(() => {
  const root = document.documentElement;
  let enabled = true;
  let host = null;
  let toggleBtn = null;

  function applyEnabled() {
    root.dataset.rectfilter = enabled ? 'on' : 'off';
    if (toggleBtn) {
      toggleBtn.textContent = enabled ? 'Filtro: ON' : 'Filtro: OFF';
      toggleBtn.style.background = enabled ? '#39ff6a' : 'rgba(255,255,255,.15)';
      toggleBtn.style.color = enabled ? '#04130a' : '#fff';
    }
  }

  chrome.storage.local.get({ enabled: true }, (v) => { enabled = v.enabled !== false; applyEnabled(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.enabled) { enabled = changes.enabled.newValue !== false; applyEnabled(); }
  });
  applyEnabled();

  const SIZES = { small: [360, 300], large: [760, 560] };

  function style(el, props) { Object.assign(el.style, props); return el; }

  function button(label, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    return style(b, {
      all: 'initial', cursor: 'pointer', font: '600 12px system-ui, sans-serif', color: '#fff',
      background: 'rgba(255,255,255,.15)', borderRadius: '8px', padding: '5px 9px', lineHeight: '1',
    });
  }

  function createPanel() {
    if (host || !document.body) return;
    let size = 'small';
    let minimized = false;

    host = style(document.createElement('div'), {
      all: 'initial', position: 'fixed', right: '16px', bottom: '16px', zIndex: '2147483647',
      borderRadius: '14px', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,.5)',
      background: '#0b0b10', border: '1px solid rgba(255,255,255,.18)', display: 'block',
    });
    const shadow = host.attachShadow({ mode: 'closed' });

    const bar = style(document.createElement('div'), {
      display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px', cursor: 'move',
      font: '600 12px system-ui, sans-serif', color: '#fff', userSelect: 'none', background: '#16161d',
    });
    const title = style(document.createElement('span'), { flex: '1', whiteSpace: 'nowrap' });
    title.textContent = 'Rectangular Filter';
    toggleBtn = button('', 'Attiva o disattiva il filtro nella videochiamata');
    const sizeBtn = button('⤢', 'Ingrandisci o riduci il pannello');
    const minBtn = button('—', 'Riduci a icona');
    bar.append(title, toggleBtn, sizeBtn, minBtn);

    const frame = document.createElement('iframe');
    frame.src = chrome.runtime.getURL('index.html?embed=1');
    frame.title = 'Rectangular Filter';
    style(frame, { border: '0', display: 'block', background: '#000', colorScheme: 'dark' });

    function layout() {
      const [w, h] = SIZES[size];
      // Keep the iframe alive (1px) when minimised: it still has to process frames.
      style(frame, minimized
        ? { width: '1px', height: '1px', opacity: '0' }
        : { width: `min(${w}px, calc(100vw - 32px))`, height: `min(${h}px, calc(100vh - 80px))`, opacity: '1' });
      title.textContent = minimized ? 'RF' : 'Rectangular Filter';
      sizeBtn.style.display = minimized ? 'none' : '';
      minBtn.textContent = minimized ? '▢' : '—';
      minBtn.title = minimized ? 'Riapri il pannello' : 'Riduci a icona';
    }

    toggleBtn.addEventListener('click', () => chrome.storage.local.set({ enabled: !enabled }));
    sizeBtn.addEventListener('click', () => { size = size === 'small' ? 'large' : 'small'; layout(); });
    minBtn.addEventListener('click', () => { minimized = !minimized; layout(); });

    // Drag by the title bar.
    let drag = null;
    bar.addEventListener('pointerdown', (e) => {
      if (e.target !== bar && e.target !== title) return;
      const r = host.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const r = host.getBoundingClientRect();
      const x = Math.max(0, Math.min(window.innerWidth - r.width, e.clientX - drag.dx));
      const y = Math.max(0, Math.min(window.innerHeight - r.height, e.clientY - drag.dy));
      style(host, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
    });
    const endDrag = () => { drag = null; };
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);

    shadow.append(bar, frame);
    layout();
    applyEnabled();
    document.body.appendChild(host);
  }

  document.addEventListener('rectfilter:camera', () => {
    if (document.body) createPanel();
    else document.addEventListener('DOMContentLoaded', createPanel, { once: true });
  });
})();
