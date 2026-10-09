# Web Instagram Music Note

Instagram only ships music notes in its mobile app. WIMN brings them to the website. Choose your music from the music sheet (shelf + search), and publishing through the native Share button, just as you would in the mobile app.

## Install

1. Install [Violentmonkey](https://violentmonkey.github.io/) (recommended) or [Tampermonkey](https://www.tampermonkey.net/).
2. Install the script: **[wimn.user.js](https://raw.githubusercontent.com/HongyiHank/WIMN/main/wimn.user.js)**.
3. **Grant cookie access — both switches.** `sessionid` is an HttpOnly cookie, so nothing on the page can read it and music search answers `login_required` without it:
   - **Per script** — Violentmonkey: script ▸ *Settings* ▸ **Allow GM_cookie to access HTTP-only cookies**. Tampermonkey: the cookie-access consent in the script's settings.
   - **Globally** — Violentmonkey: dashboard ▸ *Settings* ▸ *Advanced* ▸ **Allow GM_cookie to access HTTP-only cookies**.
4. Open [instagram.com/direct/inbox](https://www.instagram.com/direct/inbox). The 🎵 button appears next to 😊 in the Notes composer. First run: open the sheet's ⚙ gear → **Refresh app version now**, so the Android User-Agent is fetched from instagrapi's `config.py`.

The diagnostics panel names whichever switch is off, so a refused cookie never fails silently.

## How it works

| Step | What happens |
| --- | --- |
| Mount | IG's class names are obfuscated, so the emoji button is found by its icon path / aria-label and the composer by the pair "emoji + 分享" — a DM composer publishes with 傳送/Send and is skipped on purpose. The music button is built from the live emoji control's own class lists, so its styling follows IG. |
| Identity | `Authorization: Bearer IGT:2:<base64 {ds_user_id, sessionid, …}>` — the same payload instagrapi's `login_by_sessionid()` builds, assembled from the HttpOnly cookie via `GM_cookie`. No authority the cookie lacks. |
| Transport | `www.instagram.com` for saved music and the note mutations (plain `fetch`, same origin). `i.instagram.com` for shelf and search via `GM_xmlhttpRequest` — the only API a script has that can set the `User-Agent` header a page fetch cannot. |
| Publish | The native Share click is intercepted in the capture phase: `CreateInboxTrayItemRequest` with `note_style: 1` and `music_note_create_info{audio_asset_id, audio_cluster_id, start_time, duration: 30000, …}`, retried on the mobile host when www's schema refuses the music fields. |
| Search | One request per keystroke: `POST music/search_v2` with `product=music_in_feed`, then `GET search_v2`, `POST audio_global_search`, `GET keyword_search`. |
| UA sync | instagrapi's `config.py` from three mirrors, highest version wins, re-checked on every ask (12h) and on demand from the panel — an outdated app version is rejected outright by IG. |

Two measured rules that look like quirks: `X-CSRFToken` is never sent to `i.instagram.com` (the CORS preflight refuses it) and `__a=1` is never sent (it selects a legacy handler that answers HTTP 200 with an empty body).

## Layout

| Path | Role |
| --- | --- |
| `src/content.js` | The whole feature: anchors, API calls, UI, publish interception |
| `src/bridge.js` | The GM bridge: HttpOnly `sessionid`, the Android `User-Agent`, `GM_xmlhttpRequest` fetch |
| `src/config.js` | instagrapi `config.py` parser + mirror selection (the source of the User-Agent) |
| `build.mjs` | Concatenates the three sources into `wimn.user.js` — the only artifact |
| `test/test.mjs` | `npm test` — 105 assertions, no dependencies: payloads, parsers (`test/fixtures/config.py` samples), composer anchors, bridge, language, preview player |
| `verify/dom-check.cjs` | Optional browser pass (Playwright + Chromium, not a dependency) — see its header |

`wimn.user.js` is generated. Edit the sources, then `npm run build`; `npm test` fails if the checked-in artifact is stale.

## Debugging

The ⚙ gear in the sheet header opens the settings panel: the language choice (follow system / 繁體中文 / English), saved in the manager's own store, above the read-only diagnostics (it also appears bottom-right when the button cannot be mounted). From your manager's script console — the page console runs in another world and cannot see `WIMN`:

```js
await WIMN.diagnose() // read-only probes: auth, shelf, search, mirrors, anchors
```

`mount` says why the button is missing, `anchors` shows what the two finders actually saw, `syncErrors` names each failed mirror, and `authPath` says which identity the mobile calls carried. A failed preview puts its `MediaError` code in `log`.

## License

[Apache-2.0](https://github.com/HongyiHank/WIMN?tab=Apache-2.0-1-ov-file)
