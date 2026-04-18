(() => {
  "use strict";

  const CHARSETS = {
    detailed:
      " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    simple: " .:-=+*#%@",
    blocks: " ░▒▓█",
    minimal: " ·oO0@",
  };

  const video = document.getElementById("video");
  const canvas = document.getElementById("capture");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const asciiEl = document.getElementById("ascii");
  const statusEl = document.getElementById("status");
  const btnToggle = document.getElementById("btnToggle");

  const colsInput = document.getElementById("cols");
  const colsValue = document.getElementById("colsValue");
  const contrastInput = document.getElementById("contrast");
  const contrastValue = document.getElementById("contrastValue");
  const mirrorInput = document.getElementById("mirror");
  const invertInput = document.getElementById("invert");
  const colorInput = document.getElementById("color");
  const charsetSelect = document.getElementById("charset");

  let stream = null;
  let rafId = 0;
  let running = false;

  /** モノスペースの縦横比（文字は横より縦に長い） */
  const CHAR_ASPECT = 1.9;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function getCharset() {
    return CHARSETS[charsetSelect.value] || CHARSETS.detailed;
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

  function renderFrame() {
    if (!running || video.readyState < 2) {
      rafId = requestAnimationFrame(renderFrame);
      return;
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0) {
      rafId = requestAnimationFrame(renderFrame);
      return;
    }

    const cols = Number(colsInput.value);
    const contrast = Number(contrastInput.value);
    const mirror = mirrorInput.checked;
    const invert = invertInput.checked;
    const useColor = colorInput.checked;
    const chars = getCharset();

    const cellW = vw / cols;
    const cellH = cellW * CHAR_ASPECT;
    const rows = Math.max(1, Math.floor(vh / cellH));

    canvas.width = cols;
    canvas.height = rows;

    ctx.save();
    if (mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, cols, rows);
    ctx.restore();

    const img = ctx.getImageData(0, 0, cols, rows);
    const d = img.data;

    let out = "";
    let html = "";

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        let r = d[i];
        let g = d[i + 1];
        let b = d[i + 2];

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
      if (useColor) {
        html += "\n";
      } else {
        out += "\n";
      }
    }

    if (useColor) {
      asciiEl.innerHTML = html;
    } else {
      asciiEl.textContent = out;
    }

    rafId = requestAnimationFrame(renderFrame);
  }

  function escapeHtml(ch) {
    const div = document.createElement("div");
    div.textContent = ch;
    return div.innerHTML;
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
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      running = true;
      btnToggle.textContent = "カメラを停止";
      btnToggle.classList.add("btn-danger");
      btnToggle.classList.remove("btn-primary");
      setStatus("映像を変換中です");
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(renderFrame);
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
    btnToggle.textContent = "カメラを開始";
    btnToggle.classList.remove("btn-danger");
    btnToggle.classList.add("btn-primary");
    setStatus("カメラを停止しました");
  }

  btnToggle.addEventListener("click", () => {
    if (running) {
      stopCamera();
    } else {
      startCamera();
    }
  });

  colsInput.addEventListener("input", () => {
    colsValue.textContent = colsInput.value;
  });

  contrastInput.addEventListener("input", () => {
    contrastValue.textContent = contrastInput.value;
  });

  window.addEventListener("beforeunload", () => {
    stopCamera();
  });
})();
