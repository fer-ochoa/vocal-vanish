import * as https from "https";

// ---------------------------------------------------------------------------
// Kara moe playlist API client (main process only).
//
// Self-contained: does NOT import from src/index.ts (would create a cycle).
// Reuses the same https.get pattern and error conventions as httpGetJson.
// ---------------------------------------------------------------------------

// Strip trailing slashes so a misconfigured API_URL (e.g. "https://kara.moe/")
// does not produce double-slash paths like "https://kara.moe//api".
const _API_URL = (process.env.API_URL || "").replace(/\/+$/, "");
const API_BASE = _API_URL + "/api";

// ---------------------------------------------------------------------------
// Internal HTTP helper (mirrors httpGetJson in src/index.ts)
// ---------------------------------------------------------------------------

/**
 * Perform a GET request and parse the JSON response.
 *
 * IMPORTANT: This helper intentionally does NOT send an `Authorization`
 * header. The playlist routes are public; any invalid/stale Authorization
 * header turns them into 403.
 */
function httpGetJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "vocal-vanish/1.0" } },
      (res) => {
        if (
          !res.statusCode ||
          (res.statusCode >= 300 && res.statusCode < 400)
        ) {
          // Follow a single redirect
          const loc = res.headers.location;
          res.resume();
          if (loc) {
            httpGetJson<T>(new URL(loc, url).toString()).then(resolve, reject);
            return;
          }
        }
        if (!res.statusCode || res.statusCode >= 400) {
          const err = new Error(`HTTP ${res.statusCode} for ${url}`);
          res.resume();
          reject(err);
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch (e) {
            reject(
              new Error(`Invalid JSON from ${url}: ${(e as Error).message}`),
            );
          }
        });
      },
    );
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Allowed values for the `order` query parameter on `GET /api/playlist`.
 * An invalid value is a hard 400 INVALID_DATA from the server, so we validate
 * client-side before any network call.
 */
export type PlaylistOrder =
  | "az"
  | "recent"
  | "karacount"
  | "duration"
  | "username";

/**
 * The five valid playlist order values, in canonical order.
 */
export const PLAYLIST_ORDERS: readonly PlaylistOrder[] = [
  "az",
  "recent",
  "karacount",
  "duration",
  "username",
];

/**
 * Type guard: returns true when `v` is a valid {@link PlaylistOrder}.
 */
export function isPlaylistOrder(v: unknown): v is PlaylistOrder {
  return (
    typeof v === "string" &&
    (PLAYLIST_ORDERS as readonly string[]).includes(v)
  );
}

/**
 * A playlist as returned by `GET /api/playlist` (flat array element).
 */
export interface RemotePlaylist {
  plaid: string;
  name: string;
  description?: string | null;
  slug?: string | null;
  karacount?: number | null;
  duration?: number | null;
  created_at?: string | null;
  modified_at?: string | null;
  /** Owner username (may differ from the logged-in user for contributed playlists). */
  username?: string | null;
  nickname?: string | null;
  /** Whether the playlist is visible (public). */
  flag_visible?: boolean | null;
  /**
   * Whether the playlist is visible online. Entries with this explicitly
   * `false` are dropped client-side as a cheap defensive filter.
   */
  flag_visible_online?: boolean | null;
}

/**
 * Known "Off Vocal" version TID. Mirrored from src/index.ts (OFF_VOCAL_TID) —
 * duplicated here because importing from src/index.ts would create a cycle.
 */
const OFF_VOCAL_TID = "c0cc87b9-55b9-40f0-878a-fbb9e34c151e";
/**
 * Display codes for a song's languages, e.g. ["JPN"]. Mirrors
 * `languageCodes()` in src/index.ts (duplicated to avoid an import cycle).
 */
function languageCodes(row: {
  langs?: { short?: string; name?: string }[];
}): string[] {
  return (row.langs ?? [])
    .map((l) => (l.short || l.name || "").trim().toUpperCase())
    .filter(Boolean);
}
/** Collapse a tag name for comparison: "Off Vocal" -> "offvocal". */
function normalizeTagName(name?: string | null): string {
  return (name || "").toLowerCase().replace(/[\s_-]+/g, "");
}
/**
 * True when the song is an off-vocal (instrumental) version. Mirrors
 * `isOffVocal()` in src/index.ts (duplicated to avoid an import cycle).
 */
function isOffVocal(row: {
  versions?: { tid?: string; name?: string | null }[];
}): boolean {
  return (row.versions ?? []).some(
    (v) => v.tid === OFF_VOCAL_TID || normalizeTagName(v.name) === "offvocal",
  );
}
/**
 * A single song row within a playlist, mapped from the raw API content row.
 */
export interface RemotePlaylistItem {
  kid: string;
  /** 1-based remote order position. */
  pos: number;
  title: string;
  series: string;
  singer: string;
  duration: number | null;
  /** Language codes, e.g. ["JPN"] — from row.langs[].short (fallback .name, uppercased). */
  langs: string[];
  /** True when the row's `versions` tags include the Off Vocal version. */
  offVocal: boolean;
  /** JSON.stringify of the raw content row. */
  payload: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch the logged-in user's kara.moe playlists.
 *
 * Calls `GET {API_BASE}/playlist?filter=<filter>&order=<order>&byUsername=<username>&includeUserAsContributor=true`
 *
 * - All four params are always sent (empty filter is fine: `filter=`).
 * - `order` defaults to `"az"`.
 * - Validates `order` with {@link isPlaylistOrder} and throws before any
 *   network call (a bad order is a programmer error; the server answers
 *   400 INVALID_DATA).
 * - Throws if `username` is empty.
 * - The route returns a flat JSON array; a `{content: [...]}` envelope is
 *   tolerated defensively but the array is the real shape.
 * - Results are sorted client-side so the label matches the data:
 *   - "az" → name asc (localeCompare)
 *   - "recent" → created_at DESC (the server returns it ascending, so reverse)
 *   - "karacount" → karacount DESC
 *   - "duration" → duration DESC
 *   - "username" → username asc
 *
 * NOTE: No `Authorization` header is sent. These routes are public; any
 * invalid/stale Authorization header turns them into 403.
 */
export async function getMyPlaylists(
  username: string,
  opts?: { filter?: string; order?: PlaylistOrder },
): Promise<RemotePlaylist[]> {
  if (!username) {
    throw new Error("username must not be empty");
  }
  const order: PlaylistOrder = opts?.order ?? "az";
  if (!isPlaylistOrder(order)) {
    throw new Error(`Unknown playlist order '${order}'`);
  }
  const filter = opts?.filter ?? "";

  const url = new URL(`${API_BASE}/playlist`);
  url.searchParams.set("filter", filter);
  url.searchParams.set("order", order);
  url.searchParams.set("byUsername", username);
  url.searchParams.set("includeUserAsContributor", "true");

  const data = await httpGetJson<unknown>(url.toString());

  // The route returns a flat JSON array. Defensively tolerate a
  // {content: [...]} envelope, but the array is the real shape.
  let playlists: RemotePlaylist[];
  if (Array.isArray(data)) {
    playlists = data as RemotePlaylist[];
  } else if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as { content?: unknown[] }).content)
  ) {
    playlists = (data as { content: RemotePlaylist[] }).content;
  } else {
    playlists = [];
  }

  // Client-side sort so the label matches the data.
  // The server's `order=recent` returns created_at ASCENDING (a quirk
  // observed in a live probe), so we reverse to get "most recent first".
  switch (order) {
    case "az":
      playlists.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      break;
    case "recent":
      // Server returns created_at ascending; reverse for "most recent first".
      playlists.sort((a, b) => {
        const ca = a.created_at || "";
        const cb = b.created_at || "";
        return cb.localeCompare(ca);
      });
      break;
    case "karacount":
      playlists.sort((a, b) => (b.karacount ?? 0) - (a.karacount ?? 0));
      break;
    case "duration":
      playlists.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
      break;
    case "username":
      playlists.sort((a, b) =>
        (a.username || "").localeCompare(b.username || ""),
      );
      break;
  }

  return playlists;
}
// ---------------------------------------------------------------------------
// Public user playlists (feat 08: browse & subscribe to another user)
// ---------------------------------------------------------------------------
/**
 * Session cache for {@link getUserPlaylists}, keyed by
 * `${username.toLowerCase()}|${filter}|${order}|${includeContributions}`.
 * Only successful results are stored; a throw never caches.
 */
const userPlaylistsCache = new Map<string, RemotePlaylist[]>();
/**
 * Clear the in-memory {@link getUserPlaylists} cache.
 */
export function clearUserPlaylistsCache(): void {
  userPlaylistsCache.clear();
}
/**
 * Fetch another user's public kara.moe playlists.
 *
 * Calls `GET {API_BASE}/playlist?filter=<filter>&order=<order>&byUsername=<username>`
 * with `includeUserAsContributor=true` added ONLY when
 * `opts.includeContributions !== false` (the param is presence-only:
 * `=false` does NOT exclude contributions, only omitting it does).
 *
 * - `order` defaults to `"az"`; validated with {@link isPlaylistOrder} and
 *   thrown before any network call (a bad order is a programmer error; the
 *   server answers 400 INVALID_DATA).
 * - Throws if `username` is empty/whitespace.
 * - The route returns a flat JSON array; a `{content: [...]}` envelope is
 *   tolerated defensively but the array is the real shape.
 * - Entries with `flag_visible_online === false` are dropped defensively
 *   (missing/true are kept).
 * - Results are sorted client-side so the label matches the data:
 *   - "az" → name asc (localeCompare)
 *   - "recent" → created_at DESC (the server returns it ascending, so reverse)
 *   - "karacount" → karacount DESC
 *   - "duration" → duration DESC
 *   - "username" → username asc
 * - Results are cached in memory for the session, keyed by
 *   username (lowercased) + filter + order + includeContributions. A cached
 *   array is returned when present and `opts.refresh` is not true; otherwise
 *   the route is fetched and the result stored.
 *
 * NOTE: No `Authorization` header is sent. These routes are public; any
 * invalid/stale Authorization header turns them into 403.
 */
export async function getUserPlaylists(
  username: string,
  opts?: {
    filter?: string;
    order?: PlaylistOrder;
    includeContributions?: boolean;
    refresh?: boolean;
  },
): Promise<RemotePlaylist[]> {
  if (!username || username.trim() === "") {
    throw new Error("username must not be empty");
  }
  const order: PlaylistOrder = opts?.order ?? "az";
  if (!isPlaylistOrder(order)) {
    throw new Error(`Unknown playlist order '${order}'`);
  }
  const filter = opts?.filter ?? "";
  const includeContributions = opts?.includeContributions !== false;
  const cacheKey = `${username.toLowerCase()}|${filter}|${order}|${includeContributions}`;
  if (!opts?.refresh) {
    const cached = userPlaylistsCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }
  const url = new URL(`${API_BASE}/playlist`);
  url.searchParams.set("filter", filter);
  url.searchParams.set("order", order);
  url.searchParams.set("byUsername", username);
  // Presence-only flag: `=false` does NOT exclude contributions, only
  // omitting the param does — so set it only when contributions are wanted.
  if (includeContributions) {
    url.searchParams.set("includeUserAsContributor", "true");
  }
  const data = await httpGetJson<unknown>(url.toString());
  // The route returns a flat JSON array. Defensively tolerate a
  // {content: [...]} envelope, but the array is the real shape.
  let playlists: RemotePlaylist[];
  if (Array.isArray(data)) {
    playlists = data as RemotePlaylist[];
  } else if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as { content?: unknown[] }).content)
  ) {
    playlists = (data as { content: RemotePlaylist[] }).content;
  } else {
    playlists = [];
  }
  // Defensive filter: drop entries explicitly hidden online.
  playlists = playlists.filter((p) => p.flag_visible_online !== false);
  // Client-side sort so the label matches the data.
  // The server's `order=recent` returns created_at ASCENDING (a quirk
  // observed in a live probe), so we reverse to get "most recent first".
  switch (order) {
    case "az":
      playlists.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      break;
    case "recent":
      // Server returns created_at ascending; reverse for "most recent first".
      playlists.sort((a, b) => {
        const ca = a.created_at || "";
        const cb = b.created_at || "";
        return cb.localeCompare(ca);
      });
      break;
    case "karacount":
      playlists.sort((a, b) => (b.karacount ?? 0) - (a.karacount ?? 0));
      break;
    case "duration":
      playlists.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
      break;
    case "username":
      playlists.sort((a, b) =>
        (a.username || "").localeCompare(b.username || ""),
      );
      break;
  }
  // Cache only successful results (a throw never reaches this line).
  userPlaylistsCache.set(cacheKey, playlists);
  return playlists;
}

/**
 * Fetch all songs in a playlist, paginating through `GET /api/playlist/{plaid}`.
 *
 * Loops with `from=<n>&size=100` until `infos.to >= infos.count`.
 * Guards against infinite loops: stops if a page returns 0 rows or after
 * 200 pages.
 *
 * Each content row is mapped to a {@link RemotePlaylistItem}:
 * - kid
 * - pos (fall back to running index+1 when pos is missing)
 * - title (titles_default_language → titles[that] → first value of titles → songname → "Untitled")
 * - series (series[].name joined with ", ")
 * - singer (singers[].name joined with ", ")
 * - duration (number | null)
 * - langs (language codes, e.g. ["JPN"] — from row.langs[].short,
 *   falling back to .name, uppercased)
 * - offVocal (true when row.versions tags include the Off Vocal version)
 * - payload (JSON.stringify of the raw row)
 *
 * Rows without a kid are skipped. Deduplicated by kid, keeping the first
 * occurrence (the table's PK is (collection_id, kid)).
 *
 * NOTE: No `Authorization` header is sent. These routes are public; any
 * invalid/stale Authorization header turns them into 403.
 */
export async function getPlaylistContents(
  plaid: string,
): Promise<RemotePlaylistItem[]> {
  if (!plaid) {
    throw new Error("plaid must not be empty");
  }

  const PAGE_SIZE = 100;
  const MAX_PAGES = 200;
  const items: RemotePlaylistItem[] = [];
  const seenKids = new Set<string>();
  let from = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${API_BASE}/playlist/${encodeURIComponent(plaid)}`);
    url.searchParams.set("from", String(from));
    url.searchParams.set("size", String(PAGE_SIZE));

    const data = await httpGetJson<{
      infos?: { count?: number; from?: number; to?: number };
      content?: unknown[];
    }>(url.toString());

    const count = data.infos?.count ?? 0;
    const to = data.infos?.to ?? 0;
    const rows: any[] = data.content ?? [];

    if (rows.length === 0) {
      // Guard: a page with 0 rows means we've exhausted the data.
      break;
    }

    for (const row of rows) {
      const kid: string | undefined = row?.kid;
      if (!kid) continue; // skip rows without a kid
      if (seenKids.has(kid)) continue; // dedup by kid, keep first
      seenKids.add(kid);

      // Title resolution chain
      const titles: Record<string, string> = row.titles ?? {};
      const defaultLang: string | undefined = row.titles_default_language;
      const title: string =
        (defaultLang && titles[defaultLang]) ||
        Object.values(titles)[0] ||
        row.songname ||
        "Untitled";

      const series: string =
        (row.series as { name?: string }[] | undefined)
          ?.map((s) => s.name)
          .filter(Boolean)
          .join(", ") || "";

      const singer: string =
        (row.singers as { name?: string }[] | undefined)
          ?.map((s) => s.name)
          .filter(Boolean)
          .join(", ") || "";

      const duration: number | null =
        typeof row.duration === "number" && Number.isFinite(row.duration)
          ? row.duration
          : null;

      // pos: 1-based; fall back to running index+1
      const pos: number =
        typeof row.pos === "number" && Number.isFinite(row.pos)
          ? row.pos
          : items.length + 1;

      items.push({
        kid,
        pos,
        title,
        series,
        singer,
        duration,
        langs: languageCodes(row),
        offVocal: isOffVocal(row),
        payload: JSON.stringify(row),
      });
    }

    // Stop when we've fetched everything.
    if (to >= count) break;

    // Advance the cursor.
    from = to;
  }

  return items;
}

/**
 * Return the number of songs in a playlist, or null when unknown.
 * Coerces `p.karacount` to a finite number; returns null if absent or
 * non-finite.
 */
export function playlistItemCount(p: RemotePlaylist): number | null {
  const n = p.karacount;
  if (typeof n === "number" && Number.isFinite(n)) {
    return n;
  }
  return null;
}
