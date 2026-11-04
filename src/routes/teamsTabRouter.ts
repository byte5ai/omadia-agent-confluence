/**
 * Teams-tab surface for the Confluence dashboards (byte5ai/omadia#1620).
 *
 *   <mountPath>/<path>          data-free shell, auth:'public'
 *   <mountPath>/_data/<path>    the dashboard page, auth:'teams-sso'
 *
 * A Teams tab loads its URL as a plain GET without a bearer and without an
 * omadia session cookie, so the page it loads is a shell that renders only a
 * title and a status line. Inside Teams it asks for an SSO token
 * (`authentication.getAuthToken()`), fetches the rendered page from the
 * teams-sso data mount and swaps it in with `document.write`: the page keeps
 * its own scripts, its `<meta refresh>` reloads the shell (and so fetches a
 * fresh token), and relative URLs resolve against the shell's location.
 *
 * The kernel serves both prefixes only while the operator grants the
 * `permissions.public_paths` entry `<mountPath>`. The data mount opens for a
 * verified Microsoft Teams SSO token of a tenant member and for nothing
 * else; an omadia session cookie does not open it.
 *
 * Mirrors the Builder codegen (`renderTeamsTabFile()` in omadia core's
 * `middleware/src/plugins/builder/codegenUiRoute.ts`), plus a fail-closed
 * guard on the data router for cores that predate `'teams-sso'`.
 */

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { html, htmlDoc, renderRoute, safe } from '@omadia/plugin-ui-helpers';

const TEAMS_JS_URL =
  'https://res.cdn.office.net/teams-js/2.34.0/js/MicrosoftTeams.min.js';
/** Subresource integrity of exactly that file — the script runs in the
 *  plugin's origin, so a swapped CDN file must not load. */
const TEAMS_JS_INTEGRITY =
  'sha384-brW9AazbKR2dYw2DucGgWCCcmrm2oBFV4HQidyuyZRI/TnAkmOOnTARSTdps3Hwt';

/** Shell mount below the plugin's `/p/<slug>` prefix. */
export const TEAMS_TAB_SEGMENT = '/teams';
/** Data mount below the shell mount. The `_` cannot collide with a page path. */
export const TEAMS_TAB_DATA_SEGMENT = '/_data';

export interface TeamsTabPage {
  /** Page path as served by the session router, e.g. `/most-read`. */
  readonly path: string;
  /** Title of the shell document (shown while the page loads). */
  readonly title: string;
}

export interface TeamsTabRouterOptions {
  /** Absolute mount of the shell router, e.g. `/p/agent-confluence/teams`. */
  readonly mountPath: string;
  readonly pages: readonly TeamsTabPage[];
  /** The router that renders the pages (the same one the session mount serves). */
  readonly dataRouter: Router;
}

function shellScript(dataUrl: string): string {
  return `
    (function () {
      var status = document.getElementById('omadia-status');
      var show = function (message) { if (status) status.textContent = message; };
      var sdk = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = ${JSON.stringify(TEAMS_JS_URL)};
        s.integrity = ${JSON.stringify(TEAMS_JS_INTEGRITY)};
        s.crossOrigin = 'anonymous';
        s.onload = function () { resolve(window.microsoftTeams); };
        s.onerror = function () { reject(new Error('Teams SDK failed to load.')); };
        document.head.appendChild(s);
      });
      var outsideTeams = new Promise(function (_resolve, reject) {
        setTimeout(function () {
          reject(new Error('Open this page inside Microsoft Teams.'));
        }, 8000);
      });
      Promise.race([
        sdk.then(function (t) { return t.app.initialize().then(function () { return t; }); }),
        outsideTeams,
      ]).then(function (t) {
        return t.authentication.getAuthToken().then(null, function (err) {
          throw new Error('Teams sign-in failed: ' + ((err && err.message) || err));
        });
      }).then(function (token) {
        return fetch(${JSON.stringify(dataUrl)} + window.location.search, {
          headers: { Authorization: 'Bearer ' + token },
          credentials: 'omit',
          cache: 'no-store',
        });
      }).then(function (res) {
        if (!res.ok) throw new Error('Not authorised (' + res.status + ').');
        return res.text();
      }).then(function (page) {
        document.open();
        document.write(page);
        document.close();
      }).catch(function (err) {
        show((err && err.message) || String(err));
      });
    })();
  `;
}

/**
 * Fail-closed guard: the kernel sets `req.teamsSsoUser` only after it has
 * verified the Teams SSO token. A core that does not know `'teams-sso'`
 * never sets it, so the data stays behind a 401 there instead of falling
 * back to whatever that core does with an unknown auth mode.
 */
export function requireTeamsSsoUser(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!(req as { teamsSsoUser?: unknown }).teamsSsoUser) {
    res.status(401).json({ code: 'auth.teams_sso_required' });
    return;
  }
  next();
}

export function createTeamsTabRouters(opts: TeamsTabRouterOptions): {
  shell: Router;
  data: Router;
} {
  const shell = Router();
  for (const page of opts.pages) {
    const dataUrl = opts.mountPath + TEAMS_TAB_DATA_SEGMENT + page.path;
    shell.get(
      page.path,
      renderRoute(() =>
        htmlDoc({
          title: page.title,
          body: html`
            <main class="max-w-3xl mx-auto p-6">
              <p id="omadia-status" class="text-sm text-slate-500">Loading…</p>
              <script>${safe(shellScript(dataUrl))}</script>
            </main>
          `,
        }),
      ),
    );
  }

  // ONE router for the data mount: the kernel dispatches a granted path to a
  // single live route entry. The guard runs first, then the same page router
  // the session mount serves — no duplicated rendering logic.
  const data = Router();
  data.use(requireTeamsSsoUser);
  data.use(opts.dataRouter);
  return { shell, data };
}
