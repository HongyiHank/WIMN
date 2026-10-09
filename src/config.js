// The Android User-Agent source of truth. No page can set User-Agent (fetch forbids it), and
// i.instagram.com rejects a browser UA ("useragent mismatch") and an outdated app outright
// (challenge_required -> /web/unsupported_version/), so a hard-coded version rots. This pulls
// instagrapi's config.py — the same file the current mobile client sends — from three mirrors and
// takes the highest version they agree on.
//
// It is an ES module only so the build and the tests can both load it; build.mjs concatenates it
// into the userscript with the `export` keywords stripped.

export const STALE_MS = 12 * 60 * 60 * 1000 // IG ships a new Android build weekly; twice a day is plenty

// Same file, three hosts: raw.githubusercontent is authoritative, jsDelivr mirrors it, and
// aiograpi is an independent repo that tracks the same upstream values. No self-hosted mirror.
export const SOURCES = [
  'https://raw.githubusercontent.com/subzeroid/instagrapi/master/instagrapi/config.py',
  'https://cdn.jsdelivr.net/gh/subzeroid/instagrapi@master/instagrapi/config.py',
  'https://raw.githubusercontent.com/subzeroid/aiograpi/master/aiograpi/config.py',
]

// Baked in so a fresh install works before the first fetch, and so an offline start still has a
// UA. The first successful sync overwrites all of it.
export const BUNDLED = {
  appVersion: '449.0.0.52.84',
  versionCode: '1079242191',
  bloksVersioningId: '',
  ua: 'Instagram 449.0.0.52.84 Android (34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky; en_US; 1079242191)',
  source: 'bundled',
  mirrors: 0,
  at: 0,
}

/** "1.2.3" > "1.10.0" is false by string compare; split on dots and compare numerically. */
export const versionGreater = (a, b) => {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0
  }
  return false
}

/** instagrapi config.py -> the fields a mobile request needs. Null if anything is unusable, so a
 *  half-recognised file is skipped rather than silently producing a broken UA. */
export const parseConfig = (py, source) => {
  const appVersion = py.match(/DEFAULT_APP_VERSION\s*=\s*["']([^"']+)["']/)?.[1]
  if (!appVersion) return null

  const device = {}
  const devBlock = py.match(/DEVICE_SETTINGS\s*=\s*\{([\s\S]*?)\n\}/)?.[1] || ''
  for (const m of devBlock.matchAll(/["']([a-z_]+)["']\s*:\s*(?:["']([^"']*)["']|(\d+))/g)) device[m[1]] = m[2] ?? m[3]
  if (!device.android_release || !device.model) return null

  // USER_AGENT_BASE is a parenthesised implicit concatenation of literals around {placeholders};
  // joining the literals reproduces the template exactly. The closing paren must be matched on its
  // own line: the last literal ends with "{version_code})", so a non-greedy \(...\) would stop
  // INSIDE that string and silently drop the tail of the template.
  const uaStatement = py.match(/USER_AGENT_BASE\s*=\s*\(([\s\S]*?)^\s*\)/m)?.[1] ?? py.match(/USER_AGENT_BASE\s*=\s*\(([^)]*)\)/)?.[1] ?? ''
  const template = [...uaStatement.matchAll(/["']([^"']*)["']/g)].map((m) => m[1]).join('')
  if (!template.includes('{app_version}')) return null

  // APP_SETTINGS keys its newest entry by the DEFAULT_APP_VERSION variable, not by the literal
  // version, so both spellings have to be looked for (the older entries use literals).
  const escaped = appVersion.replace(/\./g, '\\.')
  const entry = py.match(new RegExp(`["']${escaped}["']\\s*:\\s*\\{([\\s\\S]*?)\\}`))?.[1] || py.match(/DEFAULT_APP_VERSION\s*:\s*\{([\s\S]*?)\}/)?.[1] || ''
  const versionCode = entry.match(/["']version_code["']\s*:\s*["']?(\d+)["']?/)?.[1]
  if (!versionCode) return null

  // locale is not in DEVICE_SETTINGS — instagrapi substitutes the account's locale at runtime and
  // en_US is what the default profile sends.
  const values = { locale: 'en_US', ...device, app_version: appVersion, version_code: versionCode }
  // Unknown placeholders are marked with a NUL rather than substituted with '': a template key that
  // drifted out of DEVICE_SETTINGS would otherwise produce a plausible-looking UA missing a field,
  // and that fails as "useragent mismatch" — which reads as a bug rather than as a parse problem.
  const ua = template.replace(/\{(\w+)\}/g, (_, key) => (key in values ? values[key] : '\0' + key + '\0'))
  if (/[\0{}]/.test(ua)) return null

  return {
    appVersion,
    versionCode,
    bloksVersioningId: entry.match(/["']bloks_versioning_id["']\s*:\s*["']([^"']+)["']/)?.[1] || '',
    // Not returned: `device` above is only the substitution table for the UA template. Nothing reads
    // the profile back, so shipping it in the cached cfg is dead weight.
    ua,
    source,
    at: Date.now(),
  }
}

// Bounded: one hanging mirror must not hold the sync open. Without this, a stalled connection can
// keep the whole refresh pending indefinitely, and the content script's own timeout gives up first.
export const FETCH_TIMEOUT_MS = 10_000

export const fetchConfig = async (url) => {
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const parsed = parseConfig(await res.text(), url)
  if (!parsed) throw new Error('unparseable config.py')
  return parsed
}