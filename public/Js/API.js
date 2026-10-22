
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
    rating: "g"
  });

  const response = await fetch(
    `https://api.giphy.com/v1/gifs/search?${params}`
  );

  if (!response.ok) {
      const details = await response.text();

        throw new Error(
            `GIPHY error ${response.status}: ${details}`
        );
  }

  const result = await response.json();

  return result.data.map(gif => ({
    id: gif.id,
    preview: gif.images.fixed_width.url,
    original: gif.images.original.url
  }));
}

