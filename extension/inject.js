// Runs in the page's own JavaScript world on Google Meet / Microsoft Teams (web).
// It wraps getUserMedia so that the site receives a camera track whose frames have
// gone through Rectangular Filter. The processing itself happens in the extension's
// panel (an iframe created by bridge.js); frames travel as ImageBitmaps.
//
// Safety net: whenever the panel is missing, switched off or slow, the original
// camera frames are passed through untouched, so a call never loses its video.
(() => {
  if (window.__rectFilterInjected) return;
  window.__rectFilterInjected = true;

  const MD = window.MediaDevices && window.MediaDevices.prototype;
  if (!MD || typeof MD.getUserMedia !== 'function') return;
  const originalGetUserMedia = MD.getUserMedia;

  let panel = null;        // the panel's window
  let panelOrigin = null;
  let busy = false;        // a frame is being processed by the panel
  let busySince = 0;
  let nextId = 1;
  const pipes = new Map();

  const enabled = () => document.documentElement.dataset.rectfilter !== 'off';

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.source !== 'rectfilter-panel') return;
    if (typeof e.origin !== 'string' || !e.origin.startsWith('chrome-extension://')) return;
    if (d.type === 'ready') {
      panel = e.source;
      panelOrigin = e.origin;
      busy = false;
    } else if (d.type === 'result') {
      busy = false;
      const pipe = pipes.get(d.id);
      if (pipe && d.bitmap) pipe.emitProcessed(d.bitmap);
      else if (d.bitmap && d.bitmap.close) d.bitmap.close();
    }
  });

  function createPipe(realTrack) {
    const id = nextId++;
    let lastProcessed = 0;
    let stopped = false;
    let outTrack;
    let write; // (VideoFrame | ImageBitmap) -> void, takes ownership

    if (typeof MediaStreamTrackGenerator === 'function' && typeof VideoFrame === 'function') {
      const gen = new MediaStreamTrackGenerator({ kind: 'video' });
      const writer = gen.writable.getWriter();
      write = (src) => {
        let frame = src;
        if (!(src instanceof VideoFrame)) {
          frame = new VideoFrame(src, { timestamp: Math.round(performance.now() * 1000) });
          src.close();
        }
        writer.write(frame).catch(() => frame.close());
      };
      outTrack = gen;
    } else {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      write = (src) => {
        const w = src.displayWidth || src.width;
        const h = src.displayHeight || src.height;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        ctx.drawImage(src, 0, 0, w, h);
        src.close();
      };
      const s = realTrack.getSettings();
      canvas.width = s.width || 1280;
      canvas.height = s.height || 720;
      outTrack = canvas.captureStream(30).getVideoTracks()[0];
    }

    const pipe = {
      emitProcessed(bitmap) {
        if (stopped) { bitmap.close(); return; }
        lastProcessed = performance.now();
        write(bitmap);
      },
    };
    pipes.set(id, pipe);

    function onFrame(frame) {
      const now = performance.now();
      const active = panel && enabled();
      if (active && busy && now - busySince > 1500) busy = false; // the panel went quiet
      if (active && !busy) {
        busy = true;
        busySince = now;
        createImageBitmap(frame)
          .then((bitmap) => {
            frame.close();
            panel.postMessage({ source: 'rectfilter-page', type: 'frame', id, bitmap }, panelOrigin, [bitmap]);
          })
          .catch(() => { busy = false; frame.close(); });
      } else if (!active || now - lastProcessed > 400) {
        write(frame); // pass the camera through untouched
      } else {
        frame.close(); // a filtered frame is on its way
      }
    }

    function cleanup() {
      if (stopped) return;
      stopped = true;
      pipes.delete(id);
      try { realTrack.stop(); } catch { /* ignore */ }
    }

    if (typeof MediaStreamTrackProcessor === 'function') {
      const reader = new MediaStreamTrackProcessor({ track: realTrack }).readable.getReader();
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done || stopped) { if (value) value.close(); break; }
            onFrame(value);
          }
        } catch { /* track ended */ }
        cleanup();
        try { outTrack.stop(); } catch { /* ignore */ }
      })();
    } else {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.srcObject = new MediaStream([realTrack]);
      v.play().catch(() => {});
      const step = () => {
        if (stopped) return;
        if (v.readyState >= 2 && v.videoWidth) {
          createImageBitmap(v).then(onFrame).catch(() => {});
        }
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step);
        else setTimeout(step, 33);
      };
      step();
      realTrack.addEventListener('ended', () => { cleanup(); try { outTrack.stop(); } catch { /* ignore */ } });
    }

    // Make the replacement look like the real camera to the site.
    const stop = outTrack.stop.bind(outTrack);
    outTrack.stop = () => { cleanup(); stop(); };
    outTrack.getSettings = () => realTrack.getSettings();
    outTrack.getCapabilities = () => (realTrack.getCapabilities ? realTrack.getCapabilities() : {});
    outTrack.getConstraints = () => realTrack.getConstraints();
    outTrack.applyConstraints = (c) => realTrack.applyConstraints(c);
    try { Object.defineProperty(outTrack, 'label', { get: () => realTrack.label }); } catch { /* ignore */ }
    return outTrack;
  }

  function isCameraRequest(constraints) {
    const v = constraints && constraints.video;
    if (!v) return false;
    if (typeof v === 'object') {
      // Legacy screen/tab capture through getUserMedia.
      const m = v.mandatory || {};
      if (v.mediaSource || v.chromeMediaSource || m.chromeMediaSource) return false;
    }
    return true;
  }

  MD.getUserMedia = async function getUserMedia(constraints) {
    const stream = await originalGetUserMedia.call(this, constraints);
    try {
      if (!isCameraRequest(constraints)) return stream;
      const realTrack = stream.getVideoTracks()[0];
      if (!realTrack) return stream;
      document.dispatchEvent(new Event('rectfilter:camera')); // ask bridge.js for the panel
      const outTrack = createPipe(realTrack);
      return new MediaStream([outTrack, ...stream.getAudioTracks()]);
    } catch (err) {
      console.warn('[Rectangular Filter] uso la webcam senza filtro:', err);
      return stream;
    }
  };
})();
