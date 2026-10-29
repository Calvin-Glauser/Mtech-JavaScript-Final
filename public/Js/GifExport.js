import { parseGIF, decompressFrames } from "https://esm.sh/gifuct-js@2.1.2";

function drawCaption(context, text, width, barHeight) {
  context.fillStyle = "white";
  context.fillRect(0, 0, width, barHeight);

  if (!text) return;

  const fontSize = Math.max(12, Math.floor(width * 0.06));
  context.fillStyle = "black";
  context.font = `bold ${fontSize}px Arial`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  const maxWidth = width * 0.94;
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  const lineHeight = fontSize * 1.2;
  const startY = (barHeight - (lines.length - 1) * lineHeight) / 2;

  lines.forEach((captionLine, index) => {
    context.fillText(
      captionLine,
      width / 2,
      startY + index * lineHeight,
      maxWidth,
    );
  });
}

export async function createCaptionedGif(gifUrl, caption) {
  const response = await fetch(gifUrl);
  if (!response.ok) throw new Error("Could not fetch the selected GIF.");

  const parsed = parseGIF(await response.arrayBuffer());
  const frames = decompressFrames(parsed, true);
  if (!frames.length) throw new Error("The selected GIF has no frames.");

  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  const barHeight = caption ? Math.max(70, Math.ceil(width * 0.2)) : 0;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceContext = source.getContext("2d");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height + barHeight;
  const context = canvas.getContext("2d");

  if (typeof window.GIF !== "function") {
    throw new Error("gif.js did not load. Check the script path.");
  }

  const encoder = new window.GIF({
    workers: 4,
    quality: 1,
    width: canvas.width,
    height: canvas.height,
    workerScript: "./Js/gif.worker.js",
    repeat: 0,
  });

  let previousFrame = null;
  let savedImage = null;

  for (const frame of frames) {
    if (previousFrame?.disposalType === 2) {
      sourceContext.clearRect(
        previousFrame.dims.left,
        previousFrame.dims.top,
        previousFrame.dims.width,
        previousFrame.dims.height,
      );
    } else if (previousFrame?.disposalType === 3 && savedImage) {
      sourceContext.putImageData(savedImage, 0, 0);
    }

    savedImage =
      frame.disposalType === 3
        ? sourceContext.getImageData(0, 0, width, height)
        : null;

    const patch = new ImageData(
      new Uint8ClampedArray(frame.patch),
      frame.dims.width,
      frame.dims.height,
    );
    const patchCanvas = document.createElement("canvas");
    patchCanvas.width = frame.dims.width;
    patchCanvas.height = frame.dims.height;
    patchCanvas.getContext("2d").putImageData(patch, 0, 0);
    sourceContext.drawImage(patchCanvas, frame.dims.left, frame.dims.top);

    context.clearRect(0, 0, canvas.width, canvas.height);
    if (barHeight) drawCaption(context, caption, width, barHeight);
    context.drawImage(source, 0, barHeight);
    encoder.addFrame(context, { copy: true, delay: frame.delay * 10 });
    previousFrame = frame;
  }

  return new Promise((resolve, reject) => {
    encoder.on("finished", resolve);
    encoder.on("abort", () => reject(new Error("GIF generation was interrupted.")));
    encoder.render();
  });
}

export function downloadGif(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}