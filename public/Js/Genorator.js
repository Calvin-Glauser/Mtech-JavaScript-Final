
import { searchGIFs } from "./API.js";
import {
  parseGIF,
  decompressFrames
} from "https://esm.sh/gifuct-js@2.1.2";

let selectedGIF = null;
let appliedCaption = "";

const searchInput = document.getElementById("searchInput");
const searchButton = document.getElementById("searchButton");
const results = document.getElementById("results");
const gifPreview = document.getElementById("gifPreview");
const topText = document.getElementById("topText");
const captionBar = document.getElementById("captionBar");
const applyBtn = document.getElementById("applyTextBtn");
const downloadBtn = document.getElementById("downloadBtn");
const status = document.getElementById("status");

async function handleSearch() {
  const term = searchInput.value.trim();
  if (!term) return;

  status.textContent = "Searching...";
  results.replaceChildren();

  try {
    const gifs = await searchGIFs(term);

    gifs.forEach(gif => {
      const img = document.createElement("img");
      img.src = gif.preview;
      img.alt = "GIPHY result";

      img.addEventListener("click", () => {
        selectedGIF = gif;
        appliedCaption = "";
        captionBar.textContent = "";
        gifPreview.src = gif.original;
        downloadBtn.disabled = true;
        status.textContent = "GIF selected. Apply your text.";
      });

      results.appendChild(img);
    });

    status.textContent = `${gifs.length} GIFs found.`;
  } catch (error) {
    console.error(error);
    status.textContent = error.message;
  }
}

function applyText() {
  if (!selectedGIF) {
    status.textContent = "Select a GIF first.";
    return;
  }

  appliedCaption = topText.value.trim();
  captionBar.textContent = appliedCaption;
  downloadBtn.disabled = false;
  status.textContent = "Preview updated. Ready to download.";
}

function drawCaption(ctx, text, width, barHeight) {
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, barHeight);

  if (!text) return;

  const fontSize = Math.max(12, Math.floor(width * 0.06));
  ctx.fillStyle = "black";
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";


  const maxWidth = width * 0.94;
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  const lineHeight = fontSize * 1.2;
  const startY = (barHeight - (lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, index) => {
    ctx.fillText(
      line,
      width / 2,
      startY + index * lineHeight,
      maxWidth
    );
  });
}

async function downloadGIF() {
  if (!selectedGIF) return;

  downloadBtn.disabled = true;
  status.textContent = "Generating animated GIF...";

  try {
    const response = await fetch(selectedGIF.original);
    if (!response.ok) throw new Error("Could not fetch GIF.");

    const buffer = await response.arrayBuffer();
    const parsed = parseGIF(buffer);
    const frames = decompressFrames(parsed, true);

    const width = parsed.lsd.width;
    const height = parsed.lsd.height;
    const barHeight = appliedCaption
      ? Math.max(70, Math.ceil(width * 0.2))
      : 0;


    const source = document.createElement("canvas");
    source.width = width;
    source.height = height;
    const sourceCtx = source.getContext("2d");


    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height + barHeight;
    const ctx = canvas.getContext("2d");

if (typeof window.GIF !== "function") {
  throw new Error("gif.js did not load. Check the script path.");
}

const encoder = new window.GIF({
  workers: 4,
  quality: 1,
  width: canvas.width,
  height: canvas.height,
  workerScript: "./Js/gif.worker.js",
  repeat: 0
});

    let previous = null;
    let savedImage = null;

    for (const frame of frames) {

      if (previous?.disposalType === 2) {
        sourceCtx.clearRect(
          previous.dims.left,
          previous.dims.top,
          previous.dims.width,
          previous.dims.height
        );
      } else if (previous?.disposalType === 3 && savedImage) {
        sourceCtx.putImageData(savedImage, 0, 0);
      }


      savedImage = frame.disposalType === 3
        ? sourceCtx.getImageData(0, 0, width, height)
        : null;

      const patch = new ImageData(
        new Uint8ClampedArray(frame.patch),
        frame.dims.width,
        frame.dims.height
      );

      const patchCanvas = document.createElement("canvas");
      patchCanvas.width = frame.dims.width;
      patchCanvas.height = frame.dims.height;
      patchCanvas.getContext("2d").putImageData(patch, 0, 0);

      sourceCtx.drawImage(
        patchCanvas,
        frame.dims.left,
        frame.dims.top
      );


      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (barHeight) {
        drawCaption(ctx, appliedCaption, width, barHeight);
      }

      ctx.drawImage(source, 0, barHeight);

encoder.addFrame(ctx, {
  copy: true,
  delay: frame.delay * 10
});

      previous = frame;
    }

    encoder.on("finished", blob => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "my-meme.gif";
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(url), 10000);
      downloadBtn.disabled = false;
      status.textContent = "GIF generated!";
    });

    encoder.on("abort", () => {
      downloadBtn.disabled = false;
      status.textContent = "GIF generation was interrupted.";
    });

    encoder.render();
  } catch (error) {
    console.error(error);
    downloadBtn.disabled = false;
    status.textContent = `Download failed: ${error.message}`;
  }
}

if (!new URLSearchParams(window.location.search).has("lobby")) {
  searchButton.addEventListener("click", handleSearch);
  applyBtn.addEventListener("click", applyText);
  downloadBtn.addEventListener("click", downloadGIF);
}
