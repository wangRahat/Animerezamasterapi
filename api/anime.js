// AnimeReza Master API v3.0 — api/anime.js
// Calls all sources directly — no CoorenLabs needed
//
// GET /api/anime?anilist=20&ep=1&season=1
// GET /api/anime?mal=20&ep=1&season=1
// GET /api/anime?slug=naruto-20&ep=1&season=1

const TMDB_KEY    = 'c24da0be248457021c4505f96ccc93c4';
const TMDB_BASE   = 'https://api.themoviedb.org/3';
const ANILIST_GQL = 'https://graphql.anilist.co';
const OLLY        = 'https://ollyembed.pages.dev';
const ANIMELOK    = 'https://animelok.cc';
const TOONSTREAM  = 'https://toonstream.us';

const CHROME_HEADERS = {
  'User-Agent':         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Accept-Language':    'en-US,en;q=0.6',
  'sec-ch-ua':          '"Chromium";v="148", "Google Chrome";v="148", "Not:A-Brand";v="99"',
  'sec-ch-ua-mobile':   '?0',
  'sec-ch-ua-platform': '"Windows"',
};

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} → ${url}`);
  return res.json();
}
async function fetchText(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  return res.text();
}
async function safe(fn) {
  try { return await fn(); } catch { return null; }
}

// AniList
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
    averageScore genres
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

// ARM ID mapping
async function fetchArm(anilistId) {
  const arm = await safe(() => fetchJson(
    `https://arm.haglund.dev/api/v2/ids?source=anilist&id=${anilistId}`
  ));
  if (!arm) return null;
  return {
    malId:         arm.myanimelist     ?? null,
    anidbId:       arm.anidb           ?? null,
    themoviedbId:  arm.themoviedb      ?? null,
    thetvdbId:     arm.thetvdb         ?? null,
    kitsuId:       arm.kitsu           ?? null,
    imdbId:        arm.imdb            ?? null,
    livechartId:   arm.livechart       ?? null,
    animePlanetId: arm['anime-planet'] ?? null,
  };
}

// ani.zip fallback
async function fetchAnizip(anilistId) {
  const data = await safe(() => fetchJson(
    `https://api.ani.zip/mappings?anilist_id=${anilistId}`
  ));
  if (!data?.mappings) return null;
  const m = data.mappings;
  return {
    malId:         m.mal_id         ?? null,
    anidbId:       m.anidb_id       ?? null,
    themoviedbId:  m.themoviedb_id  ?? null,
    thetvdbId:     m.thetvdb_id     ?? null,
    kitsuId:       m.kitsu_id       ?? null,
    imdbId:        m.imdb_id        ?? null,
    livechartId:   m.livechart_id   ?? null,
    animePlanetId: m.animeplanet_id ?? null,
  };
}

// TMDB search fallback
async function fetchTmdbId(title, year, isMovie) {
  if (!title) return null;
  const type    = isMovie ? 'movie' : 'tv';
  const yearKey = isMovie ? 'primary_release_year' : 'first_air_date_year';
  const search  = async (withYear) => {
    const url = `${TMDB_BASE}/search/${type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}${withYear && year ? `&${yearKey}=${year}` : ''}&language=en-US`;
    const d = await safe(() => fetchJson(url));
    return d?.results?.[0]?.id ?? null;
  };
  return (await search(true)) ?? (await search(false));
}

// Animelok — direct API call
const VIDEO_HASH = /\/video\/([a-f0-9]+)$/i;
const SHORT_ICU  = 'https://short.icu/';

function toEmbed(server, track) {
  let url = server.url?.startsWith(SHORT_ICU)
    ? `https://player.abyssplayer.com/${server.url.slice(SHORT_ICU.length)}`
    : server.url;
  if (!url) return null;
  if (server.source === 'reanime' && track === 'dub')
    url += url.includes('?') ? '&a=1' : '?a=1';
  const name = server.server === 'default'    ? 'multi'
    : server.server === 'multi-lang'          ? (server.language || 'multi')
    : (server.server || 'Unknown');
  return { url, server: name };
}

function buildTrack(servers, track) {
  const embeds = servers
    .filter(s => !!s.url)
    .map(s => toEmbed(s, track))
    .filter(Boolean);
  return {
    hash:   embeds.map(e => e.url.match(VIDEO_HASH)?.[1]).find(Boolean) ?? null,
    embeds,
    best:   embeds[0]?.url ?? null,
  };
}

async function fetchAnimelok(anilistId, ep) {
  const text = await safe(() => fetchText(
    `${ANIMELOK}/api/anilist/${anilistId}/${ep}`,
    { headers: { ...CHROME_HEADERS, Referer: ANIMELOK + '/' } }
  ));
  if (!text) return null;
  try {
    const { servers } = JSON.parse(text);
    const list = Array.isArray(servers) ? servers : [];
    if (!list.length) return null;
    const subServers = list.filter(s => s.type === 'sub' || !['sub','dub'].includes(s.type));
    const dubServers = list.filter(s => s.type === 'dub');
    return {
      sub: buildTrack(subServers, 'sub'),
      dub: buildTrack(dubServers, 'dub'),
    };
  } catch { return null; }
}

// Toonstream — direct scrape
async function toonstreamSearch(query) {
  const html = await safe(() => fetchText(
    `${TOONSTREAM}/s?q=${encodeURIComponent(query)}&page=1`,
    { headers: { 'User-Agent': CHROME_HEADERS['User-Agent'], Referer: TOONSTREAM + '/' } }
  ));
  if (!html) return null;
  const slugs  = [...html.matchAll(/href="\/series\/([^"\/]+)\/?"/g)].map(m => m[1]);
  const titles = [...html.matchAll(/class="entry-title"[^>]*>\s*([^<]+)/g)].map(m => m[1].trim());
  if (!slugs.length) return null;
  return slugs.map((slug, i) => ({ slug, title: titles[i] ?? slug }));
}

async function fetchRubystm(embedUrl, referer) {
  try {
    const { origin, pathname } = new URL(embedUrl);
    const code = pathname.split('/').filter(Boolean).pop()?.replace(/^embed-|\.html$/g, '');
    if (!code) return null;
    const res  = await fetch(`${origin}/dl`, {
      method: 'POST',
      body:   new URLSearchParams({ op: 'embed', file_code: code, auto: '1', referer }),
      headers: { Referer: embedUrl },
      signal: AbortSignal.timeout(8000),
    });
    const html = await res.text();
    // Unpack p,a,c,k,e,d
    const pm = html.match(/}\('(.+)',(\d+),\d+,'(.*?)'\.split\('\|'\)/s);
    if (!pm) return null;
    const [, payload, radixStr, words] = pm;
    const base = Number(radixStr);
    const dict = words.split('|');
    const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const unpacked = payload.replace(/\b\w+\b/g, word => {
      let idx = 0;
      for (const ch of word) { const d = DIGITS.indexOf(ch); if (d < 0 || d >= base) return word; idx = idx * base + d; }
      return dict[idx] || word;
    });
    const m3u8 = unpacked.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)['"]/)?.[1];
    return m3u8 ? { label: 'Ruby', type: 'hls', url: m3u8 } : null;
  } catch { return null; }
}

async function fetchToonstreamHindi(title, season, ep) {
  if (!title) return null;
  const results = await toonstreamSearch(title);
  if (!results?.length) return null;
  const match = results[0];
  if (!match?.slug) return null;

  const epSlug = `${match.slug}-${season}x${ep}`;
  const html   = await safe(() => fetchText(
    `${TOONSTREAM}/episode/${epSlug}/`,
    { headers: { 'User-Agent': CHROME_HEADERS['User-Agent'], Referer: `${TOONSTREAM}/series/${match.slug}/` } }
  ));
  if (!html) return null;

  const embeds = [...html.matchAll(/(?:data-src|src)="(https?:\/\/(?!toonstream)[^"]+)"/g)]
    .map(m => m[1])
    .filter(u => /rubystm|rubystream|turbovid|as-cdn/i.test(u));

  if (!embeds.length) return null;

  // Try to extract direct HLS from first rubystm embed
  const directSources = [];
  for (const embed of embeds.slice(0, 2)) {
    if (/rubystm|rubystream/i.test(embed)) {
      const src = await fetchRubystm(embed, `${TOONSTREAM}/`);
      if (src) directSources.push(src);
    }
  }

  return {
    available: true,
    slug:      match.slug,
    ep_slug:   epSlug,
    sources:   directSources,  // direct .m3u8 HLS — ad-free
    embeds,                    // raw embed URLs as fallback
  };
}

// OllyEmbed
function buildOlly(tmdbId, ep, season, isMovie) {
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

// Normalise AniList
function normalise(m) {
  const S = { FINISHED:'Completed', RELEASING:'Airing', NOT_YET_RELEASED:'Upcoming', CANCELLED:'Cancelled', HIATUS:'Hiatus' };
  const F = { TV:'TV', TV_SHORT:'TV Short', MOVIE:'Movie', SPECIAL:'Special', OVA:'OVA', ONA:'ONA', MUSIC:'Music' };
  return {
    title:        m.title.english  || m.title.romaji,
    title_en:     m.title.english  || '',
    title_ro:     m.title.romaji   || '',
    title_native: m.title.native   || '',
    poster:       m.coverImage?.extraLarge || m.coverImage?.large || '',
    banner:       m.bannerImage || '',
    synopsis:     (m.description || '').replace(/<[^>]+>/g, '').trim(),
    score:        m.averageScore ? (m.averageScore / 10).toFixed(1) : null,
    type:         F[m.format]  || m.format  || '',
    status:       S[m.status]  || m.status  || '',
    episodes:     m.episodes   || null,
    duration:     m.duration   || null,
    season:       m.season     || null,
    year:         m.seasonYear || null,
    genres:       m.genres     || [],
    studios:      m.studios?.nodes?.map(s => s.name) || [],
    next_ep:      m.nextAiringEpisode
      ? { episode: m.nextAiringEpisode.episode, airing_at: m.nextAiringEpisode.airingAt }
      : null,
    synonyms:     m.synonyms || [],
    is_movie:     m.format === 'MOVIE',
  };
}

// Main handler
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
    const vars = {};
    if (anilist)  vars.id     = parseInt(anilist);
    else if (mal) vars.malId  = parseInt(mal);
    else          vars.search = slug.replace(/-\d+$/, '');

    const aniMedia  = await fetchAnilist(vars);
    if (!aniMedia) return res.status(404).json({ error: 'Anime not found on AniList' });

    const meta      = normalise(aniMedia);
    const anilistId = aniMedia.id;

    // All parallel
    const [arm, anizip, animelok, toonstream] = await Promise.all([
      fetchArm(anilistId),
      fetchAnizip(anilistId),
      fetchAnimelok(anilistId, epNum),
      fetchToonstreamHindi(meta.title_en || meta.title_ro, seasonNum, epNum),
    ]);

    // Merge ID maps
    const idMap = arm
      ? { ...anizip, ...Object.fromEntries(Object.entries(arm).filter(([,v]) => v != null)) }
      : anizip;

    const malId   = idMap?.malId        ?? aniMedia.idMal ?? null;
    const anidbId = idMap?.anidbId      ?? null;
    let   tmdbId  = idMap?.themoviedbId ?? null;
    if (!tmdbId) tmdbId = await fetchTmdbId(meta.title_en || meta.title_ro, meta.year, meta.is_movie);

    const olly = buildOlly(tmdbId, epNum, seasonNum, meta.is_movie);

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      success: true,
      meta,
      _debug: {
        arm_found:          !!arm,
        anizip_found:       !!anizip,
        tmdb_from_arm:      !!(arm?.themoviedbId),
        tmdb_from_anizip:   !arm?.themoviedbId && !!(anizip?.themoviedbId),
        tmdb_from_search:   !idMap?.themoviedbId && !!tmdbId,
        animelok_found:     !!animelok,
        animelok_sub_count: animelok?.sub?.embeds?.length ?? 0,
        animelok_dub_count: animelok?.dub?.embeds?.length ?? 0,
        toonstream_found:   !!toonstream,
        toonstream_sources: toonstream?.sources?.length ?? 0,
      },
      ids: {
        anilist_id:     anilistId,
        mal_id:         malId,
        tmdb_id:        tmdbId,
        anidb_id:       anidbId,
        kitsu_id:       idMap?.kitsuId       ?? null,
        imdb_id:        idMap?.imdbId        ?? null,
        tvdb_id:        idMap?.thetvdbId     ?? null,
        livechart_id:   idMap?.livechartId   ?? null,
        animeplanet_id: idMap?.animePlanetId ?? null,
      },
      streaming: {
        episode: epNum,
        season:  seasonNum,
        sub:  animelok?.sub ?? { best: null, embeds: [], hash: null },
        dub:  animelok?.dub ?? { best: null, embeds: [], hash: null },
        hindi: toonstream ?? {
          available:  false,
          note:       'Hindi not found on toonstream — use OllyEmbed servers below',
          olly_hindi: olly,
        },
        olly: olly ?? null,
      },
      cached_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[MasterAPI]', err.message);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}
