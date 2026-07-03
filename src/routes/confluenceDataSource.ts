/**
 * Confluence dashboard data source — reads via the shared `confluence.client`
 * service (published by @omadia/integration-confluence). Two views:
 *
 *   - fetchMostFavorited: CQL `ORDER BY favourite DESC` as proxy for
 *     "most read". Atlassian's public CQL has no view-count sort field;
 *     favourites are the closest documented signal. The UI labels the
 *     metric honestly so operators don't read it as page-view analytics.
 *
 *   - fetchOldestPages: CQL `ORDER BY created ASC` — pages that haven't
 *     been touched since they were authored. Useful for content-audit
 *     workflows.
 *
 * The shared client is space-scoped via `confluence_space_key` config; we
 * inject that scope into every CQL query rather than relying on a global
 * default.
 */

export interface ConfluencePageSummary {
  readonly id: string;
  readonly title: string;
  /** Absolute URL into the Confluence Cloud UI. */
  readonly url: string;
  /** ISO timestamp (or empty string when upstream omits it). */
  readonly lastModified: string;
  /** ISO timestamp the page was created (or empty string). */
  readonly createdDate: string;
  /** Display name of the page's original author (or empty string). */
  readonly author: string;
}

/**
 * Minimal contract matching the `search(cql, limit)` method on
 * ConfluenceClient. Declared locally to avoid a hard TS dependency on
 * @omadia/integration-confluence — the runtime dependency is enforced via
 * manifest `depends_on`.
 */
export interface ConfluenceSearchClient {
  search(cql: string, limit: number, expand?: string): Promise<unknown>;
  /**
   * Page-Detail-Endpoint. Existiert seit integration-confluence v0.1.0 und
   * wird hier für den `history.createdDate` + `history.createdBy`-Backfill
   * genutzt — siehe `backfillHistory`. Bewusst per-Page statt search-expand,
   * weil `search(..., expand)` erst ab integration-confluence v0.2.0 forwarded
   * wird; per-Page-Calls funktionieren auch gegen v0.1.0.
   */
  getPage(id: string, expand?: string): Promise<unknown>;
  readonly spaceKey: string;
}

/**
 * Optionaler Hint an die Search-API. Ab integration-confluence v0.2.0
 * forwarded; ältere Versionen ignorieren das Argument lautlos. In dem Fall
 * springt `backfillHistory` ein.
 */
const SEARCH_EXPAND = 'content.history,content.history.createdBy';

/**
 * Wieviele parallele `getPage`-Calls maximal laufen. Atlassian Cloud
 * rate-limit-freundlich (~5000 req/h pro Token), 5 ist sehr defensiv.
 */
const HISTORY_BACKFILL_CONCURRENCY = 5;

interface ConfluenceSearchEnvelope {
  readonly results?: ReadonlyArray<ConfluenceSearchHit>;
  readonly _links?: { readonly base?: string };
}

interface ConfluenceHistory {
  readonly createdDate?: string;
  readonly createdBy?: { readonly displayName?: string };
}

interface ConfluenceSearchHit {
  readonly content?: {
    readonly id?: string;
    readonly title?: string;
    readonly history?: ConfluenceHistory;
    readonly _links?: { readonly webui?: string; readonly tinyui?: string };
  };
  readonly title?: string;
  readonly url?: string;
  readonly lastModified?: string;
  readonly friendlyLastModified?: string;
}

interface ConfluencePageDetail {
  readonly history?: ConfluenceHistory;
}

const DEFAULT_LIMIT = 25;

export async function fetchMostFavorited(
  client: ConfluenceSearchClient,
  limit: number = DEFAULT_LIMIT,
): Promise<readonly ConfluencePageSummary[]> {
  const cql = buildPageCql(client.spaceKey, 'favourite DESC');
  const initial = mapSearchResults(await client.search(cql, limit, SEARCH_EXPAND));
  return backfillHistory(client, initial);
}

export async function fetchOldestPages(
  client: ConfluenceSearchClient,
  limit: number = DEFAULT_LIMIT,
): Promise<readonly ConfluencePageSummary[]> {
  const cql = buildPageCql(client.spaceKey, 'created ASC');
  const initial = mapSearchResults(await client.search(cql, limit, SEARCH_EXPAND));
  return backfillHistory(client, initial);
}

function buildPageCql(spaceKey: string, order: string): string {
  // Confluence Cloud sanitises CQL — quote the space key to be safe.
  return `space = "${escapeCqlString(spaceKey)}" AND type = "page" ORDER BY ${order}`;
}

function escapeCqlString(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function mapSearchResults(raw: unknown): readonly ConfluencePageSummary[] {
  if (!isSearchEnvelope(raw)) return [];
  const baseUrl = typeof raw._links?.base === 'string' ? raw._links.base : '';
  const hits = Array.isArray(raw.results) ? raw.results : [];
  const mapped: ConfluencePageSummary[] = [];
  for (const hit of hits) {
    const content = hit.content ?? {};
    const id = typeof content.id === 'string' ? content.id : '';
    if (id.length === 0) continue;
    const title = typeof content.title === 'string'
      ? content.title
      : typeof hit.title === 'string'
        ? hit.title
        : id;
    const webui = content._links?.webui;
    const url = typeof webui === 'string' && webui.length > 0
      ? joinUrl(baseUrl, webui)
      : typeof hit.url === 'string'
        ? joinUrl(baseUrl, hit.url)
        : '';
    const lastModified = typeof hit.lastModified === 'string'
      ? hit.lastModified
      : '';
    const createdDate = typeof content.history?.createdDate === 'string'
      ? content.history.createdDate
      : '';
    const author = typeof content.history?.createdBy?.displayName === 'string'
      ? content.history.createdBy.displayName
      : '';
    mapped.push({ id, title, url, lastModified, createdDate, author });
  }
  return mapped;
}

/**
 * Fills in `createdDate` + `author` for any summary where the search
 * response didn't include them (typically when running against the older
 * integration-confluence v0.1.0, which doesn't forward the search-expand
 * argument). Issues parallel `getPage(id, 'history')` calls bounded by
 * HISTORY_BACKFILL_CONCURRENCY. Per-page failures are swallowed so a
 * single 404 doesn't take the whole tab down.
 */
async function backfillHistory(
  client: ConfluenceSearchClient,
  summaries: readonly ConfluencePageSummary[],
): Promise<readonly ConfluencePageSummary[]> {
  const out: ConfluencePageSummary[] = summaries.map((s) => ({ ...s }));
  const indices: number[] = [];
  out.forEach((s, i) => {
    if (s.createdDate.length === 0 || s.author.length === 0) indices.push(i);
  });
  if (indices.length === 0) return out;

  for (let i = 0; i < indices.length; i += HISTORY_BACKFILL_CONCURRENCY) {
    const batch = indices.slice(i, i + HISTORY_BACKFILL_CONCURRENCY);
    await Promise.all(
      batch.map(async (idx) => {
        const summary = out[idx];
        if (!summary) return;
        try {
          const detail = (await client.getPage(summary.id, 'history')) as
            | ConfluencePageDetail
            | null;
          const history = detail?.history;
          if (!history) return;
          out[idx] = {
            ...summary,
            createdDate:
              summary.createdDate.length > 0
                ? summary.createdDate
                : typeof history.createdDate === 'string'
                  ? history.createdDate
                  : '',
            author:
              summary.author.length > 0
                ? summary.author
                : typeof history.createdBy?.displayName === 'string'
                  ? history.createdBy.displayName
                  : '',
          };
        } catch {
          // Leave fields empty — partial data is better than a crashed tab.
        }
      }),
    );
  }
  return out;
}

function isSearchEnvelope(value: unknown): value is ConfluenceSearchEnvelope {
  return typeof value === 'object' && value !== null;
}

function joinUrl(base: string, relative: string): string {
  if (relative.length === 0) return '';
  if (/^https?:\/\//i.test(relative)) return relative;
  if (base.length === 0) return relative;
  if (relative.startsWith('/')) return `${base.replace(/\/+$/, '')}${relative}`;
  return `${base.replace(/\/+$/, '')}/${relative}`;
}

/* ---------- Display helpers shared by the route templates ----------- */

export function formatGermanDate(iso: string): string {
  if (iso.length < 10) return iso;
  const datePart = iso.slice(0, 10);
  const [y, m, d] = datePart.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

export function ageInYears(iso: string, now: Date = new Date()): number | null {
  if (iso.length < 10) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  const diffMs = now.getTime() - ts;
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (365.25 * 24 * 3600 * 1000));
}
