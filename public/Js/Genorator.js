import { searchGIFs } from "./API.js";
import { createCaptionedGif, downloadGif } from "./GifExport.js";

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

    gifs.forEach((gif) => {
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

async function downloadGIF() {
  if (!selectedGIF) return;

  downloadBtn.disabled = true;
  status.textContent = "Generating animated GIF...";

  try {
    const blob = await createCaptionedGif(selectedGIF.original, appliedCaption);
    downloadGif(blob, "my-meme.gif");
    status.textContent = "GIF generated!";
  } catch (error) {
    console.error(error);
    status.textContent = `Download failed: ${error.message}`;
  } finally {
    downloadBtn.disabled = false;
  }
}

if (!new URLSearchParams(window.location.search).has("lobby")) {
  searchButton.addEventListener("click", handleSearch);
  applyBtn.addEventListener("click", applyText);
  downloadBtn.addEventListener("click", downloadGIF);
}
