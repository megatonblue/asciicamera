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
  const drawerBackdrop = document.getElementById("drawerBackdrop");
  const drawerContent = document.getElementById("drawerContent");
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
    useCustomCharset: false,  // Manual Input が有効かどうか
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

  function setRecButtonStyle(color, borderColor) {
    qsa("#btnExportMov").forEach((el) => {
      el.style.color = color;
      el.style.borderColor = borderColor;
    });
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

  // IDのエイリアスマップ: デスクトップID → モバイルID
  // ※ HTMLでデスクトップとモバイルが同一IDを共有するため、
  //   qsa("#id") が両方を自動的に返す。MOBILE_ID_MAP は不要になった。

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
    getCharsetButtons().forEach((button) => {
      const isActive = !state.useCustomCharset && button.dataset.charset === value;
      button.classList.toggle("charset-button--active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  function updateManualInputState() {
    qsa("#customCharset").forEach((el) => {
      el.classList.toggle("control-input--active", state.useCustomCharset);
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
    // customCharset が有効かつ activeCharset が "custom" の場合のみ使用
    if (custom.length >= 2 && state.useCustomCharset) return custom;
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
      // CHAR_ASPECT に合わせた行高さ（表示と同じアスペクト比）
      const charW = recordingCtx.measureText ? (() => {
        recordingCtx.font = `${state.fontWeight} ${fsize}px "JetBrains Mono", monospace`;
        return recordingCtx.measureText("M").width;
      })() : fsize * 0.6;
      const lineH = charW * CHAR_ASPECT;
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
    // 末尾の空行を除去
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    const rows = lines.length;
    const cols = Math.max(1, ...lines.map((l) => l.length));
    if (rows <= 1 || cols <= 1 || !text.trim()) {
      setStatus("JPG_EXPORT_FAILED");
      return;
    }

    const out = document.createElement("canvas");
    const octx = out.getContext("2d");

    // フォントを先に設定してから文字幅を計測
    const fontSize = 10;
    const fontStr = `${state.fontWeight} ${fontSize}px "JetBrains Mono", Menlo, Consolas, monospace`;
    octx.font = fontStr;
    octx.textBaseline = "top";

    // モノスペースフォントの正確な文字幅を取得
    const charW = octx.measureText("M").width;
    // 行高さ: CHAR_ASPECT(1.9) に合わせて文字幅 × 1.9
    // これにより表示と同じアスペクト比になる
    const lineH = charW * CHAR_ASPECT;
    const pad = 16;

    let w = Math.ceil(cols * charW) + pad * 2;
    let h = Math.ceil(rows * lineH) + pad * 2;

    // 4096px を上限にスケール
    const MAX = 4096;
    const scale = Math.min(1, MAX / Math.max(w, h));
    w = Math.max(1, Math.floor(w * scale));
    h = Math.max(1, Math.floor(h * scale));
    out.width = w;
    out.height = h;

    // canvas サイズ変更後に再度フォントを設定（リセットされるため）
    octx.setTransform(scale, 0, 0, scale, 0, 0);
    octx.font = fontStr;
    octx.textBaseline = "top";
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
    if (drawerBackdrop) {
      drawerBackdrop.classList.add("drawer-backdrop--open");
      drawerBackdrop.setAttribute("aria-hidden", "false");
    }
  }

  function closeDrawer() {
    if (drawerBackdrop) {
      drawerBackdrop.classList.remove("drawer-backdrop--open");
      drawerBackdrop.setAttribute("aria-hidden", "true");
    }
  }

  if (drawerContent) {
    const clone = document.createElement("div");
    clone.className = "drawer-sidebar";
    clone.appendChild(sidebarPanels.cloneNode(true));
    drawerContent.replaceChildren(clone);
  }
  qsa("#btnStop").forEach((b) => b.addEventListener("click", () => {
    clearTransientFeedback();
    if (running) stopCamera();
  }));

  qsa("#btnPlay").forEach((b) => b.addEventListener("click", () => {
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
  }));

  qsa("#btnPause").forEach((b) => b.addEventListener("click", () => {
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
  }));

  qsa("#btnExportTxt").forEach((b) =>
    b.addEventListener("click", () => {
      if (!running) {
        alert("カメラ起動中でないと実行できません");
        return;
      }
      exportAsciiTxt();
    })
  );
  qsa("#btnExportJpg").forEach((b) =>
    b.addEventListener("click", () => {
      if (!running) {
        alert("カメラ起動中でないと実行できません");
        return;
      }
      exportAsciiJpg();
    })
  );

  qsa("#btnExportMov").forEach((b) => {
    b.addEventListener("click", async () => {
      // 既に録画フロー起動済みなら無視（複数ボタンからの重複発火防止）
      if (isRecordingMov || recordingPhase === "countdown") return;
      if (!running) {
        alert("カメラ起動中でないと実行できません");
        return;
      }
      clearTransientFeedback();

      // 即座にフラグを立てて重複起動を防ぐ
      recordingPhase = "countdown";

      const btn = qsa("#btnExportMov")[0];
      setButtonDisabled("btnExportMov", true);
      setButtonText("btnExportMov", "3...");
      setRecButtonStyle("#ff3366", "#ff3366");
      updateRecordingHud("countdown", "REC_IN_3");
      updatePlaybackButtons(state.realtime ? "play" : "pause");
      setStatus("REC_PREPARING");

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
    const pad = Math.max(20, fsize);

    recordCanvas = document.createElement("canvas");
    recordingCtx = recordCanvas.getContext("2d", { willReadFrequently: true });

    // CHAR_ASPECT に合わせた行高さ（表示と同じアスペクト比）
    recordingCtx.font = `${state.fontWeight} ${fsize}px "JetBrains Mono", monospace`;
    const charW = recordingCtx.measureText("M").width;
    const lineH = charW * CHAR_ASPECT;

    let maxW = 0;
    for (let i = 0; i < lines.length; i++) {
        const w = recordingCtx.measureText(lines[i]).width;
        if (w > maxW) maxW = w;
    }
    recordCanvas.width = Math.ceil(maxW) + pad * 2;
    recordCanvas.height = Math.ceil(lines.length * lineH) + pad * 2;

    // 初期フレームを即座に描画（一時停止中でも最初のフレームを確保）
    recordingCtx.fillStyle = "#0116ff";
    recordingCtx.fillRect(0, 0, recordCanvas.width, recordCanvas.height);
    recordingCtx.fillStyle = "#ffffff";
    recordingCtx.font = `${state.fontWeight} ${fsize}px "JetBrains Mono", monospace`;
    recordingCtx.textBaseline = "top";
    for (let i = 0; i < lines.length; i++) {
      recordingCtx.fillText(lines[i] || "", pad, pad + i * lineH);
    }

    const captureStream = recordCanvas.captureStream(30);
    let mimeString = "video/mp4;codecs=h264";
    let ext = "mp4";
    if (!MediaRecorder.isTypeSupported(mimeString)) {
      mimeString = "video/mp4";
    }
    if (!MediaRecorder.isTypeSupported(mimeString)) {
      setButtonDisabled("btnExportMov", false);
      setButtonText("btnExportMov", "REC.MOV_(5S)");
      setRecButtonStyle("", "");
      updateRecordingHud("idle");
      updatePlaybackButtons(state.realtime ? "play" : "pause");
      setStatus("MP4_RECORDING_NOT_SUPPORTED");
      updateExportButtons();
      return;
    }
    
    const options = MediaRecorder.isTypeSupported(mimeString) ? { mimeType: mimeString } : undefined;
    const movieRecorder = new MediaRecorder(captureStream, options);
    const recordChunks = [];

    movieRecorder.onerror = (event) => {
      console.error(event.error || event);
      isRecordingMov = false;
      setRecButtonStyle("", "");
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
      setRecButtonStyle("", "");
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

    // 一時停止中でも canvas を定期的に再描画して captureStream にフレームを供給する
    // （captureStream は canvas の変化がないとフレームを出力しないため）
    let recordRafId = 0;
    const recordingLoop = () => {
      if (!isRecordingMov) return;
      // 一時停止中（!state.realtime）でも renderAsciiFrame を呼ぶ
      renderAsciiFrame();
      recordRafId = requestAnimationFrame(recordingLoop);
    };
    // リアルタイム再生中は既存ループが動いているので、一時停止中のみ補助ループを起動
    if (!state.realtime) {
      recordRafId = requestAnimationFrame(recordingLoop);
    }

    let secondsLeft = 5;
    recordingDurationTimer = setInterval(() => {
      secondsLeft--;
      if (secondsLeft > 0) {
         setButtonText("btnExportMov", `REC_(${secondsLeft}S)...`);
         updateRecordingHud("recording", `REC_${secondsLeft}S`);
      } else {
         clearInterval(recordingDurationTimer);
         recordingDurationTimer = 0;
         cancelAnimationFrame(recordRafId);
         if (movieRecorder.state !== "inactive") {
           movieRecorder.stop();
         }
      }
    }, 1000);
  }

  // drawerBackdrop/btnCloseDrawer は削除済みのため参照しない
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
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
    // テキストがあれば Manual Input を有効化、空なら無効化
    state.useCustomCharset = Boolean(v.trim()) && v.trim().length >= 2;
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
      // Manual Input を無効化（テキストは残す）
      state.useCustomCharset = false;
      updateCharsetButtons(value);
      updateManualInputState();
      scheduleFrame();
    });
  });


  updateControlLabels();
  updatePlaybackButtons("stop");
  updateExportButtons();

  // ─── Mobile Tab Bar ───────────────────────────────────────────
  const mobileTabBtns = document.querySelectorAll(".mobile-tab-bar__tab");
  const mobilePanels = document.querySelectorAll(".mobile-panel");

  mobileTabBtns.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.panel;
      mobileTabBtns.forEach((t) => t.classList.toggle("mobile-tab-bar__tab--active", t === tab));
      mobilePanels.forEach((p) => {
        p.classList.toggle("mobile-panel--active", p.id === `mobile-panel-${target}`);
      });
    });
  });

  // ─── Mobile Controls Toggle ───────────────────────────────────
  const btnToggleControls = document.getElementById("btnToggleControls");

  if (btnToggleControls) {
    btnToggleControls.addEventListener("click", () => {
      // position: fixed 要素に祖先セレクタを効かせるため body にクラスを付ける
      const isHidden = document.body.classList.toggle("controls-hidden");
      btnToggleControls.setAttribute("aria-pressed", String(isHidden));
      btnToggleControls.setAttribute(
        "aria-label",
        isHidden ? "コントロールパネルを表示" : "コントロールパネルを隠す"
      );
    });
  }

  window.addEventListener("beforeunload", () => {
    stopCamera();
  });
})();
