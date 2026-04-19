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
  const recordingHud = document.getElementById("recordingHud");
  const recordingHudLabel = document.getElementById("recordingHudLabel");

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
  const sidebarPanels = document.getElementById("sidebarPanels");

  let stream = null;
  let rafId = 0;
  
  let isRecordingMov = false;
  let recordingCtx = null;
  let recordCanvas = null;
  let recordingPhase = "idle";
  let recordingCountdownTimer = 0;
  let recordingDurationTimer = 0;
  let copySuccessActive = false;

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

  function getCharsetButtons() {
    return qsa("[data-charset]");
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

  function setCopyFeedback(active) {
    copySuccessActive = active;
    qsa("#btnExportTxt").forEach((el) => {
      el.classList.toggle("export-button--copied", active);
    });
  }

  function clearCopyFeedback() {
    if (!copySuccessActive) return;
    setCopyFeedback(false);
  }

  function clearTransientFeedback() {
    clearCopyFeedback();
  }

  function updateRecordingHud(phase, label = "") {
    recordingPhase = phase;
    if (!recordingHud || !recordingHudLabel) return;
    recordingHud.hidden = phase === "idle";
    recordingHud.classList.toggle("recording-hud--countdown", phase === "countdown");
    recordingHud.classList.toggle("recording-hud--recording", phase === "recording");
    recordingHudLabel.textContent = label;
  }

  function clearRecordingTimers() {
    if (recordingCountdownTimer) {
      clearInterval(recordingCountdownTimer);
      recordingCountdownTimer = 0;
    }
    if (recordingDurationTimer) {
      clearInterval(recordingDurationTimer);
      recordingDurationTimer = 0;
    }
  }

  function setPressedState(id, isPressed) {
    qsa(`#${id}`).forEach((el) => {
      el.setAttribute("aria-pressed", String(isPressed));
    });
  }

  function setButtonDisabled(id, disabled) {
    qsa(`#${id}`).forEach((el) => {
      el.disabled = disabled;
    });
  }

  function setButtonText(id, text) {
    qsa(`#${id}`).forEach((el) => {
      const textTarget =
        el.querySelector(".export-button__text") ||
        el.querySelector("span:not(.export-button__group):not(.export-button__dot)") ||
        el;
      textTarget.textContent = text;
    });
  }

  function updatePlaybackButtons(mode) {
    setPressedState("btnStop", mode === "stop");
    setPressedState("btnPlay", mode === "play");
    setPressedState("btnPause", mode === "pause");
    const transportLocked = isRecordingMov || recordingPhase === "countdown";
    setButtonDisabled("btnStop", transportLocked);
    setButtonDisabled("btnPlay", transportLocked);
    setButtonDisabled("btnPause", transportLocked);
  }

  function updateExportButtons() {
    const hasAscii = Boolean((asciiEl.textContent || asciiEl.innerText || "").trim());
    const recordingLocked = isRecordingMov || recordingPhase === "countdown";
    setButtonDisabled("btnExportTxt", !hasAscii || recordingLocked);
    setButtonDisabled("btnExportJpg", !hasAscii || recordingLocked);
    setButtonDisabled("btnExportMov", !running || recordingLocked || !hasAscii);
  }

  function updateCharsetButtons(value) {
    const hasCustomCharset = Boolean((state.customCharset || "").trim());
    getCharsetButtons().forEach((button) => {
      const isActive = !hasCustomCharset && button.dataset.charset === value;
      button.classList.toggle("charset-button--active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  function updateManualInputState() {
    const isActive = Boolean((state.customCharset || "").trim());
    qsa("#customCharset").forEach((el) => {
      el.classList.toggle("control-input--active", isActive);
    });
  }

  function updateSliderFill(id) {
    qsa(`#${id}`).forEach((el) => {
      const min = Number(el.min || 0);
      const max = Number(el.max || 100);
      const value = Number(el.value || min);
      const ratio = max === min ? 0 : ((value - min) / (max - min)) * 100;
      el.style.setProperty("--slider-fill", `${ratio}%`);
    });
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
    qsa("#densityPct").forEach((el) => {
      el.textContent = (scale / 100).toFixed(2);
    });
    qsa("#contrastValue").forEach((el) => {
      el.textContent = `${Number(state.contrast).toFixed(1)}X`;
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
    updateSliderFill("cols");
    updateSliderFill("fontWeight");
    updateSliderFill("contrast");
    updateCharsetButtons(state.charset);
    updateManualInputState();
    updateExportButtons();
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
    updateExportButtons();

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
      
      fabCamera.classList.add("fab-camera--on");
      updatePlaybackButtons("play");
      setStatus("LIVE_//_ASCII_STREAM");
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
      updateExportButtons();
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
    
    fabCamera.classList.remove("fab-camera--on");
    updatePlaybackButtons("stop");
    setStatus("STANDBY");
    updateExportButtons();
  }

  function toggleCamera() {
    if (isRecordingMov || recordingPhase === "countdown") {
      setStatus("REC_IN_PROGRESS");
      return;
    }
    clearTransientFeedback();
    if (running) stopCamera();
    else startCamera();
  }

  function exportAsciiTxt() {
    clearTransientFeedback();
    const text = asciiEl.textContent || asciiEl.innerText || "";
    if (!text.trim()) {
      setStatus("COPY_FAILED");
      return;
    }
    const fallbackCopy = () => {
      const temp = document.createElement("textarea");
      temp.value = text;
      temp.setAttribute("readonly", "");
      temp.style.position = "fixed";
      temp.style.opacity = "0";
      document.body.appendChild(temp);
      temp.select();
      document.execCommand("copy");
      document.body.removeChild(temp);
    };

    const onSuccess = () => {
      setCopyFeedback(true);
      setStatus("COPY_COMPLETE");
    };
    const onFailure = () => setStatus("COPY_FAILED");

    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(onSuccess)
        .catch(() => {
          try {
            fallbackCopy();
            onSuccess();
          } catch (error) {
            console.error(error);
            onFailure();
          }
        });
      return;
    }

    try {
      fallbackCopy();
      onSuccess();
    } catch (error) {
      console.error(error);
      onFailure();
    }
  }

  function exportAsciiJpg() {
    clearTransientFeedback();
    const text = asciiEl.textContent || asciiEl.innerText || "";
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const rows = lines.length;
    const cols = Math.max(1, ...lines.map((l) => l.length));
    if (rows <= 1 || cols <= 1 || !text.trim()) {
      setStatus("JPG_EXPORT_FAILED");
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
        setStatus("JPG_EXPORT_COMPLETE");
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
    clearTransientFeedback();
    if (running) stopCamera();
  });
  
  btnPlay.addEventListener("click", () => {
    clearTransientFeedback();
    if (!running) {
      startCamera();
    } else {
      state.realtime = true;
      updatePlaybackButtons("play");
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
      updateExportButtons();
    }
  });

  btnPause.addEventListener("click", () => {
    clearTransientFeedback();
    if (running) {
      state.realtime = false;
      if (video.readyState >= 2) {
        snapshotCanvas.width = video.videoWidth;
        snapshotCanvas.height = video.videoHeight;
        snapshotCtx.drawImage(video, 0, 0);
      }
      updatePlaybackButtons("pause");
      updateExportButtons();
    }
  });

  fabCamera.addEventListener("click", () => {
    clearTransientFeedback();
    toggleCamera();
  });
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
      if (isRecordingMov || recordingPhase === "countdown") return;
      if (!running) {
        alert("カメラ起動中でないと実行できません");
        return;
      }
      clearTransientFeedback();

      const btn = qsa("#btnExportMov")[0];
      setButtonDisabled("btnExportMov", true);
      setButtonText("btnExportMov", "3...");
      qsa("#btnExportMov").forEach((el) => {
        el.style.color = "#ff3366";
        el.style.borderColor = "#ff3366";
      });
      updateRecordingHud("countdown", "REC_IN_3");
      updatePlaybackButtons(state.realtime ? "play" : "pause");
      setStatus("REC_PREPARING");

      if (drawerBackdrop.classList.contains("drawer-backdrop--open")) closeDrawer();

      let countdown = 3;
      clearRecordingTimers();
      recordingCountdownTimer = setInterval(() => {
        countdown--;
        if (countdown > 0) {
          setButtonText("btnExportMov", `${countdown}...`);
          updateRecordingHud("countdown", `REC_IN_${countdown}`);
        } else {
          clearInterval(recordingCountdownTimer);
          recordingCountdownTimer = 0;
          startMovieRecording(btn);
        }
      }, 1000);
    });
  });

  function startMovieRecording(btn) {
    setButtonText("btnExportMov", "REC_(5S)...");

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
    let mimeString = "video/mp4;codecs=h264";
    let ext = "mp4";
    if (!MediaRecorder.isTypeSupported(mimeString)) {
      mimeString = "video/mp4";
    }
    if (!MediaRecorder.isTypeSupported(mimeString)) {
      setButtonDisabled("btnExportMov", false);
      setButtonText("btnExportMov", "REC.MOV_(5S)");
      qsa("#btnExportMov").forEach((el) => {
        el.style.color = "";
        el.style.borderColor = "";
      });
      updateRecordingHud("idle");
      updatePlaybackButtons(state.realtime ? "play" : "pause");
      setStatus("MP4_RECORDING_NOT_SUPPORTED");
      updateExportButtons();
      return;
    }
    
    const options = MediaRecorder.isTypeSupported(mimeString) ? { mimeType: mimeString } : undefined;
    const movieRecorder = new MediaRecorder(stream, options);
    const recordChunks = [];

    movieRecorder.onerror = (event) => {
      console.error(event.error || event);
      isRecordingMov = false;
      qsa("#btnExportMov").forEach((el) => {
        el.style.color = "";
        el.style.borderColor = "";
      });
      setButtonText("btnExportMov", "REC.MOV_(5S)");
      clearRecordingTimers();
      updateRecordingHud("idle");
      updatePlaybackButtons(state.realtime ? "play" : "pause");
      updateExportButtons();
      setStatus("REC_FAILED");
    };

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
      
      setButtonDisabled("btnExportMov", false);
      setButtonText("btnExportMov", "REC.MOV_(5S)");
      qsa("#btnExportMov").forEach((el) => {
        el.style.color = "";
        el.style.borderColor = "";
      });
      isRecordingMov = false;
      recordCanvas = null;
      recordingCtx = null;
      clearRecordingTimers();
      updateRecordingHud("idle");
      updatePlaybackButtons(state.realtime ? "play" : "pause");
      setStatus("REC_COMPLETE");
      updateExportButtons();
    };

    movieRecorder.start();
    isRecordingMov = true;
    updateRecordingHud("recording", "REC_5S");
    updatePlaybackButtons(state.realtime ? "play" : "pause");
    setStatus("REC_RECORDING");

    let secondsLeft = 5;
    recordingDurationTimer = setInterval(() => {
      secondsLeft--;
      if (secondsLeft > 0) {
         setButtonText("btnExportMov", `REC_(${secondsLeft}S)...`);
         updateRecordingHud("recording", `REC_${secondsLeft}S`);
      } else {
         clearInterval(recordingDurationTimer);
         recordingDurationTimer = 0;
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
    clearTransientFeedback();
    toggleCamera();
  });

  navSettings.addEventListener("click", () => {
    clearTransientFeedback();
    openDrawer();
  });

  navHistory.addEventListener("click", () => {
    clearTransientFeedback();
    setStatus("LOG_//_準備中");
  });

  navProfile.addEventListener("click", () => {
    clearTransientFeedback();
    setStatus("USER_//_準備中");
  });

  bindSyncedValue("cols", (v) => {
    clearTransientFeedback();
    state.scale = Number(v);
    updateControlLabels();
    scheduleFrame();
  });
  if (fontWeightInput) {
    bindSyncedValue("fontWeight", (v) => {
      clearTransientFeedback();
      state.fontWeight = Number(v);
      updateControlLabels();
    });
  }
  bindSyncedValue("contrast", (v) => {
    clearTransientFeedback();
    state.contrast = Number(v);
    updateControlLabels();
    scheduleFrame();
  });
  bindSyncedValue("charset", (v) => {
    clearTransientFeedback();
    state.charset = v;
    updateCharsetButtons(v);
    scheduleFrame();
  });
  bindSyncedValue("customCharset", (v) => {
    clearTransientFeedback();
    state.customCharset = v;
    updateCharsetButtons(state.charset);
    updateManualInputState();
    scheduleFrame();
  });
  bindSyncedChecked("mirror", (v) => {
    clearTransientFeedback();
    state.mirror = v;
    scheduleFrame();
  });
  bindSyncedChecked("invert", (v) => {
    clearTransientFeedback();
    state.invert = v;
    scheduleFrame();
  });
  bindSyncedChecked("color", (v) => {
    clearTransientFeedback();
    state.color = v;
    scheduleFrame();
  });

  getCharsetButtons().forEach((button) => {
    button.addEventListener("click", () => {
      clearTransientFeedback();
      const value = button.dataset.charset;
      qsa("#charset").forEach((el) => {
        el.value = value;
      });
      state.charset = value;
      updateCharsetButtons(value);
      scheduleFrame();
    });
  });


  updateControlLabels();
  updatePlaybackButtons("stop");
  updateExportButtons();

  window.addEventListener("beforeunload", () => {
    stopCamera();
  });
})();
