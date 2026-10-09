// Smallest thing that fails if the logic this file exists for breaks.
// Run: node test.mjs
//
// Three risk areas, no framework: the note payload shape (a wrong field is rejected server-side
// with field_exception), the shelf/search parsers (Instagram changes shape without warning), and
// the instagrapi config parser that produces the User-Agent — a broken UA fails as
// "useragent mismatch", which looks like a bug rather than a parse problem.
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = (p) => new URL(p, import.meta.url)
const pkg = JSON.parse(readFileSync(here('../package.json'), 'utf8'))
const assert = (cond, msg) => {
  if (!cond) throw new Error('FAIL: ' + msg)
  console.log('  ok  ' + msg)
}

// ---------------------------------------------------------------- content script
// The IIFE bails out only after defining everything it exports, so a stub DOM is enough to reach
// the pure helpers. document.documentElement must exist for boot() to take the early-return path.
const content = readFileSync(here('../src/content.js'), 'utf8')
const sandbox = {
  location: { pathname: '/direct/inbox', search: '' },
  navigator: { language: 'zh-TW' },
  crypto: { randomUUID: () => 'uuid-1' },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  localStorage: { _v: {}, getItem(k) { return this._v[k] ?? null }, setItem(k, v) { this._v[k] = v } },
  document: {
    // ds_user_id is readable; sessionid is HttpOnly and therefore never appears here — exactly the
    // state a userscript without GM_cookie is in.
    cookie: 'csrftoken=tok; ds_user_id=42',
    documentElement: { outerHTML: '', append() {} },
    scripts: [],
    querySelector: () => null,
    querySelectorAll: () => [],
    // Mirrors the real API: XPathResult snapshots expose snapshotLength/snapshotItem and are NOT
    // iterable (Symbol.iterator exists only for the ITERATOR result types). An array here would
    // hide that bug, which is why this is a hand-rolled stand-in rather than [].
    evaluate: () => ({ snapshotLength: 0, snapshotItem: () => null }),
    addEventListener() {},
    createElement: () => ({ style: {}, setAttribute() {}, append() {}, replaceChildren() {}, addEventListener() {}, querySelector: () => null }),
    createElementNS: () => ({ setAttribute() {}, append() {} }),
    getElementById: () => null,
  },
  addEventListener() {},
  MutationObserver: class { observe() {} },
  // A bare vm context has ECMAScript built-ins but no timers; mount() debounces with one.
  setTimeout,
  clearTimeout,
  // `mobileFetch` resolves `fetch` at start-up, so the sandbox has to have one even though no test
  // exercises it (the www calls are never reached in this DOM).
  fetch: async () => ({}),
  XMLHttpRequest: class {},
  XPathResult: { ORDERED_NODE_SNAPSHOT_TYPE: 7 },
  URLSearchParams,
  Date,
  Math,
  performance, // the mount/shelf timings read it; a bare vm context has no DOM globals
  console,
}
sandbox.globalThis = sandbox
vm.runInNewContext(content, sandbox)
const W = sandbox.WIMN

/** The same script with nothing readable in document.cookie. */
const runBareContent = async () => {
  const bare = { ...sandbox, document: { ...sandbox.document, cookie: '' } }
  bare.globalThis = bare
  vm.runInNewContext(content, bare)
  return bare.WIMN.authorization()
}

// -- the music-note payload: exactly what instagrapi's create_music_note() sends ------------
const track = { assetId: '111', clusterId: '222', highlights: [4200, 9000] }
const params = W.buildNoteParams({ text: 'hi', track, browseSessionId: 'B', alacornSessionId: 'A' })
assert(params.note_style === 1, 'note_style 1 marks a music note')
const info = params.note_create_info.music_note_create_info
assert(info.audio_asset_id === '111' && info.audio_cluster_id === '222', 'both audio ids present')
assert(info.start_time === 4200, 'starts at the first highlight (where the app starts it)')
assert(info.duration === 30000, '30s clip, as on the phone')
assert(info.browse_session_id === 'B' && info.alacorn_session_id === 'A', 'session ids carried')
assert(W.buildNoteParams({ text: '', track: null, browseSessionId: 'B' }).note_style === 0, 'no track = plain text note')

// Only the `request` envelope is accepted by CreateInboxTrayItemRequest.
const wrapped = W.wrapVariables(params)
assert(wrapped.request.additional_params.note_create_params === params, 'variables wrapped in request')
assert(!('input' in wrapped), 'no web `input` envelope (that one cannot carry music fields)')

// The body must carry client_doc_id and the friendly name, and stay off lsd/fb_dtsg on mobile.
const webBody = Object.fromEntries(new URLSearchParams(W.buildCreateBody(wrapped)))
assert(webBody.client_doc_id === '3510400299951610199199089856', 'mobile client_doc_id')
assert(webBody.fb_api_req_friendly_name === 'CreateInboxTrayItemRequest', 'friendly name matches the doc id')
assert(webBody.lsd !== undefined, 'lsd present on the web host')
const mobileBody = Object.fromEntries(new URLSearchParams(W.buildCreateBody(wrapped, { mobile: true })))
assert(mobileBody.lsd === undefined && mobileBody.fb_dtsg === undefined, 'no web tokens on the mobile host')

// Relay answers 200 with success:false; the exception is the only signal about a stale doc id.
const failed = W.parseCreateResponse({ data: { x: { inbox_tray_item: {}, exception_message: 'field_exception: audio_asset_id' } } })
assert(failed.id === '' && /audio_asset_id/.test(failed.error), 'empty id + surfaced exception_message')
const okNote = W.parseCreateResponse({ data: { x: { inbox_tray_item: { note_dict: { note_id: 99 } } } } })
assert(okNote.id === '99', 'note id parsed out of note_dict')

// -- parsers: Instagram reshapes these without warning -----------------------------------------
const browse = {
  alacorn_session_id: 'alc-1',
  items: [
    { title: '為你推薦', playlist: { preview_items: [{ track: { id: 9, audio_asset_id: 111, audio_cluster_id: 222, title: 'Song', display_artist: 'Artist', cover_artwork_thumbnail_uri: 'http://c/a.jpg', highlight_start_times_in_ms: [4200], is_explicit: true, fast_start_progressive_download_url: 'https://cdn/p.mp3' } }] } },
    { title: '熱門', playlist: { preview_items: [{ track: { id: 10, audio_cluster_id: 333, title: 'Other' } }] } },
  ],
}
const tracks = W.extractTracks(browse)
assert(tracks.length === 2, 'found both shelf tracks, got ' + tracks.length)
assert(tracks[0].cover === 'https://c/a.jpg', 'http cover upgraded: a mixed-content cover renders as a hole')
assert(tracks[0].explicit === true && tracks[0].preview === 'https://cdn/p.mp3', 'explicit flag + preview url kept')
assert(W.extractTracks(browse).length === 2, 'deduped across calls')

// A shelf track can carry only audio_cluster_id. Falling back to node.id gave a literal
// "undefined" that the server rejected as field_exception, so the fallback stays.
const clusterOnly = W.extractTracks({ payload: { items: [{ track: { audio_cluster_id: 555, title: 'S' } }] } })[0]
assert(clusterOnly.assetId === null && clusterOnly.clusterId === '555', 'missing asset id stays null')

const sections = W.extractSections(browse)
assert(sections.length === 2 && sections[0].title === '為你推薦' && sections[1].title === '熱門', 'shelf groups become sections')
assert(W.extractSections({ weird: true }) === null, 'unknown shape returns null so callers flatten')

// The two controls are found by content, never by IG's obfuscated class names — both finders
// must survive the empty-DOM case used above (the whole mount path runs on every mutation).
assert(typeof W.findEmojiButton === 'function' && typeof W.findShareButtons === 'function', 'anchor finders exported')

// -- the language setting: system by default, stored preference on top of it -------------------
{
  const saved = { lang: 'zh-TW' }
  const langBox = { ...sandbox, navigator: { language: 'en-US' } } // system says English on purpose
  langBox.globalThis = langBox
  // content.js talks only to the bridge, so a fake store is the whole harness — and no GM_* here
  // proves the fallback path (no bridge at all) keeps the system language.
  langBox.WIMN_BRIDGE = { store: { get: (k) => saved[k] ?? null, set: (k, v) => { saved[k] = v } } }
  vm.runInNewContext(content, langBox)
  await new Promise((r) => setTimeout(r, 0)) // boot reads the preference asynchronously
  const Wl = langBox.WIMN
  assert(Wl.text.music === '音樂', 'a stored zh-TW preference overrides an English system language')
  await Wl.setLang('en')
  assert(Wl.text.music === 'Music' && Wl.text.langAuto === 'Follow system', 'setLang re-renders the labels')
  assert(saved.lang === 'en', 'and persists the choice through the bridge store')
  await Wl.setLang('nonsense')
  assert(saved.lang === 'auto' && Wl.text.music === 'Music', 'an unknown value falls back to following the system')
}

// -- the preview url: fetched on demand, upgraded, and the reason surfaced ----------------------
assert(W.extractTracks({ audio_cluster_id: '9', progressive_download_url: 'http://cdn/a.m4a' })[0].preview === 'https://cdn/a.m4a', 'http preview url upgraded to https, like the cover')
assert(W.extractTracks({ audio_cluster_id: '9', reactive_audio_download_url: 'https://cdn/b.m4a' })[0].preview === 'https://cdn/b.m4a', 'reactive_audio_download_url is also a source')
{
  // A track whose payload has no url keeps playing: the button asks clips/music/ for one. The fake
  // bridge stands in for GM_xmlhttpRequest, the way the real bridge does.
  const clipBox = { ...sandbox }
  clipBox.globalThis = clipBox
  clipBox.WIMN_BRIDGE = {
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ metadata: { music_info: { music_asset_info: { fast_start_progressive_download_url: 'http://scontent.fbcdn.net/x.m4a' } } } }),
    }),
  }
  vm.runInNewContext(content, clipBox)
  const bare = { clusterId: '222', preview: null }
  const url = await clipBox.WIMN.fetchTrackUrl(bare)
  assert(url === 'https://scontent.fbcdn.net/x.m4a', 'clips/music/ supplies the url when the payload has none')
  assert(bare.preview === url, 'and caches it on the track, so a second press is free')
  assert(bare.previewFresh === true, 'and marks it fresh, so an expired payload url is not retried against the cache')
  assert(/過期|expired/.test(W.previewError(2)), 'MediaError 2 is reported as the expired-url case, not silence')
  assert(W.previewWhy({ name: 'AbortError', message: 'The play() request was interrupted because the media was removed from the document.' }) === '', 'an interrupted play() reports nothing — it is a track switch, not a failure')
  assert(/NotSupportedError/.test(W.previewWhy({ name: 'NotSupportedError', message: 'x failed' })), 'a real rejection keeps its name, not its message')
  assert(!/https?:/.test(W.previewWhy(new Error('load https://cdn.example/x.m4a failed'))), 'urls are stripped out of the reason')
  assert(W.previewStart({ highlights: [4200] }) === 4.2, 'a preview starts at the first highlight, like the posted note')
  assert(W.previewStart({ highlights: [42000], durationMs: 30000 }) === 0, 'a highlight past the end of the url seeks to nothing, so it is skipped')
  assert(W.previewStart({ highlights: [] }) === 0 && W.previewStart({}) === 0, 'no highlight: no seek')
}
{
  // The player's three states, driven through the real togglePreview() with a fake Audio: it must
  // paint the pause glyph on the FIRST click (the report was that only the audio toggled), and a
  // resume must restart from the highlight rather than continuing from where it paused.
  const box = { ...sandbox }
  box.globalThis = box
  let last = null
  box.Audio = class {
    constructor(src) {
      this.src = src
      this.dataset = {}
      this.paused = true
      this.currentTime = 0
      last = this
    }
    addEventListener() {}
    play() {
      this.paused = false
      return Promise.resolve()
    }
    pause() {
      this.paused = true
    }
  }
  box.document = {
    ...sandbox.document,
    // Keeps children, so icon()'s path (which carries the `d`) can be inspected.
    createElementNS: () => {
      const o = {
        _a: {},
        _kids: [],
        setAttribute(k, v) {
          this._a[k] = v
        },
        getAttribute(k) {
          return this._a[k] ?? null
        },
        append(...kids) {
          this._kids.push(...kids)
        },
      }
      return o
    },
  }
  vm.runInNewContext(content, box)
  const Wl = box.WIMN
  const mkBtn = () => {
    const btn = {
      title: '',
      attrs: {},
      kids: [],
      replaceChildren(...kids) {
        this.kids = kids
      },
      setAttribute(k, v) {
        this.attrs[k] = v
      },
    }
    return btn
  }
  // The decorative glyph carries no <title>, so the path is the svg's only child.
  const glyph = (btn) => btn.kids[0]._kids[0].getAttribute('d')
  const track = { clusterId: '222', title: 'Song', highlights: [4200], preview: 'https://cdn/x.mp4' }

  const btn = mkBtn()
  await Wl.togglePreview(track, btn)
  assert(glyph(btn) === 'M7 5h4v14H7zM13 5h4v14h-4z', 'the first click paints the pause glyph')
  assert(btn.kids[0].getAttribute('aria-hidden') === 'true' && btn.kids[0]._kids.length === 1, 'and the glyph is decorative: no label, no <title>, nothing on hover')
  assert(last.paused === false && last.currentTime === 4.2, 'and it starts at the highlight')

  await Wl.togglePreview(track, btn)
  assert(last.paused === true, 'a second click pauses')

  await Wl.togglePreview(track, btn)
  assert(last.paused === false && last.currentTime === 4.2, 'a resume restarts from the highlight, not from where it stopped')
  assert(glyph(btn) === 'M7 5h4v14H7zM13 5h4v14h-4z', 'and it paints the pause glyph again')
}

// The notes composer is a Lexical editor labelled 分享想法……. composerText() must read THAT field and
// not fall through to "the first empty textbox on the page", which is the DM search box.
const lexical = { tagName: 'DIV', innerText: '  ', hasAttribute: (a) => a === 'data-lexical-editor', getAttribute: (a) => (a === 'aria-label' ? '分享想法……' : null) }
const searchBox = { tagName: 'INPUT', value: '', hasAttribute: () => false, getAttribute: () => null }
const realQSA_lex = sandbox.document.querySelectorAll
sandbox.document.querySelectorAll = (sel) => (sel.includes('contenteditable') || sel.includes('textbox') ? [searchBox, lexical] : [])
assert(W.composerText(null).text === '', 'the lexical editor wins over an empty DM search field')
lexical.innerText = '週末計畫'
assert(W.composerText(null).text === '週末計畫', 'and its text is what gets posted')
sandbox.document.querySelectorAll = realQSA_lex

// --- the composer DOM. composerOf() must climb past a bare toolbar row to the box that actually
// holds the text input: for two controls in one row, the innermost common ancestor IS that row, so
// stopping there silently posts a note with empty text. Found by driving a replica of the composer
// in Chromium; invisible to a syntax check and to any real Instagram session.
// fakeBox stands in for IG's contenteditable; it is returned by any selector naming a text box.
const fakeBox = { tagName: 'DIV', innerText: '  測試文字 🎵 ', getAttribute: (a) => (a === 'aria-label' ? '建立便利貼…' : a === 'maxlength' ? '250' : null) }
const mkEl = (tag, { kids = [], boxes = [], id = '' } = {}) => {
  const el = { tagName: tag, id }
  el.contains = (n) => n === el || kids.some((k) => k.contains(n))
  el.querySelector = (sel) => (sel.includes('contenteditable') && boxes.length ? boxes[0] : null)
  el.querySelectorAll = (sel) => (sel.includes('contenteditable') ? boxes : [])
  kids.forEach((k) => { k.parentElement = el })
  el.parentElement = null
  return el
}
const noteInput = mkEl('div', { boxes: [fakeBox], id: 'note-input' })
const emojiBtn = mkEl('div', { id: 'emoji' })
const shareBtn = mkEl('div', { id: 'share' })
const toolbar = mkEl('div', { kids: [emojiBtn, shareBtn], id: 'toolbar' })
const composerBox = mkEl('div', { kids: [noteInput, toolbar], boxes: [fakeBox], id: 'composer' })
assert(W.composerOf(emojiBtn, shareBtn) === composerBox, 'composerOf climbs past the toolbar row to the box holding the input')
assert(W.composerOf(emojiBtn, shareBtn) !== toolbar, 'the bare toolbar row is not the composer')
assert(JSON.stringify(W.composerText(composerBox)) === JSON.stringify({ text: '測試文字 🎵', limit: 250 }), 'text read and trimmed from the composer input, IG\'s own maxlength wins')
assert(W.composerText(mkEl('div', { id: 'thread' })).text === '', 'no input in scope -> empty text, not a crash')
// Third fingerprint: icon path and aria-label XPath both miss, so the svg aria-label is all that is
// left. A binding dropped while refactoring this finder throws here and nowhere else.
const svgOnly = { tagName: 'div' }
const fakeSvg = { getAttribute: () => 'Emoji', closest: () => svgOnly }
const realQS = sandbox.document.querySelector
const realQSA0 = sandbox.document.querySelectorAll
sandbox.document.querySelector = () => null
sandbox.document.querySelectorAll = (sel) => (sel.includes('svg[aria-label]') ? [fakeSvg] : [])
assert(W.emojiButtons()[0] === svgOnly, 'falls back to the svg aria-label when the path fingerprint and the XPath both miss')
sandbox.document.querySelector = realQS
sandbox.document.querySelectorAll = realQSA0

const realQSA = sandbox.document.querySelectorAll
sandbox.document.querySelectorAll = (sel) => (sel.includes('contenteditable') ? [fakeBox] : [])
assert(W.composerText(null).text === '測試文字 🎵', 'loose mode (no container) falls back to a document scan, labelled input only')
sandbox.document.querySelectorAll = realQSA

// ---------------------------------------------------------------- the config parser
// src/config.js is an ES module that the build concatenates into the userscript (the `export` keywords
// are stripped there); here it is inlined the same way, with two extra lines exposing the private
// helpers. The fixture is a snapshot of instagrapi's config.py — see test/fixtures/config.py for how
// to refresh it — and a parser that stops understanding it produces a UA that fails as
// "useragent mismatch", which reads as a bug rather than as a parse problem.
const configSrc = readFileSync(here('../src/config.js'), 'utf8').replace(/^export\s+/gm, '')
const realConfig = readFileSync(here('./fixtures/config.py'), 'utf8')

const parseSandbox = { console }
parseSandbox.globalThis = parseSandbox
vm.runInNewContext(configSrc + '\n;globalThis.__parse = parseConfig\n;globalThis.__greater = versionGreater\n', parseSandbox)
const parseConfig = parseSandbox.__parse
const versionGreater = parseSandbox.__greater

assert(parseConfig(realConfig, 'fixture').ua.endsWith('1079242191)'), 'a good config fills every placeholder')
assert(parseConfig(realConfig, 'fixture').appVersion === '449.0.0.52.84', 'app version taken from the fixture, not from the bundled default')
assert(parseConfig(realConfig.replace(/USER_AGENT_BASE[\s\S]*?\n\)/, 'USER_AGENT_BASE = ("Instagram 1.0")'), 'broken') === null, 'a template with no {app_version} is rejected')
assert(parseConfig(realConfig.replace(/"android_release": "14",/, ''), 'broken') === null, 'a device profile missing android_release is rejected')
assert(parseConfig(realConfig.replace(/\{version_code\}/, '{ver_code}'), 'broken') === null, 'a placeholder with no matching key is rejected, not filled with an empty string')
assert(parseConfig(realConfig.replace(/"version_code": "\d+",/, ''), 'broken') === null, 'a version block with no version_code is rejected')
assert(parseConfig(realConfig.replace(/(DEFAULT_APP_VERSION|"449[\s\S]*?)\s*:\s*\{/, '$1 = 0\n    unused: {'), 'broken') === null, 'a version with no APP_SETTINGS entry is rejected')
assert(parseConfig('print("hi")', 'junk') === null, 'an unrelated file is rejected')
assert(versionGreater('450.0.0.52.84', '449.0.0.52.84') && !versionGreater('449.0.0.52.84', '450.0.0.52.84'), 'versions compare numerically, so 450 beats 449')
assert(!versionGreater('1.2.3', '1.10.0') && versionGreater('1.10.0', '1.2.3'), 'and 1.10.0 beats 1.2.3, which a string compare gets backwards')

// ---------------------------------------------------------------- userscript build
// The script reads the HttpOnly cookie with GM_cookie and puts the User-Agent on each mobile request
// itself through GM_xmlhttpRequest — the two things a page cannot do for itself.
const userPath = here('../wimn.user.js')
const builtBefore = existsSync(userPath) ? readFileSync(userPath, 'utf8') : null
execFileSync(process.execPath, [fileURLToPath(here('../build.mjs'))], { stdio: 'ignore' })
const built = readFileSync(userPath, 'utf8')
assert(builtBefore === null || builtBefore === built, 'the checked-in wimn.user.js is not stale (rebuild is byte-identical)')

for (const line of [
  '// @grant        GM_xmlhttpRequest',
  '// @grant        GM_cookie',
  '// @grant        GM_getValue',
  '// @grant        GM_setValue',
  '// @connect      i.instagram.com',
  '// @match        https://www.instagram.com/*',
  '// @noframes',
]) assert(built.startsWith('// ==UserScript==') && built.includes(line), 'metadata block carries ' + line.trim())
assert(!built.includes('\nexport ') && !/^\s*import\s.*from\s/m.test(built), 'no module syntax survives into the single-file build')
assert(/const mobileFetch = globalThis\.WIMN_BRIDGE\?\.fetch/.test(built), 'the mobile requests go through the bridge')

/** Violentmonkey's shape, verified against src/injected/web/gm-api-wrapper.js:60-66 — GM_cookie is an
 *  OBJECT with delete/list/set, and list() answers with an ARRAY of cookie objects. `empty` models
 *  checkCookieOpts() FILTERING an HttpOnly cookie out of the result instead of erroring
 *  (src/background/utils/cookies.js:18-22). */
const vmCookieStub = (opts, calls) => ({
  __proto__: null,
  list: (details, cb) => {
    calls.cookie++
    if (opts.cookieThrows) throw new Error('cookie access not granted')
    const one = { name: details.name, value: opts.cookieValue ?? '123%3Aabc%3Adef', httpOnly: true }
    const cookies = opts.empty ? [] : [one]
    cb?.(cookies, null)
    return null
  },
  set: () => {},
  delete: () => {},
})

/** The bridge, with GM stubs, in its own context per run (it declares consts at top level). */
const runBridge = (opts = {}) => {
  const saved = { ...(opts.stored || {}) }
  const calls = { cookie: 0, xhr: [], fetch: 0 }
  const sandbox = {
    ...(opts.modernCookie ? { GM: { cookie: opts.vmShape ? vmCookieStub(opts, calls) : async (d) => (opts.cookieThrows ? (() => { throw new Error('refused') })() : { ...d, value: opts.cookieValue ?? '123%3Aabc%3Adef' }) } } : {}),
    ...(opts.noCookieFn ? {} : { GM_cookie: opts.vmShape ? vmCookieStub(opts, calls) : (details, cb) => {
      calls.cookie++
      if (opts.cookieThrows) throw new Error('cookie access not granted')
      cb?.({ ...details, value: opts.cookieValue ?? '123%3Aabc%3Adef' })
    } }),
    GM_getValue: (k, dflt) => (k in saved ? saved[k] : dflt),
    GM_setValue: (k, v) => { saved[k] = v },

    GM_xmlhttpRequest: (d) => {
      calls.xhr.push(d)
      // config mirrors answer with config.py (or fail, per mirrorsOk); everything else is the music API
      const isMirror = d.url.includes('config.py')
      let body = isMirror ? realConfig : '{"ok":true}'
      if (isMirror && opts.mirrorVersions) body = body.replace(/DEFAULT_APP_VERSION = "[^"]+"/, `DEFAULT_APP_VERSION = "${opts.mirrorVersions[d.url] ?? '1.0.0'}"`)
      const bad = isMirror ? opts.mirrorsOk === false : d.url.includes('fail')
      d.onload({ status: bad ? 500 : 200, finalUrl: d.url, responseText: body })
    },
    fetch: async (url) => {
      calls.fetch++
      return opts.mirrorsOk === false ? { ok: false, status: 500 } : { ok: true, status: 200, text: async () => realConfig }
    },
    AbortSignal, console, JSON, Promise, Date, setTimeout, clearTimeout, URLSearchParams, URL,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(configSrc + '\n' + readFileSync(here('../src/bridge.js'), 'utf8').replace('__VERSION__', pkg.version), sandbox)
  return { bridge: sandbox.WIMN_BRIDGE, saved, calls }
}

if (realConfig) {
  const us = runBridge()
  const reply2 = await us.bridge.ask(false)
  assert(Object.keys(reply2).sort().join() === 'cfg,extension,sessionid,warn', 'the bridge answers exactly the fields the content script reads: ' + Object.keys(reply2).sort().join(', '))
  assert(Array.isArray(reply2.warn), 'and it carries a warn list, so an empty value always comes with a reason')
  assert(/^Instagram \d+(\.\d+)+ Android \(/.test(reply2.cfg.ua), 'userscript builds a UA from the same fetched config: ' + reply2.cfg.ua)
  assert(reply2.extension === 'userscript ' + pkg.version, 'the reply names the build, so a stale installed copy is visible')
  assert(reply2.sessionid === '123:abc:def', 'sessionid read through GM_cookie and percent-decoded')
  // GM_setValue stores the stringified object, so read it back the way store.get() does.
  assert(JSON.parse(us.saved.cfg).ua === reply2.cfg.ua, 'config persisted in GM storage for the next ask (no chrome.alarms needed)')

  // A fresh ask must NOT refetch: that is what replaces the 12-hour alarm.
  const before = us.calls.xhr.length
  await us.bridge.ask(false)
  assert(us.calls.xhr.length === before, 'a cached config costs no request, so there is no timer to lose')

  // Staleness rides along on the ask — this is the whole of the missing chrome.alarms: a tab left
  // open past the window re-syncs on its next music request instead of on a background alarm.
  const aged = runBridge({ stored: { cfg: JSON.stringify({ ...reply2.cfg, at: Date.now() - 13 * 60 * 60 * 1000 }) } })
  await aged.bridge.ask(false)
  assert(aged.calls.xhr.length === 3, 'a config older than 12h is refetched from all three mirrors on the next ask')
  assert(JSON.parse(aged.saved.cfg).at > Date.now() - 60_000, 'and the fresh one is written back')

  // force is what the diagnostics panel's refresh button sends; in the extension it re-fetches and
  // reinstalls the rule, here it just re-fetches.
  const forced = runBridge({ stored: { cfg: JSON.stringify(reply2.cfg) } })
  await forced.bridge.ask(true)
  assert(forced.calls.xhr.length === 3, 'force refreshes even when the cached config is fresh')

  // Every mirror at once, highest version wins: a mirror that lags behind must not downgrade the UA.
  const urls = configSrc.match(new RegExp(`'https://[^']+config.py'`, 'g'))
  {
    const byUrl = Object.fromEntries(urls.map((u, i) => [u.slice(1, -1), `${450 + i}.0.0.1.1`]))
    const spread = runBridge({ mirrorVersions: byUrl })
    const highest = await spread.bridge.ask(false)
    assert(highest.cfg.appVersion === '452.0.0.1.1', 'the highest version among the mirrors wins: ' + highest.cfg.appVersion)
    assert(highest.cfg.ua.startsWith('Instagram 452.0.0.1.1 Android ('), 'and its UA is the one that gets used')
  }

  // The mirrors must NOT use the page's fetch: instagram.com's CSP connect-src does not allow
  // raw.githubusercontent.com, so a plain fetch there fails silently on every mirror and the UA
  // quietly rots at the bundled version. GM_xmlhttpRequest is not bound by the page's CSP.
  const mirrorRun = runBridge()
  await mirrorRun.bridge.ask(false)
  assert(mirrorRun.calls.xhr.every((x) => x.url.includes('config.py')), 'the UA mirrors go out as GM requests, not as the page fetch')
  assert(mirrorRun.calls.xhr.length === 3, 'all three mirrors: ' + mirrorRun.calls.xhr.length)
  assert(mirrorRun.calls.fetch === 0, 'and the page fetch is not used for them at all')
  assert(JSON.parse(mirrorRun.saved.cfg).appVersion === reply2.cfg.appVersion, 'the synced UA came from the mirror path')

  // i.instagram.com only: the UA has to ride on the request itself, since there is no DNR rule.
  const uaRun = runBridge()
  const res = await uaRun.bridge.fetch('https://i.instagram.com/api/v1/music/notes_audio_browser/', {
    method: 'POST', headers: { 'X-IG-App-ID': '1', 'User-Agent': 'browser-UA-should-be-replaced' }, body: 'a=1',
  })
  // the config mirrors are GM requests too, so pick the mobile one out of the list
  const sent = uaRun.calls.xhr.find((x) => x.url.startsWith('https://i.instagram.com/'))
  assert(sent.headers['User-Agent'].startsWith('Instagram ') && sent.headers['User-Agent'].includes('Android'), 'GM_xmlhttpRequest carries the Android UA: ' + sent.headers['User-Agent'])
  assert(sent.headers['X-IG-App-ID'] === '1' && sent.data === 'a=1', 'the caller headers and body survive the UA rewrite')
  assert(sent.anonymous === false, 'cookies ride along (anonymous: false)')
  assert(res.ok === true && res.status === 200 && (await res.text()) === '{"ok":true}', 'the GM response is adapted to the shape readResponse() consumes')

  // GM_cookie is the one permission the user can refuse; a refusal must degrade, not explode — AND
  // it must say why, because "no session" with no reason is the one report nobody can act on.
  const denied = runBridge({ cookieThrows: true })
  const deniedReply = await denied.bridge.ask(false)
  assert(deniedReply.sessionid === '', 'a refused cookie permission yields an empty session, not a crash')
  assert(/refused/.test(deniedReply.warn[0] || ''), 'and the refusal is named: ' + deniedReply.warn[0])
  // A manager can ship the modern GM.cookie instead of the legacy GM_cookie, and vice versa. Without
  // sessionid there is no mobile identity at all (i.instagram.com answers 403 login_required), so
  // this is the difference between a working userscript and a dead one.
  const modern = runBridge({ modernCookie: true })
  const modernReply = await modern.bridge.ask(false)
  assert(modernReply.sessionid === '123:abc:def', 'a manager that only has GM.cookie still yields sessionid: ' + modernReply.sessionid)
  const noGM = runBridge({ noCookieFn: true })
  const noGMReply = await noGM.bridge.ask(false)
  assert(/no cookie API/.test(noGMReply.warn[0] || ''), 'a manager with neither API says so, and says there is no way around it: ' + noGMReply.warn[0])
  // noCookieFn too, so the modern API is the only one present — otherwise the legacy one answers
  // first and the message would (correctly) name GM_cookie instead.
  const modernDenied = runBridge({ modernCookie: true, noCookieFn: true, cookieThrows: true })
  assert(/GM\.cookie was refused/.test((await modernDenied.bridge.ask(false)).warn[0] || ''), 'and a refused GM.cookie names itself rather than the API it did not use')
  const loggedOut = runBridge({ cookieValue: '' })
  assert(/answered without sessionid/.test((await loggedOut.bridge.ask(false)).warn[0] || ''), 'and an answered-but-empty result is distinguishable from a refusal and from a missing API')

  // Mirror failures used to collapse into "0 mirrors", which looks identical to a parser that
  // stopped understanding config.py.
  const dark = runBridge({ mirrorsOk: false })
  const darkReply = await dark.bridge.ask(false)
  assert(darkReply.cfg.syncErrors?.length === 3 && /config\.py|HTTP|unparseable/.test(darkReply.cfg.syncErrors.join(' ')), 'every failed mirror is named: ' + darkReply.cfg.syncErrors.join(' | '))
  assert(/UA sync:/.test(darkReply.warn.join(' ')), 'and the failure reaches the report')
} else {
  console.log('  skip  userscript bridge checks need instagrapi config.py')
}

// --- the identity sent to the mobile API when the HttpOnly cookie cannot be read -----------------
// This sandbox has NO WIMN_BRIDGE (so askBridge answers nothing) and NO sessionid in document.cookie
// (it is HttpOnly) — exactly the state a userscript without GM_cookie is in.
const fallback = await W.authorization()
const decoded = JSON.parse(Buffer.from(fallback.split(':').pop(), 'base64').toString())
assert(fallback.startsWith('Bearer IGT:2:'), 'a bearer is still built without sessionid')
assert(decoded.ds_user_id === '42', 'identity comes from the readable ds_user_id: ' + decoded.ds_user_id)
assert(decoded.sessionid === '', 'and sessionid is empty rather than invented')
assert(decoded.should_use_header_over_cookies === false, 'should_use_header_over_cookies is FALSE, so the server is told to use the cookie that is riding along — the one flag that means exactly that')
// No ds_user_id and no sessionid means no bearer at all — a header with an empty identity is worse
// than none, so the code returns '' rather than sending one.
const bare = await runBareContent()
assert(bare === '', 'with no identity at all it sends no bearer instead of an empty one')

// --- GM_cookie is not a function on Violentmonkey, and that broke the capability probe -----------
// Verified against the source: src/injected/web/gm-api-wrapper.js:60-66 replaces the invoker with
// { delete, list, set }, and list() answers with an ARRAY. A `typeof GM_cookie === 'function'`
// probe reported "no cookie API" on a manager whose API works perfectly.
{
  const vm = runBridge({ vmShape: true })
  const vmReply = await vm.bridge.ask(false)
  assert(vmReply.sessionid === '123:abc:def', "Violentmonkey's object shape yields sessionid: " + vmReply.sessionid)
  assert(vm.calls.cookie === 1, 'and it went through list() exactly once')

  const vmModern = runBridge({ vmShape: true, modernCookie: true })
  assert((await vmModern.bridge.ask(false)).sessionid === '123:abc:def', 'and through GM.cookie on a GM4 grant')

  // VM's checkCookieOpts() filters HttpOnly cookies out of the result rather than erroring, gated on
  // the script option AND the global option. An empty list is therefore the most likely real-world
  // outcome, and it must say which two switches to flip.
  const filtered = runBridge({ vmShape: true, empty: true })
  const filteredReply = await filtered.bridge.ask(false)
  assert(filteredReply.sessionid === '', 'a filtered-out HttpOnly cookie is an empty session')
  assert(/HTTP-only cookies/.test(filteredReply.warn[0] || ''), 'and the message names the two options that cause it: ' + filteredReply.warn[0])

  // A refused call is a different problem and must not be reported as "no cookie API".
  const refused = runBridge({ vmShape: true, cookieThrows: true })
  assert(/was refused/.test((await refused.bridge.ask(false)).warn[0] || ''), 'a refused call names itself, not a missing API')
}
