// AnimeReza Master API v2.0 — api/anime.js
// Single endpoint: AniList metadata + ID mappings + streams (animelok sub/dub + toonstream Hindi)
//
// GET /api/anime?anilist=20&ep=1&season=1
// GET /api/anime?mal=20&ep=1&season=1
// GET /api/anime?slug=naruto-20&ep=1&season=1

const TMDB_KEY = 'c24da0be248457021c4505f96ccc93c4';
const COOREN_URL = 'https://cooren-labsapi.vercel.app';
const TMDB_BASE   = 'https://api.themoviedb.org/3';
const ANILIST_GQL = 'https://graphql.anilist.co';
const OLLY        = 'https://ollyembed.pages.dev';

// ── Fetch helper ──────────────────────────────────────────────────────────────
async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} → ${url}`);
  return res.json();
}

async function fetchJsonSafe(url, opts = {}) {
  try { return await fetchJson(url, opts); } catch { return null; }
}

// ── AniList GraphQL ───────────────────────────────────────────────────────────
const ANILIST_QUERY = `
query($id:Int,$malId:Int,$search:String){
  Media(id:$id,idMal:$malId,search:$search,type:ANIME,sort:SEARCH_MATCH){
    id idMal
    title{ romaji english native }
    description(asHtml:false)
    coverImage{ extraLarge large }
    bannerImage
    format status episodes duration
    season seasonYear
    averageScore
    genres
    studios(isMain:true){ nodes{ name } }
    nextAiringEpisode{ episode airingAt }
    synonyms
  }
}`;

async function fetchAnilist(vars) {
  const data = await fetchJson(ANILIST_GQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: vars }),
  });
  if (data.errors) throw new Error(data.errors[0]?.message || 'AniList error');
  return data.data?.Media ?? null;
}

// ── CoorenLabs: ID mapping (ARM — gives TMDB, MAL, AniDB etc) ────────────────
async function fetchIdMap(anilistId) {
  const data = await fetchJsonSafe(`${COOREN_URL}/anime/anivexa/map/${anilistId}`);
  return data?.data?.mappings ?? null;
}

// TMDB fallback — search by title + year when ARM returns no themoviedbId
async function fetchTmdbFallback(title, year, isMovie) {
  if (!title) return null;
  try {
    const type = isMovie ? 'movie' : 'tv';
    const yearParam = year ? `&${isMovie ? 'primary_release_year' : 'first_air_date_year'}=${year}` : '';
    const url = `${TMDB_BASE}/search/${type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}${yearParam}&language=en-US`;
    const data = await fetchJson(url);
    if (data?.results?.[0]?.id) return data.results[0].id;
    // Retry without year if no result
    if (year) {
      const url2 = `${TMDB_BASE}/search/${type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=en-US`;
      const data2 = await fetchJson(url2);
      return data2?.results?.[0]?.id ?? null;
    }
    return null;
  } catch { return null; }
}

// ── CoorenLabs: Animelok sub/dub streams ─────────────────────────────────────
async function fetchAnimelokStream(anilistId, ep) {
  const data = await fetchJsonSafe(
    `${COOREN_URL}/anime/animelok/stream/${anilistId}/${ep}`
  );
  if (!data?.success || !data?.data) return null;
  const d = data.data;
  return {
    sub: {
      best:    d.sub?.best    ?? d.sub?.embeds?.[0]?.url ?? null,
      embeds:  d.sub?.embeds  ?? [],
      hash:    d.sub?.hash    ?? null,
    },
    dub: {
      best:    d.dub?.best    ?? d.dub?.embeds?.[0]?.url ?? null,
      embeds:  d.dub?.embeds  ?? [],
      hash:    d.dub?.hash    ?? null,
    },
  };
}

// ── CoorenLabs: Toonstream Hindi search + stream ──────────────────────────────
async function fetchToonstreamHindi(title, season = 1, ep = 1) {
  if (!title) return null;
  try {
    // Step 1: Search toonstream
    const search = await fetchJsonSafe(
      `${COOREN_URL}/anime/toonstream/search/${encodeURIComponent(title)}/1`
    );
    const results = search?.data ?? [];
    if (!results.length) return null;

    // Step 2: Best match — prefer series type
    const match = results.find(r => r.type === 'series') ?? results[0];
    if (!match?.slug) return null;

    // Step 3: Construct episode slug directly — format: {series-slug}-{season}x{episode}
    // This avoids an extra series/info API call
    const epSlug = `${match.slug}-${season}x${ep}`;

    // Step 4: Get stream sources
    const sources = await fetchJsonSafe(
      `${COOREN_URL}/anime/toonstream/episode/sources/${epSlug}`
    );

    // Fallback: try with ?season=&episode= query params if slug construction fails
    const finalSources = sources?.success ? sources
      : await fetchJsonSafe(
          `${COOREN_URL}/anime/toonstream/episode/sources/${match.slug}?season=${season}&episode=${ep}`
        );

    if (!finalSources?.success) return null;

    return {
      slug:    match.slug,
      ep_slug: epSlug,
      sources: finalSources.data?.sources ?? [],  // direct HLS .m3u8 — ad-free
      embeds:  finalSources.data?.embeds  ?? [],  // embed fallback
      hash:    finalSources.data?.hash    ?? null,
    };
  } catch { return null; }
}

// ── OllyEmbed URL builder (no API call needed) ────────────────────────────────
function buildOllyUrls(tmdbId, ep, season, isMovie) {
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

// ── Normalise AniList media ───────────────────────────────────────────────────
function normalise(m) {
  const statusMap = {
    FINISHED:'Completed', RELEASING:'Airing',
    NOT_YET_RELEASED:'Upcoming', CANCELLED:'Cancelled', HIATUS:'Hiatus',
  };
  const formatMap = {
    TV:'TV', TV_SHORT:'TV Short', MOVIE:'Movie',
    SPECIAL:'Special', OVA:'OVA', ONA:'ONA', MUSIC:'Music',
  };
  return {
    title:        m.title.english  || m.title.romaji,
    title_en:     m.title.english  || '',
    title_ro:     m.title.romaji   || '',
    title_native: m.title.native   || '',
    poster:       m.coverImage?.extraLarge || m.coverImage?.large || '',
    banner:       m.bannerImage || '',
    synopsis:     (m.description || '').replace(/<[^>]+>/g, '').trim(),
    score:        m.averageScore ? (m.averageScore / 10).toFixed(1) : null,
    type:         formatMap[m.format]  || m.format  || '',
    status:       statusMap[m.status]  || m.status  || '',
    episodes:     m.episodes     || null,
    duration:     m.duration     || null,
    season:       m.season       || null,
    year:         m.seasonYear   || null,
    genres:       m.genres       || [],
    studios:      m.studios?.nodes?.map(s => s.name) || [],
    next_ep:      m.nextAiringEpisode
      ? { episode: m.nextAiringEpisode.episode, airing_at: m.nextAiringEpisode.airingAt }
      : null,
    synonyms:     m.synonyms || [],
    is_movie:     m.format === 'MOVIE',
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const { slug, mal, anilist, ep = '1', season = '1' } = req.query;
  const epNum     = Math.max(1, parseInt(ep)     || 1);
  const seasonNum = Math.max(1, parseInt(season) || 1);

  if (!slug && !mal && !anilist) {
    return res.status(400).json({
      error:   'Missing required parameter',
      usage:   'GET /api/anime?anilist=<id>&ep=<n>&season=<n>',
      example: '/api/anime?anilist=20&ep=1&season=1',
    });
  }

  try {
    // ── Step 1: AniList metadata ─────────────────────────────────────────────
    const vars = {};
    if (anilist)   vars.id     = parseInt(anilist);
    else if (mal)  vars.malId  = parseInt(mal);
    else           vars.search = slug.replace(/-\d+$/, '');

    const aniMedia = await fetchAnilist(vars);
    if (!aniMedia) return res.status(404).json({ error: 'Anime not found on AniList' });

    const meta      = normalise(aniMedia);
    const anilistId = aniMedia.id;

    // ── Step 2: All parallel calls ───────────────────────────────────────────
    const [idMap, animelok, toonstream] = await Promise.all([
      fetchIdMap(anilistId),                                      // ARM ID mapping → TMDB ID
      fetchAnimelokStream(anilistId, epNum),                      // sub + dub embeds
      fetchToonstreamHindi(meta.title_en || meta.title_ro, seasonNum, epNum), // Hindi HLS
    ]);

    // ── Step 3: Extract IDs from ARM mapping (ARM uses themoviedbId not tmdb_id) ─
    const malId   = idMap?.malId        ?? aniMedia.idMal ?? null;
    const anidbId = idMap?.anidbId      ?? null;
    // TMDB: ARM first, then TMDB search fallback
    let tmdbId    = idMap?.themoviedbId ?? null;
    if (!tmdbId) {
      tmdbId = await fetchTmdbFallback(
        meta.title_en || meta.title_ro,
        meta.year,
        meta.is_movie
      );
    }

    // ── Step 4: OllyEmbed URLs (constructed from TMDB ID, no API call) ───────
    const olly = buildOllyUrls(tmdbId, epNum, seasonNum, meta.is_movie);

    // ── Step 5: Compose response ─────────────────────────────────────────────
    const response = {
      success: true,
      meta,
      _debug: {
        arm_found:       !!idMap,
        tmdb_from_arm:   !!(idMap?.themoviedbId),
        tmdb_from_tmdb:  !idMap?.themoviedbId && !!tmdbId,
        animelok_found:  !!animelok,
        animelok_sub_count: animelok?.sub?.embeds?.length ?? 0,
        animelok_dub_count: animelok?.dub?.embeds?.length ?? 0,
        toonstream_found: !!toonstream,
        toonstream_sources: toonstream?.sources?.length ?? 0,
      },
      ids: {
        anilist_id:     anilistId,
        mal_id:         malId,
        tmdb_id:        tmdbId,
        anidb_id:       anidbId,
        kitsu_id:       idMap?.kitsuId          ?? null,
        imdb_id:        idMap?.imdbId           ?? null,
        tvdb_id:        idMap?.thetvdbId        ?? null,
        livechart_id:   idMap?.livechartId      ?? null,
        animeplanet_id: idMap?.animePlanetId    ?? null,
        simkl_id:       idMap?.simklId          ?? null,
        anisearch_id:   idMap?.anisearchId      ?? null,
      },
      streaming: {
        episode:  epNum,
        season:   seasonNum,
        // Sub/Dub — animelok embeds (iframe these)
        sub: animelok?.sub ?? { best: null, embeds: [] },
        dub: animelok?.dub ?? { best: null, embeds: [] },
        // Hindi — toonstream direct HLS (play with HLS.js, ad-free)
        hindi: toonstream ? {
          available: true,
          sources:   toonstream.sources, // direct .m3u8 HLS URLs
          embeds:    toonstream.embeds,  // embed fallback URLs
          hash:      toonstream.hash,
          ep_slug:   toonstream.ep_slug,
        } : {
          available: false,
          note: 'Hindi dub not found on toonstream for this anime/episode',
          // Fallback to OllyEmbed Hindi servers
          olly_hindi: olly,
        },
        // OllyEmbed — iframe fallback for all servers
        olly: olly ?? null,
      },
      cached_at: new Date().toISOString(),
    };

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(response);

  } catch (err) {
    console.error('[MasterAPI]', err.message);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}
