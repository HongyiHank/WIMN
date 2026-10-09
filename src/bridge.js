// Web Instagram Music Note in a userscript manager (Tampermonkey / Violentmonkey). Emitted by build.mjs — never edit
// the generated file, and never edit this one in isolation either: the build concatenates the
// metadata header, config.js, this bridge and content.js verbatim into one IIFE.
//
// What the bridge provides, and why each one has to live HERE and not in content.js:
//
//   sessionid (HttpOnly)      GM_cookie, behind a permission the user grants at install time.
//                             Without it there is no mobile identity at all, so the failure is
//                             reported as a reason in `warn` instead of collapsing to an empty
//                             string — three different causes, three different fixes.
//   the Android User-Agent    GM_xmlhttpRequest's own header. A page fetch cannot set User-Agent, so
//                             every i.instagram.com call goes through this bridge's fetch while the
//                             same-origin www calls keep plain fetch (they only need the browser UA).
//   12-hour config sync       no timer at all: the staleness check rides along on every ask, which
//                             is exactly the moment a UA is needed, so a tab left open for days
//                             re-syncs on its next music request instead of on a schedule.
//
// content.js talks to this through globalThis.WIMN_BRIDGE and knows nothing about GM_*.

const BRIDGE_VERSION = '__VERSION__'

// One number for both the client-side guard and the GM request's own timeout: two different ones
// means one of them can never fire.
const GM_TIMEOUT_MS = 12_000

const gmCall = (fn, arg) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('GM call timed out')), GM_TIMEOUT_MS)
    try {
      fn({ ...arg, onload: (v) => { clearTimeout(timer); resolve(v) }, onerror: () => { clearTimeout(timer); reject(new Error('GM call failed')) }, ontimeout: () => { clearTimeout(timer); reject(new Error('GM call timed out')) } })
    } catch (e) {
      clearTimeout(timer)
      reject(e)
    }
  })

const store = {
  get: (k) => {
    try {
      const raw = GM_getValue(k, null)
      return raw == null ? null : JSON.parse(raw)
    } catch {
      return null
    }
  },
  set: (k, v) => {
    try {
      GM_setValue(k, JSON.stringify(v))
    } catch {}
  },
}

/** Fetch one config mirror. Plain fetch is subject to the PAGE's CSP connect-src, and
 *  instagram.com does not allow raw.githubusercontent.com — so from a userscript the mirrors answer
 *  nothing at all and the sync silently falls back to the bundled UA. GM_xmlhttpRequest is not bound
 *  by the page's CSP, so it is the path that actually works here. */
const fetchMirror = async (url) => {
  if (typeof GM_xmlhttpRequest !== 'function') return fetchConfig(url)
  const res = await gmCall(GM_xmlhttpRequest, { method: 'GET', url, timeout: FETCH_TIMEOUT_MS, headers: { Accept: 'text/plain' } })
  if (res.status !== 200) throw new Error('HTTP ' + res.status)
  const parsed = parseConfig(res.responseText ?? '', url)
  if (!parsed) throw new Error('unparseable config.py')
  return parsed
}

/** The 12-hour config sync, done inline: a service worker's job without a service worker. */
const ensureCfg = async (force) => {
  const cfg = store.get('cfg')
  if (cfg?.ua && !force && Date.now() - cfg.at < STALE_MS) return cfg
  // Every mirror at once, and the highest version wins — a lagging mirror must not downgrade us.
  // If they all fail we keep whatever we had: a stale UA beats no UA.
  const results = await Promise.allSettled(SOURCES.map(fetchMirror))
  const good = results.filter((r) => r.status === 'fulfilled').map((r) => r.value)
  // Every rejection, named. "0 mirrors" on its own cannot be acted on — it looks identical to a
  // network that is fine and a parser that stopped understanding config.py.
  const errors = results
    .map((r, i) => (r.status === 'rejected' ? new URL(SOURCES[i]).host + ': ' + String(r.reason?.message || r.reason) : null))
    .filter(Boolean)
  if (!good.length) return { ...(cfg || BUNDLED), syncErrors: errors }
  const best = good.reduce((a, b) => (versionGreater(b.appVersion, a.appVersion) ? b : a))
  const next = { ...best, mirrors: good.length, syncErrors: errors }
  store.set('cfg', next)
  return next
}

/** Managers do not agree on what GM_cookie even IS, and the difference is load-bearing.
 *
 *  Violentmonkey injects an OBJECT with list/set/delete — src/injected/web/gm-api-wrapper.js wraps
 *  gmCookieInvoker into exactly that shape — while Tampermonkey injects a FUNCTION taking
 *  (details, callback). A `typeof === 'function'` capability probe therefore reports "this manager
 *  has no cookie API" on a manager whose API works perfectly. That was measured on the live page:
 *  VM 2.49.0 with a working GM_cookie reported as missing.
 *
 *  The result shape differs too: VM's list() hands back an ARRAY of cookie objects, TM's
 *  function form hands back a single cookie. All four shapes are tried, in that order. */
const cookieApi = () => {
  const legacy = typeof GM_cookie !== 'undefined' ? GM_cookie : undefined
  if (legacy && typeof legacy === 'object' && typeof legacy.list === 'function') return { kind: 'GM_cookie.list', list: legacy.list }
  if (typeof legacy === 'function') return { kind: 'GM_cookie', call: legacy }
  const modern = typeof GM !== 'undefined' && GM && typeof GM === 'object' ? GM.cookie : undefined
  if (modern && typeof modern === 'object' && typeof modern.list === 'function') return { kind: 'GM.cookie.list', list: modern.list }
  if (typeof modern === 'function') return { kind: 'GM.cookie', call: modern }
  return null
}

const settleOnce = () => {
  let done = false
  return { once: (fn) => (...args) => !done && ((done = true), fn(...args)) }
}

/** Read one cookie through whichever API this manager actually injected. Returns null when the API
 *  is absent, when it refused, or when it answered without the cookie — the three are different
 *  problems with different fixes, so the caller is told which one happened. */
const readCookie = async (details) => {
  const api = cookieApi()
  if (!api) return { value: null, why: 'no cookie API in this script manager — it provides neither GM_cookie nor GM.cookie, and sessionid is HttpOnly so there is no way around it' }
  const { once } = settleOnce()
  let got = null
  try {
    got = await new Promise((resolve, reject) => {
      const finish = once((...a) => { clearTimeout(timer); resolve(...a) })
      const fail = once(() => { clearTimeout(timer); reject(new Error('refused')) })
      const timer = setTimeout(fail, 5000)
      try {
        if (api.call) {
          // Tampermonkey: (details, callback) with the cookie first. onload is passed inside details
          // as well, because implementations differ on which of the two they read — and a newer
          // build may answer with a promise instead, so both are wired to the same settle.
          const maybe = api.call({ ...details, onload: finish, onerror: fail }, finish)
          if (maybe && typeof maybe.then === 'function') maybe.then(finish, fail)
        } else {
          // Violentmonkey: list(details, cb) with (cookies, error); may also return a promise.
          const maybe = api.list(details, finish)
          if (maybe && typeof maybe.then === 'function') maybe.then(finish, fail)
        }
      } catch {
        fail()
      }
    })
  } catch {
    return { value: null, why: api.kind + ' was refused — grant cookie access to this script' }
  }
  const cookies = Array.isArray(got) ? got : got == null ? [] : [got]
  const value = cookies[0]?.value ?? cookies[0]?.cookie?.value ?? null
  if (!value) {
    // Violentmonkey's checkCookieOpts() FILTERS HttpOnly cookies out of the result instead of
    // erroring (src/background/utils/cookies.js), gated on the script's own httpOnly option AND the
    // global gmCookieHttpOnly option — so an empty list almost always means those two are off.
    return {
      value: null,
      why: api.kind + ' answered without ' + details.name + ' — if it is HttpOnly, Violentmonkey only returns it when BOTH the per-script "Allow GM_cookie to access HTTP-only cookies" option and the global one under Settings ▸ Advanced are on',
    }
  }
  return { value: String(value) }
}

const readSessionId = async () => {
  // sessionid is HttpOnly, so this is the ONLY way to read it — and it is a permission the user has
  // to grant at install time. "No session" therefore has three very different causes and only one
  // of them is fixable in this file, so the reason is reported instead of collapsed into ''.
  const got = await readCookie({ url: 'https://www.instagram.com/', name: 'sessionid' })
  if (!got.value) return { value: '', why: got.why }
  try {
    return { value: decodeURIComponent(got.value) }
  } catch {
    return { value: got.value }
  }
}

/** A fetch-shaped Response for GM_xmlhttpRequest, so readResponse() consumes it without knowing
 *  which host it came from. `anonymous: false` is what makes the session cookies ride along. */
const gmFetch = async (url, opts = {}) => {
  const cfg = await ensureCfg(false)
  const res = await gmCall(GM_xmlhttpRequest, {
    method: opts.method || 'GET',
    url,
    headers: { ...(opts.headers || {}), 'User-Agent': cfg.ua },
    data: opts.body,
    anonymous: false,
    timeout: GM_TIMEOUT_MS,
  })
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    url: res.finalUrl || url,
    text: async () => res.responseText ?? '',
  }
}

globalThis.WIMN_BRIDGE = {
  ask: async (force) => {
    const cfg = await ensureCfg(!!force)
    const session = await readSessionId()
    const warn = []
    if (!session.value) warn.push(session.why)
    if (cfg.syncErrors?.length) warn.push('UA sync: ' + cfg.syncErrors.join(' | '))
    return {
      cfg,
      sessionid: session.value,
      // Human-readable reasons for anything that came back empty: "no session" without a reason is
      // the one report nobody can act on.
      warn,
      // The answer to "which code am I running?" — users do install several copies of a script.
      extension: 'userscript ' + BRIDGE_VERSION,
    }
  },
  fetch: gmFetch,
  // The one preference the UI remembers (language). Through the bridge so content.js never touches
  // GM_*; the manager's store outlives the page and the tab.
  store: {
    get: (k) => Promise.resolve(store.get(k)),
    set: (k, v) => Promise.resolve(store.set(k, v)),
  },
}