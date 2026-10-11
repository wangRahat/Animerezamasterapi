// AnimeReza Master API v1.0 — api/anime.js
// Deploy on Vercel. Single endpoint returns everything.
//
// Usage:
//   GET /api/anime?slug=naruto-20          → by AniList slug
//   GET /api/anime?mal=20                  → by MAL ID
//   GET /api/anime?anilist=20              → by AniList ID
//   GET /api/anime?slug=naruto-20&ep=1&season=1  → include stream URLs
//
// Returns full JSON: meta + IDs + streaming links

const TMDB_KEY   = process.env.TMDB_API_KEY || 'c24da0be248457021c4505f96ccc93c4';
const TMDB_BASE  = 'https://api.themoviedb.org/3';
const ANILIST_GQL= 'https://graphql.anilist.co';
const MEGAPLAY   = 'https://megaplay.buzz';
const OLLY       = 'https://ollyembed.pages.dev';

// ── AniList GraphQL query ─────────────────────────────────────────────────────
const ANILIST_QUERY = `
query($id: Int, $malId: Int, $slug: String) {
  Media(
    id: $id,
    idMal: $malId,
    search: $slug,
    type: ANIME,
    sort: SEARCH_MATCH
  ) {
    id
    idMal
    title { romaji english native }
    description(asHtml: false)
    coverImage { extraLarge large }
    bannerImage
    format
    status
    episodes
    duration
    season
    seasonYear
    averageScore
    genres
    studios(isMain: true) { nodes { name } }
    nextAiringEpisode { episode airingAt }
    externalLinks { site url }
    synonyms
  }
}`;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// ── AniList fetch ─────────────────────────────────────────────────────────────
async function fetchAnilist(vars) {
  const data = await fetchJson(ANILIST_GQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: vars }),
  });
  if (data.errors) throw new Error(data.errors[0]?.message || 'AniList error');
  return data.data?.Media ?? null;
}

// ── TMDB: find TV show ID from MAL ID via find endpoint ──────────────────────
async function fetchTmdbId(malId) {
  if (!malId) return null;
  try {
    // TMDB external ID lookup — MAL IDs aren't directly supported
    // Strategy: search TMDB by title + year from AniList, pick best match
    return null; // resolved after we have AniList data — see buildTmdbId()
  } catch { return null; }
}

async function buildTmdbId(aniMedia) {
  if (!aniMedia) return null;
  try {
    const title = aniMedia.title.english || aniMedia.title.romaji;
    const year  = aniMedia.seasonYear;
    const type  = aniMedia.format === 'MOVIE' ? 'movie' : 'tv';

    const url = `${TMDB_BASE}/search/${type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&first_air_date_year=${year}&language=en-US`;
    const data = await fetchJson(url);
    const results = data.results || [];
    if (!results.length) {
      // Retry without year filter
      const url2 = `${TMDB_BASE}/search/${type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=en-US`;
      const data2 = await fetchJson(url2);
      return data2.results?.[0]?.id ?? null;
    }
    return results[0].id ?? null;
  } catch { return null; }
}

// ── MegaPlay stream URLs ──────────────────────────────────────────────────────
async function fetchMegaplay(malId, ep = 1, season = 1) {
  if (!malId) return { sub: null, dub: null };
  try {
    const base = `${MEGAPLAY}/embed`;
    // MegaPlay uses MAL ID based slugs
    const sub = `${base}/anime/${malId}/${season}/${ep}`;
    const dub = `${base}/anime/${malId}/${season}/${ep}?dub=true`;
    return { sub, dub };
  } catch { return { sub: null, dub: null }; }
}

// ── OllyEmbed URLs (constructed, no API call needed) ─────────────────────────
function buildOllyUrls(tmdbId, ep = 1, season = 1, isMovie = false) {
  if (!tmdbId) return null;
  const base = isMovie
    ? `${OLLY}/movie/${tmdbId}`
    : `${OLLY}/tv/${tmdbId}/${season}/${ep}`;

  return {
    hindi:   `${base}?server=Hindi`,
    hindiv2: `${base}?server=2`,
    hindiv3: `${base}?server=3`,
    hindiv4: `${base}?server=4`,
  };
}

// ── Normalise AniList media object ───────────────────────────────────────────
function normaliseMedia(m) {
  if (!m) return null;
  const statusMap = {
    FINISHED:         'Completed',
    RELEASING:        'Airing',
    NOT_YET_RELEASED: 'Upcoming',
    CANCELLED:        'Cancelled',
    HIATUS:           'Hiatus',
  };
  const formatMap = {
    TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie',
    SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music',
  };
  return {
    anilist_id:   m.id,
    mal_id:       m.idMal,
    title:        m.title.english || m.title.romaji,
    title_en:     m.title.english  || '',
    title_ro:     m.title.romaji   || '',
    title_native: m.title.native   || '',
    poster:       m.coverImage?.extraLarge || m.coverImage?.large || '',
    banner:       m.bannerImage || '',
    synopsis:     (m.description || '').replace(/<[^>]+>/g, '').trim(),
    score:        m.averageScore ? (m.averageScore / 10).toFixed(1) : null,
    type:         formatMap[m.format] || m.format || '',
    status:       statusMap[m.status] || m.status || '',
    episodes:     m.episodes || null,
    duration:     m.duration || null,
    season:       m.season   || null,
    year:         m.seasonYear || null,
    genres:       m.genres || [],
    studios:      m.studios?.nodes?.map(s => s.name) || [],
    next_ep:      m.nextAiringEpisode
      ? { episode: m.nextAiringEpisode.episode, airing_at: m.nextAiringEpisode.airingAt }
      : null,
    external_links: (m.externalLinks || []).map(l => ({ site: l.site, url: l.url })),
    synonyms:     m.synonyms || [],
    is_movie:     m.format === 'MOVIE',
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { slug, mal, anilist, ep = '1', season = '1' } = req.query;
  const epNum     = Math.max(1, parseInt(ep)     || 1);
  const seasonNum = Math.max(1, parseInt(season) || 1);

  if (!slug && !mal && !anilist) {
    return res.status(400).json({
      error: 'Missing parameter. Use ?slug=, ?mal=, or ?anilist=',
      example: '/api/anime?slug=naruto-20&ep=1&season=1',
    });
  }

  try {
    // ── Step 1: Fetch AniList metadata ──────────────────────────────────────
    const vars = {};
    if (anilist) vars.id    = parseInt(anilist);
    else if (mal) vars.malId = parseInt(mal);
    else          vars.slug  = slug.replace(/-\d+$/, ''); // strip trailing ID

    const aniMedia  = await fetchAnilist(vars);
    if (!aniMedia) return res.status(404).json({ error: 'Anime not found on AniList' });

    const meta      = normaliseMedia(aniMedia);

    // ── Step 2: Get TMDB ID (parallel with stream fetch) ────────────────────
    const [tmdbId, megaplay] = await Promise.all([
      buildTmdbId(aniMedia),
      fetchMegaplay(meta.mal_id, epNum, seasonNum),
    ]);

    // ── Step 3: Build OllyEmbed URLs ─────────────────────────────────────────
    const olly = buildOllyUrls(tmdbId, epNum, seasonNum, meta.is_movie);

    // ── Step 4: Compose response ─────────────────────────────────────────────
    const response = {
      success: true,
      meta,
      ids: {
        anilist_id: meta.anilist_id,
        mal_id:     meta.mal_id,
        tmdb_id:    tmdbId,
      },
      streaming: {
        episode:  epNum,
        season:   seasonNum,
        megaplay: {
          sub: megaplay.sub,
          dub: megaplay.dub,
        },
        olly: olly || {
          hindi:   null,
          hindiv2: null,
          hindiv3: null,
          hindiv4: null,
          note: 'TMDB ID not found — OllyEmbed unavailable for this anime',
        },
      },
      cached_at: new Date().toISOString(),
    };

    // Cache for 1 hour on Vercel edge
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(response);

  } catch (err) {
    console.error('[MasterAPI]', err.message);
    return res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  }
}
