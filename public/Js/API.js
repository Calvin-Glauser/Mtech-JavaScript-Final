const GIPHY_API_KEY = 'eP4NQm1jDbwWt8aLgp8AIH1KTZsdfQLn';
const GIPHY_API_URL = 'https://api.giphy.com/v1/gifs';

async function fetchGifs(endpoint, options = {}) {
	const params = new URLSearchParams({
		api_key: GIPHY_API_KEY,
		limit: String(Math.min(Math.max(Number(options.limit) || 25, 1), 50)),
		rating: options.rating || 'g'
	});

	if (options.query) params.set('q', options.query);
	if (options.language) params.set('lang', options.language);
	if (options.offset) params.set('offset', String(Math.max(Number(options.offset) || 0, 0)));

	const response = await fetch(`${GIPHY_API_URL}/${endpoint}?${params}`);
	if (!response.ok) {
		throw new Error(`GIPHY request failed (${response.status}).`);
	}

	const result = await response.json();
	if (result.meta?.status !== 200) {
		throw new Error(result.meta?.msg || 'GIPHY returned an error.');
	}

	return result.data;
}

export function searchGifs(query, options = {}) {
	const search = String(query || '').trim();
	if (!search) return Promise.resolve([]);

	return fetchGifs('search', { ...options, query: search });
}

export function getTrendingGifs(options = {}) {
	return fetchGifs('trending', options);
}
