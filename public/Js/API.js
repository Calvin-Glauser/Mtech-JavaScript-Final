const API_KEY = "eP4NQm1jDbwWt8aLgp8AIH1KTZsdfQLn";

export async function searchGIFs(searchTerm) {
  const term = String(searchTerm || "").trim();

  if (!term) {
    return [];
  }

  const params = new URLSearchParams({
    api_key: API_KEY,
    q: term,
    limit: "5",
    rating: "g",
  });

  const response = await fetch(
    `https://api.giphy.com/v1/gifs/search?${params}`,
  );

  if (!response.ok) {
    const details = await response.text();

    throw new Error(`GIPHY error ${response.status}: ${details}`);
  }

  const result = await response.json();

  return (result.data || []).flatMap((gif) => {
    const images = gif.images || {};
    const original =
      images.original?.url ||
      images.downsized_large?.url ||
      images.downsized?.url;
    const preview =
      images.fixed_width_downsampled?.url ||
      images.fixed_width?.url ||
      images.downsized?.url ||
      original;
    return original && preview ? [{ id: gif.id, preview, original }] : [];
  });
}
