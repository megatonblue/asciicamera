(() => {
  "use strict";

  const CHARSETS = {
    detailed:
      " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    simple: " .:-=+*#%@",
    blocks: " ░▒▓█",
    minimal: " ·oO0@",
  };

  const SCALE_MIN = 40;
  const SCALE_MAX = 140;
  const BASE_COLS = 96;
  const CHAR_ASPECT = 1.9;

  const video = document.getElementById("video");
  const canvas = document.getElementById("capture");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const snapshotCanvas = document.createElement("canvas");
  const snapshotCtx = snapshotCanvas.getContext("2d", { willReadFrequently: true });
  const asciiEl = document.getElementById("ascii");
  const statusEl = document.getElementById("status");

  const colsInput = document.getElementById("cols");
  const colsValue = document.getElementById("colsValue");
  const fontWeightInput = document.getElementById("fontWeight");
  const fontWeightValue = document.getElementById("fontWeightValue");
  const densityPct = document.getElementById("densityPct");
  const contrastInput = document.getElementById("contrast");
  const contrastValue = document.getElementById("contrastValue");
  const mirrorInput = document.getElementById("mirror");
  const invertInput = document.getElementById("invert");
  const colorInput = document.getElementById("color");
  const charsetSelect = document.getElementById("charset");
  const customCharsetInput = document.getElementById("customCharset");

  const btnStop = document.getElementById("btnStop");
  const btnPlay = document.getElementById("btnPlay");
  const btnPause = document.getElementById("btnPause");
  const fabCamera = document.getElementById("fabCamera");
  const btnCloseDrawer = document.getElementById("btnCloseDrawer");
  const drawerBackdrop = document.getElementById("drawerBackdrop");
  const drawerContent = document.getElementById("drawerContent");
  const navCamera = document.getElementById("navCamera");
  const navSettings = document.getElementById("navSettings");
  const navHistory = document.getElementById("navHistory");
  const navProfile = document.getElementById("navProfile");
  const sidebarTabs = document.getElementById("sidebarTabs");
  const sidebarPanels = document.getElementById("sidebarPanels");

  let stream = null;
  let rafId = 0;
  
  let isRecordingMov = false;
  let recordingCtx = null;
  let recordCanvas = null;

  let running = false;
  let state = {
    scale: Number(colsInput.value) || 80,
    fontWeight: Number(fontWeightInput?.value) || 400,
    contrast: Number(contrastInput.value) || 1.2,
    mirror: mirrorInput.checked,
    invert: invertInput.checked,
    color: colorInput.checked,
    charset: charsetSelect.value,
    customCharset: customCharsetInput.value,
    realtime: true,
  };

  function qsa(selector) {
    return Array.from(document.querySelectorAll(selector));
  }

  function bindSyncedValue(id, onChange) {
    const elements = () => qsa(`#${id}`);
    const sync = (source) => {
      elements().forEach((el) => {
        if (el !== source) el.value = source.value;
      });
    };
    const handler = (event) => {
      sync(event.target);
      onChange(event.target.value);
    };
    elements().forEach((el) => {
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });
  }

  function bindSyncedChecked(id, onChange) {
    const elements = () => qsa(`#${id}`);
    const sync = (source) => {
      elements().forEach((el) => {
        if (el !== source) el.checked = source.checked;
      });
    };
    const handler = (event) => {
      sync(event.target);
      onChange(event.target.checked);
    };
    elements().forEach((el) => {
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function luminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function mapBrightness(t, chars) {
    const idx = Math.min(
      chars.length - 1,
      Math.max(0, Math.floor(t * chars.length))
    );
    return chars[idx];
  }

  function getChars() {
    const custom = (state.customCharset || "").trim();
    if (custom.length >= 2) return custom;
    return CHARSETS[state.charset] || CHARSETS.detailed;
  }

  function escapeHtml(ch) {
    const div = document.createElement("div");
    div.textContent = ch;
    return div.innerHTML;
  }

  function updateControlLabels() {
    const scale = Number(state.scale);
    const pct = Math.round(
      ((scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100
    );
    qsa("#densityPct").forEach((el) => {
      el.textContent = `${pct}%`;
    });
    qsa("#contrastValue").forEach((el) => {
      el.textContent = `[${Number(state.contrast).toFixed(2)}]`;
    });
    if (fontWeightInput) {
      qsa("#fontWeightValue").forEach((el) => {
        el.textContent = state.fontWeight;
      });
      document.documentElement.style.setProperty('--font-weight', state.fontWeight);
      asciiEl.style.fontWeight = state.fontWeight;
    }
    const fontPx = Math.max(6, Math.min(16, (Number(state.scale) / 80) * 9));
    document.documentElement.style.setProperty('--cols', Number(state.scale));
    // asciiEl.style.fontSize = `${fontPx.toFixed(2)}px`;
  }

  function renderAsciiFrame() {
    if (!running || video.readyState < 2) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0) return;

    const cols = Number(state.scale);
    const contrast = Number(state.contrast);
    const mirror = Boolean(state.mirror);
    const invert = Boolean(state.invert);
    const useColor = Boolean(state.color);
    const chars = getChars();

    const side = Math.min(vw, vh);
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;

    const cellW = side / cols;
    const cellH = cellW * CHAR_ASPECT;
    const rows = Math.max(1, Math.floor(side / cellH));

    canvas.width = cols;
    canvas.height = rows;

    ctx.save();
    if (mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    const source = state.realtime ? video : snapshotCanvas;
    ctx.drawImage(source, sx, sy, side, side, 0, 0, cols, rows);
    ctx.restore();

    const img = ctx.getImageData(0, 0, cols, rows);
    const d = img.data;

    let out = "";
    let html = "";

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];

        let lum = luminance(r, g, b) / 255;
        lum = (lum - 0.5) * contrast + 0.5;
        lum = Math.min(1, Math.max(0, lum));
        if (invert) lum = 1 - lum;

        const ch = mapBrightness(lum, chars);

        if (useColor) {
          html += `<span style="color:rgb(${r},${g},${b})">${escapeHtml(ch)}</span>`;
        } else {
          out += ch;
        }
      }
      if (useColor) html += "\n";
      else out += "\n";
    }

    if (useColor) asciiEl.innerHTML = html;
    else asciiEl.textContent = out;

    if (isRecordingMov && recordingCtx && recordCanvas) {
      const fsize = Math.round((14 * 80) / cols);
      const lineH = fsize * 1.2;
      const pad = Math.max(20, fsize);
      
      const text = asciiEl.textContent || asciiEl.innerText || "";
      const lines = text.replace(/\r\n/g, "\n").split("\n");

      recordingCtx.fillStyle = "#0116ff";
      recordingCtx.fillRect(0, 0, recordCanvas.width, recordCanvas.height);
      recordingCtx.fillStyle = "#ffffff";
      recordingCtx.font = `${state.fontWeight} ${fsize}px "JetBrains Mono", monospace`;
      recordingCtx.textBaseline = "top";
      for (let y = 0; y < lines.length; y++) {
        recordingCtx.fillText(lines[y] || "", pad, pad + y * lineH);
      }
    }
  }

  function loop() {
    if (!running) return;
    renderAsciiFrame();
    if (!state.realtime) return;
    rafId = requestAnimationFrame(loop);
  }

  function scheduleFrame() {
    if (!running) return;
    if (state.realtime) {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    } else {
      renderAsciiFrame();
    }
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("このブラウザでは getUserMedia が使えません。");
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          aspectRatio: { ideal: 1 },
          width: { ideal: 1080 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      running = true;
      state.realtime = true;
      
      btnPlay.classList.add("btn-playback--active");
      btnPause.classList.remove("btn-playback--active");
      fabCamera.classList.add("fab-camera--on");
      setStatus("LIVE // ASCII stream");
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    } catch (e) {
      console.error(e);
      setStatus(
        "カメラを開けませんでした: " +
          (e && e.message ? e.message : String(e))
      );
    }
  }

  function stopCamera() {
    running = false;
    cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    video.srcObject = null;
    asciiEl.textContent = "";
    asciiEl.innerHTML = "";
    
    btnPlay.classList.remove("btn-playback--active");
    btnPause.classList.remove("btn-playback--active");
    fabCamera.classList.remove("fab-camera--on");
    setStatus("STANDBY");
  }

  function toggleCamera() {
    if (running) stopCamera();
    else startCamera();
  }

  function exportAsciiTxt() {
    const text = asciiEl.textContent || asciiEl.innerText || "";
    if (!text.trim()) {
      setStatus("EXPORT: データがありません");
      return;
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `digital-alchemist-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("EXPORT complete");
  }

  function exportAsciiJpg() {
    const text = asciiEl.textContent || asciiEl.innerText || "";
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const rows = lines.length;
    const cols = Math.max(1, ...lines.map((l) => l.length));
    if (rows <= 1 || cols <= 1 || !text.trim()) {
      setStatus("EXPORT: データがありません");
      return;
    }

    // Render ASCII to an offscreen canvas
    const out = document.createElement("canvas");
    const octx = out.getContext("2d");
    const fontSize = 14;
    const lineH = Math.round(fontSize * 1.05);
    octx.font = `${state.fontWeight} ${fontSize}px "JetBrains Mono", Menlo, Consolas, monospace`;
    octx.textBaseline = "top";

    const charW = Math.ceil(octx.measureText("M").width);
    const pad = 16;
    let w = cols * charW + pad * 2;
    let h = rows * lineH + pad * 2;

    // clamp to avoid huge exports
    const MAX = 4096;
    const scale = Math.min(1, MAX / Math.max(w, h));
    w = Math.max(1, Math.floor(w * scale));
    h = Math.max(1, Math.floor(h * scale));
    out.width = w;
    out.height = h;

    octx.setTransform(scale, 0, 0, scale, 0, 0);
    octx.fillStyle = "#0116ff";
    octx.fillRect(0, 0, w / scale, h / scale);
    octx.fillStyle = "#f2f5ff";

    for (let y = 0; y < rows; y++) {
      octx.fillText(lines[y] || "", pad, pad + y * lineH);
    }

    out.toBlob(
      (blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `digital-alchemist-${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(a.href);
        setStatus("EXPORT complete");
      },
      "image/jpeg",
      0.92
    );
  }

  function openDrawer() {
    drawerBackdrop.classList.add("drawer-backdrop--open");
    drawerBackdrop.setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    drawerBackdrop.classList.remove("drawer-backdrop--open");
    drawerBackdrop.setAttribute("aria-hidden", "true");
  }

  if (drawerContent) {
    const clone = document.createElement("div");
    clone.className = "drawer-sidebar";
    clone.appendChild(sidebarPanels.cloneNode(true));
    drawerContent.replaceChildren(clone);
  }
  btnStop.addEventListener("click", () => {
    if (running) stopCamera();
  });
  
  btnPlay.addEventListener("click", () => {
    if (!running) {
      startCamera();
    } else {
      state.realtime = true;
      btnPlay.classList.add("btn-playback--active");
      btnPause.classList.remove("btn-playback--active");
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    }
  });

  btnPause.addEventListener("click", () => {
    if (running) {
      state.realtime = false;
      if (video.readyState >= 2) {
        snapshotCanvas.width = video.videoWidth;
        snapshotCanvas.height = video.videoHeight;
        snapshotCtx.drawImage(video, 0, 0);
      }
      btnPause.classList.add("btn-playback--active");
      btnPlay.classList.remove("btn-playback--active");
    }
  });

  fabCamera.addEventListener("click", toggleCamera);
  qsa("#btnExportTxt").forEach((b) =>
    b.addEventListener("click", () => {
      if (!running) {
        alert("カメラ起動中でないと実行できません");
        return;
      }
      exportAsciiTxt();
      if (drawerBackdrop.classList.contains("drawer-backdrop--open")) closeDrawer();
    })
  );
  qsa("#btnExportJpg").forEach((b) =>
    b.addEventListener("click", () => {
      if (!running) {
        alert("カメラ起動中でないと実行できません");
        return;
      }
      exportAsciiJpg();
      if (drawerBackdrop.classList.contains("drawer-backdrop--open")) closeDrawer();
    })
  );

  qsa("#btnExportMov").forEach((b) => {
    b.addEventListener("click", async () => {
      if (isRecordingMov) return;
      if (!running) {
        alert("カメラ起動中でないと実行できません");
        return;
      }

      const btn = qsa("#btnExportMov")[0];
      if (btn) {
        btn.disabled = true;
        btn.textContent = "3...";
        btn.style.color = "#ff3366";
        btn.style.borderColor = "#ff3366";
      }

      if (drawerBackdrop.classList.contains("drawer-backdrop--open")) closeDrawer();

      let countdown = 3;
      const countTimer = setInterval(() => {
        countdown--;
        if (countdown > 0) {
          if (btn) btn.textContent = `${countdown}...`;
        } else {
          clearInterval(countTimer);
          startMovieRecording(btn);
        }
      }, 1000);
    });
  });

  function startMovieRecording(btn) {
    if (btn) btn.textContent = "REC (5S)...";

    const text = asciiEl.textContent || asciiEl.innerText || "";
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const cols = (lines[0] || "").length || 80;
    const fsize = Math.round((14 * 80) / cols);
    const lineH = fsize * 1.2;
    const pad = Math.max(20, fsize);

    recordCanvas = document.createElement("canvas");
    recordingCtx = recordCanvas.getContext("2d", { willReadFrequently: true });
    recordingCtx.font = `${state.fontWeight} ${fsize}px "JetBrains Mono", monospace`;
    
    let maxW = 0;
    for (let i = 0; i < lines.length; i++) {
        const w = recordingCtx.measureText(lines[i]).width;
        if (w > maxW) maxW = w;
    }
    recordCanvas.width = maxW + pad * 2;
    recordCanvas.height = lines.length * lineH + pad * 2;

    recordingCtx.fillStyle = "#0116ff";
    recordingCtx.fillRect(0, 0, recordCanvas.width, recordCanvas.height);

    const stream = recordCanvas.captureStream(30);
    let mimeString = 'video/webm';
    let ext = 'webm';
    if (!MediaRecorder.isTypeSupported(mimeString)) {
        mimeString = 'video/mp4';
        ext = 'mp4';
    }
    
    const options = MediaRecorder.isTypeSupported(mimeString) ? { mimeType: mimeString } : undefined;
    const movieRecorder = new MediaRecorder(stream, options);
    const recordChunks = [];

    movieRecorder.ondataavailable = e => {
      if (e.data.size > 0) recordChunks.push(e.data);
    };

    movieRecorder.onstop = () => {
      const blob = new Blob(recordChunks, { type: mimeString });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `matrix_export_${Date.now()}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      
      if (btn) {
        btn.disabled = false;
        btn.textContent = "MOV EXPORT (5S)";
        btn.style.color = "";
        btn.style.borderColor = "";
      }
      isRecordingMov = false;
      recordCanvas = null;
      recordingCtx = null;
    };

    movieRecorder.start();
    isRecordingMov = true;

    let secondsLeft = 5;
    const timer = setInterval(() => {
      secondsLeft--;
      if (secondsLeft > 0) {
         if (btn) btn.textContent = `REC (${secondsLeft}S)...`;
      } else {
         clearInterval(timer);
         if (movieRecorder.state !== "inactive") {
           movieRecorder.stop();
         }
      }
    }, 1000);
  }

  btnCloseDrawer.addEventListener("click", closeDrawer);
  drawerBackdrop.addEventListener("click", (e) => {
    if (e.target === drawerBackdrop) closeDrawer();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });

  navCamera.addEventListener("click", () => {
    toggleCamera();
  });

  navSettings.addEventListener("click", () => {
    openDrawer();
  });

  navHistory.addEventListener("click", () => {
    setStatus("LOG // 履歴は準備中です");
  });

  navProfile.addEventListener("click", () => {
    setStatus("USER // プロフィールは準備中です");
  });

  bindSyncedValue("cols", (v) => {
    state.scale = Number(v);
    updateControlLabels();
    scheduleFrame();
  });
  if (fontWeightInput) {
    bindSyncedValue("fontWeight", (v) => {
      state.fontWeight = Number(v);
      updateControlLabels();
    });
  }
  bindSyncedValue("contrast", (v) => {
    state.contrast = Number(v);
    updateControlLabels();
    scheduleFrame();
  });
  bindSyncedValue("charset", (v) => {
    state.charset = v;
    scheduleFrame();
  });
  bindSyncedValue("customCharset", (v) => {
    state.customCharset = v;
    scheduleFrame();
  });
  bindSyncedChecked("mirror", (v) => {
    state.mirror = v;
    scheduleFrame();
  });
  bindSyncedChecked("invert", (v) => {
    state.invert = v;
    scheduleFrame();
  });
  bindSyncedChecked("color", (v) => {
    state.color = v;
    scheduleFrame();
  });


  updateControlLabels();

  window.addEventListener("beforeunload", () => {
    stopCamera();
  });
})();
