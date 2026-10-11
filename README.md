# AnimeReza Master API

Single Vercel endpoint that calls AniList + TMDB + MegaPlay and returns everything in one JSON response.

## Deploy to Vercel

1. Upload this folder to GitHub
2. Import repo on vercel.com
3. Add environment variable: `TMDB_API_KEY` = your key
4. Deploy — done

## Endpoints

### GET /api/anime

**By slug:**
```
/api/anime?slug=naruto-20&ep=1&season=1
```

**By MAL ID:**
```
/api/anime?mal=20&ep=1&season=1
```

**By AniList ID:**
```
/api/anime?anilist=20&ep=1&season=1
```

## Response

```json
{
  "success": true,
  "meta": {
    "anilist_id": 20,
    "mal_id": 20,
    "title": "Naruto",
    "title_en": "Naruto",
    "title_ro": "Naruto",
    "title_native": "ナルト",
    "poster": "https://...",
    "banner": "https://...",
    "synopsis": "...",
    "score": "7.9",
    "type": "TV",
    "status": "Completed",
    "episodes": 220,
    "season": "FALL",
    "year": 2002,
    "genres": ["Action", "Adventure"],
    "studios": ["Pierrot"],
    "next_ep": null,
    "is_movie": false
  },
  "ids": {
    "anilist_id": 20,
    "mal_id": 20,
    "tmdb_id": 46260
  },
  "streaming": {
    "episode": 1,
    "season": 1,
    "megaplay": {
      "sub": "https://megaplay.buzz/embed/anime/20/1/1",
      "dub": "https://megaplay.buzz/embed/anime/20/1/1?dub=true"
    },
    "olly": {
      "hindi":   "https://ollyembed.pages.dev/tv/46260/1/1?server=Hindi",
      "hindiv2": "https://ollyembed.pages.dev/tv/46260/1/1?server=2",
      "hindiv3": "https://ollyembed.pages.dev/tv/46260/1/1?server=3",
      "hindiv4": "https://ollyembed.pages.dev/tv/46260/1/1?server=4"
    }
  },
  "cached_at": "2026-10-10T10:00:00.000Z"
}
```

## How AnimeReza calls it

```php
// One call replaces 4 separate API calls
$data = file_get_contents("https://your-api.vercel.app/api/anime?mal={$malId}&ep={$ep}&season={$season}");
$json = json_decode($data, true);

$title   = $json['meta']['title'];
$poster  = $json['meta']['poster'];
$megaSub = $json['streaming']['megaplay']['sub'];
$hindi   = $json['streaming']['olly']['hindi'];
```

## Vercel Cache

Responses are cached for 1 hour at Vercel edge (`s-maxage=3600`).
Stale responses served for up to 24h while revalidating (`stale-while-revalidate=86400`).
This means near-zero AniList/TMDB API calls after first request per anime per hour.
