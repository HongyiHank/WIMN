// Optional DOM verification for WIMN. Playwright + a Chromium build are NOT project dependencies;
// run it only when you want to re-check the layer that unit tests cannot see:
//
//   mkdir -p ~/.wimn-verify && cd ~/.wimn-verify && npm init -y && npm i playwright
//   npx playwright install chromium
//   node verify/dom-check.cjs
//
// It drives a replica of the Notes composer (the markup pasted from a real instagram.com/direct/inbox
// plus the shapes that actually broke earlier: a badge icon in the emoji button, the share label
// inside a <span>, a share button that is aria-disabled with pointer-events:none). Network calls
// are stubbed per page, so nothing is posted anywhere.
//
// Every check here exists because it failed at least once: XPathResult snapshots are not iterable,
// the composer ancestor must be the one holding the input, several emoji buttons means pick the
// bottom-most pair, the icon must be swapped in place on IG's own <svg>, and a dimmed share button
// has no click to intercept at all.
// Playwright, from wherever it lives: the manager's own node_modules, or WIMN_PW pointing at it.
// Not a project dependency, so the lookup is a fallback chain, not a hard path.
const { chromium } = require(process.env.WIMN_PW || require.resolve('playwright', { paths: [process.cwd(), process.env.HOME + '/.wimn-verify'] }))

const SMILEY = 'M15.83 10.997a1.167 1.167 0 1 0 1.167 1.167 1.167 1.167 0 0 0-1.167-1.167Zm-6.5 1.167a1.167 1.167 0 1 0-1.166 1.167 1.167 1.167 0 0 0 1.166-1.167Zm5.163 3.24a3.406 3.406 0 0 1-4.982.007 1 1 0 1 0-1.557 1.256 5.397 5.397 0 0 0 8.09 0 1 1 0 0 0-1.55-1.263ZM12 .503a11.5 11.5 0 1 0 11.5 11.5A11.513 11.513 0 0 0 12 .503Zm0 21a9.5 9.5 0 1 1 9.5-9.5 9.51 9.51 0 0 1-9.5 9.5Z'
const EMOJI_CLS = 'x1i10hfl x972fbf x10w94by x78zum5 x6s0dn4 x1lziwak x1hl2dhg'
const SHARE_CLS = 'x1i10hfl xjqpnuy xc5r6h4 xqeqjp1 xlyipyv x87ps6o x17ydfre x2b8uid'
const SVG_CLS = 'x1lliihq x1n2onr6 x5n08af'
const ROUTE = 'https://www.instagram.com/direct/inbox'
const EXT = require('node:path').resolve(__dirname, '..')

let passed = 0
let failed = 0
const ok = (cond, msg) => {
  if (cond) { passed++; console.log('  ok  ' + msg) } else { failed++; console.log('  FAIL ' + msg) }
}

const shelf = JSON.stringify({
  alacorn_session_id: 'alc-42',
  items: [
    { title: '為你推薦', playlist: { preview_items: [{ track: { id: 1, audio_asset_id: 11, audio_cluster_id: 22, title: 'Yellow', display_artist: 'Coldplay', cover_artwork_thumbnail_uri: 'https://x/y.jpg', highlight_start_times_in_ms: [4200], is_explicit: true, web_30s_preview_download_url: 'https://cdn/p30.mp3' } }] } },
    { title: '熱門', playlist: { preview_items: [{ track: { id: 2, audio_asset_id: 33, audio_cluster_id: 44, title: 'Second Song', display_artist: 'Someone' } }] } },
  ],
})

// fetch stub shared by every page: mobile shelf/search, www graphql + inbox tray.
/** A minimal but VALID instagrapi config.py, so the browser run exercises the real parser (and
 *  the 12h sync path) instead of always falling back to the bundled UA. */
const CONFIG_PY = [
  'DEFAULT_APP_VERSION = "999.0.0.1"',
  // Multi-line, with the closing paren on its own line and the literal's own ')' inside the string —
  // that is the real file's shape, and the only one the parser's first branch can read.
  'USER_AGENT_BASE = (',
  '    "Instagram {app_version} Android ({android_version}/{android_release}; {dpi}; {resolution}; {manufacturer}; {model}; {device}; {cpu}; {locale}; {version_code})"',
  ')',
  'DEVICE_SETTINGS = {',
  '    "android_version": "34",',
  '    "android_release": "14",',
  '    "dpi": "480dpi",',
  '    "resolution": "1344x2992",',
  '    "manufacturer": "Google/google",',
  '    "device": "husky",',
  '    "model": "Pixel 8 Pro",',
  '    "cpu": "husky",',
  '}',
  'APP_SETTINGS = {',
  '    DEFAULT_APP_VERSION: {"version_code": "1234567890", "bloks_versioning_id": "deadbeef"},',
  '}',
].join('\n')

const stubFetch = `
window.__calls = []
window.fetch = async (url, opts) => {
  const u = String(url); window.__calls.push({ url: u, body: opts?.body ? String(opts.body) : null })
  const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o), url: u })
  if (u.includes('config.py')) return { ok: true, status: 200, text: async () => ${JSON.stringify(CONFIG_PY)}, url: u }
  if (u.includes('notes_audio_browser')) return json(${shelf})
  if (u.includes('search_v2')) return json({ items: [{ track: { id: 3, audio_asset_id: 55, audio_cluster_id: 66, title: '搜尋結果', display_artist: 'Artist' } }] })
  if (u.includes('bookmarked')) return json({ payload: { items: [] } })
  if (u.includes('client_doc_id=26838444193647008103482058049')) return json({ data: { x: { inbox_tray_items: [] } } })
  if (u.includes('/api/graphql')) return json({ data: { x: { inbox_tray_item: { note_dict: { note_id: 777 } } } } })
  return json({})
}`

const composer = ({ emojiId = 'emoji', shareId = 'share', shareLabel = '<div>分享</div>', extra = '', text = '測試文字 🎵', inputId = 'note-input', shareAttrs = '' } = {}) => `<!doctype html>
<html lang="zh-Hant"><body>
<div role="main" style="height:60vh;background:#fafafa">
  <div role="button" tabindex="0" class="${EMOJI_CLS}">decoy 分享</div>
  <div role="button" tabindex="0" class="${EMOJI_CLS}"><div class="a"><svg aria-label="表情符號" class="${SVG_CLS}" fill="currentColor" height="16" viewBox="0 0 24 24" width="16"><title>表情符號</title><path d="${SMILEY}"></path></svg></div></div>
</div>
<div id="composer" style="position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #dbdbdb;padding:12px">
  <div contenteditable="true" role="textbox" aria-label="建立便利貼…" id="${inputId}" style="min-height:40px">${text}</div>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
    <div role="button" tabindex="0" aria-expanded="false" aria-haspopup="dialog" class="${EMOJI_CLS}" style="margin-left:auto;padding:4px" id="${emojiId}">
      <div class="a"><svg aria-label="表情符號" class="${SVG_CLS}" fill="currentColor" height="16" viewBox="0 0 24 24" width="16"><title>表情符號</title><path d="${SMILEY}"></path></svg></div>
    </div>
    <div role="button" tabindex="0" class="${SHARE_CLS}" id="${shareId}" ${shareAttrs}>${shareLabel}</div>
  </div>
  ${extra}
</div>
<script>${stubFetch}</script>
</body></html>`

/** The real notes composer is a Lexical editor labelled 分享想法……, not a 便利貼 field. */
const lexicalInput = (id = 'note-input') =>
  `<div class="composer-inner">` +
    `<div class="lex-wrap"><div class="lex-mid"><div class="lex-row"><div class="lex-pad">` +
    `<div aria-label="分享想法……" class="xw2csxc notranslate" contenteditable="true" role="textbox" spellcheck="true" aria-placeholder="分享想法……" data-lexical-editor="true" id="${id}" data-interactable="|keydown||input||click|"><p dir="auto"><br data-lexical-managed-linebreak="true"></p></div>` +
    `<div aria-hidden="true"><div class="ph">分享想法……</div></div>` +
    `</div></div></div></div>` +
    `<div class="avatar-wrap"><span role="link" tabindex="-1" style="height:160px;width:160px"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" /></span></div>` +
  `</div>`

/** The real emoji control: an outer wrapper that carries the circular frame, the role=button
 *  inside it, and an inner div centring the svg. All three layers matter. */
const WRAP_CLS = 'xnz67gz xal68kn x51dqfy x1w4cqa3 x1byqp33 xqui205 x1y1aw1k xf159sx xwib8y2 xmzvs34'
const emojiControl = (id, extraInner = '') => `<div class="${WRAP_CLS}" style="display:inline-flex;align-items:center" data-testid="wrap-${id}"><div aria-expanded="false" aria-haspopup="dialog" class="${EMOJI_CLS}" role="button" tabindex="0" id="${id}"><div class="x6s0dn4 x78zum5 xdt5ytf xl56j7k"><svg aria-label="表情符號" class="${SVG_CLS}" fill="currentColor" height="16" role="img" viewBox="0 0 24 24" width="16"><title>表情符號</title><path d="${SMILEY}"></path></svg>${extraInner}</div></div></div>`

/** An emoji button carrying an extra badge icon — the shape that used to wrap the clone. */
const composerBadged = (id) => `<div role="button" tabindex="0" class="${EMOJI_CLS}" style="margin-left:auto;padding:4px" id="${id}"><div class="a"><svg aria-label="表情符號" class="${SVG_CLS}" fill="currentColor" height="16" viewBox="0 0 24 24" width="16"><title>表情符號</title><path d="${SMILEY}"></path></svg><svg aria-hidden="true" class="badge-svg" height="12" viewBox="0 0 24 24" width="12"><path d="M12 2 L22 22 H2 Z"></path></svg></div></div>`

const open = async (ctx, html, url = ROUTE) => {
  const page = await ctx.newPage()
  page.errors = []
  page.on('pageerror', (e) => page.errors.push(String(e).slice(0, 200)))
  await page.addInitScript({ content: readFileSync(require.resolve ? EXT + '/src/content.js' : '', 'utf8').length ? '' : '' }).catch(() => {})
  await page.route(url, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
  await page.goto(url)
  return page
}
const { readFileSync } = require('node:fs')

;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext()
  // Inject the content script the way the manager does, at document-start.
  await ctx.addInitScript({ content: readFileSync(EXT + '/src/content.js', 'utf8') })

  // ---------------------------------------------------------------- 1. mount + clone fidelity
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  page.on('console', (m) => m.type() === 'error' && /WIMN/.test(m.text()) && errors.push('console: ' + m.text()))
  await page.route(ROUTE, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: composer() }))
  await page.goto(ROUTE)
  await page.waitForSelector('[data-wimn]', { timeout: 8000 }) // mounting is on the debounced tick

  const info = await page.evaluate(() => {
    const emoji = document.getElementById('emoji')
    const mine = document.querySelector('[data-wimn]')
    const box = (e) => { const r = e?.getBoundingClientRect(); return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null }
    return {
      mounted: !!mine,
      nextTo: mine?.previousElementSibling?.id,
      parentIsComposer: mine?.parentElement?.id === 'composer',
      position: mine ? getComputedStyle(mine).position : '',
      left: mine?.style.left, top: mine?.style.top,
      btnClass: mine?.className === emoji?.className,
      innerClass: mine?.firstElementChild?.className === emoji?.firstElementChild?.className,
      svgs: mine?.querySelectorAll('svg').length,
      svgClass: mine?.querySelector('svg')?.getAttribute('class'),
      d: mine?.querySelector('svg path')?.getAttribute('d')?.slice(0, 8),
      paths: mine?.querySelector('svg')?.querySelectorAll('path').length,
      style: mine?.getAttribute('style') || '',
      box: box(mine), emojiBox: box(emoji),
      label: mine?.getAttribute('aria-label'),
      noAriaExpanded: mine?.hasAttribute('aria-expanded') === false,
      inComposer: document.getElementById('composer').contains(mine),
      decoy: !!document.querySelector('#composer ~ div [data-wimn]') || document.querySelectorAll('[data-wimn]').length > 1,
    }
  })
  ok(info.mounted, 'music button mounted')
  ok(info.parentIsComposer === true, 'mounted into the composer, out of the emoji row, so it cannot wrap onto its own line')
  ok(info.position === 'absolute', 'positioned out of the flex flow: ' + info.position)
  ok(info.left !== '' && info.top !== '', "pinned to the emoji button's coordinates: left=" + info.left + ' top=' + info.top)
  ok(info.btnClass === true, 'button class list identical to the emoji button')
  ok(info.innerClass === true, 'inner wrapper class list identical too')
  ok(info.svgs === 1, 'exactly ONE svg — no second glyph can stack under it: ' + info.svgs)
  ok(info.svgClass === SVG_CLS, "keeps the emoji svg's class list, which is what sizes the glyph: " + info.svgClass)
  ok(info.d === 'M12 3v10', 'single path carries the music glyph: ' + info.d)
  ok(info.paths === 1, 'one path inside; the leftover shapes are gone')
  ok(!/margin/.test(info.style) && !/background|color/.test(info.style), 'no margin and no state colours carried over: ' + info.style)
  ok(info.box && info.emojiBox && info.box.w === info.emojiBox.w && info.box.h === info.emojiBox.h, 'rendered box matches the emoji button exactly: ' + JSON.stringify(info.box) + ' vs ' + JSON.stringify(info.emojiBox))
  ok(info.label === '音樂', 'aria-label is 音樂')
  ok(info.noAriaExpanded, 'aria-expanded stripped')
  ok(info.inComposer, 'inside the notes composer, not the decoy')
  ok(!info.decoy, 'only one music button on the page')

  // 2. opening the sheet must not also open IG's emoji panel
  await page.evaluate(() => { window.__emojiFired = 0; document.getElementById('emoji').addEventListener('click', () => window.__emojiFired++) })
  await page.click('[data-wimn]')
  await page.waitForSelector('#wimn-root .sheet', { timeout: 5000 })
  ok(await page.evaluate(() => window.__emojiFired === 0), 'IG emoji handler did not fire (stopPropagation)')

  const rows = await page.$$eval('#wimn-root .row .t span:last-child', (ns) => ns.map((n) => n.textContent))
  ok(JSON.stringify(rows) === JSON.stringify(['Yellow', 'Second Song']), 'shelf rendered: ' + JSON.stringify(rows))
  const heads = await page.$$eval('#wimn-root .section', (ns) => ns.map((n) => n.textContent))
  ok(JSON.stringify(heads) === JSON.stringify(['為你推薦', '熱門']), 'section headers from the shelf grouping: ' + JSON.stringify(heads))
  ok((await page.$$('#wimn-root .row .badge')).length === 1, 'explicit badge on the explicit track only')
  ok((await page.$$('#wimn-root .row .icon')).length === 2, 'preview button on every row (the url is fetched on demand)')
  ok((await page.$$('#wimn-root .foot')).length === 0, 'no hint footer in the sheet')
  const grabBox = await page.evaluate(() => { const g = document.querySelector('#wimn-root .grab'); const r = g.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })
  ok(grabBox.h >= 24, 'the handle is a real touch target, not a 4px sliver: ' + JSON.stringify(grabBox))

  // 3. search replaces the shelf
  await page.fill('#wimn-root input', 'love')
  await page.waitForTimeout(700)
  const searched = await page.$$eval('#wimn-root .row .t span:last-child', (ns) => ns.map((n) => n.textContent))
  ok(JSON.stringify(searched) === JSON.stringify(['搜尋結果']), 'search painted results: ' + JSON.stringify(searched))
  ok((await page.evaluate(() => window.__calls.filter((c) => c.url.includes('search_v2')).length)) === 1, 'one request per keystroke')

  // 4. pick -> chip, and the chip is placed above the button, inside the viewport
  await page.fill('#wimn-root input', '')
  await page.waitForTimeout(700)
  await page.click('#wimn-root .row .main')
  await page.waitForSelector('[data-wimn-chip]', { timeout: 3000 })
  ok((await page.$$('#wimn-root .sheet')).length === 0, 'sheet closed after picking')
  ok((await page.textContent('[data-wimn-chip]')).includes('Yellow'), 'chip shows the chosen track')
  const placed = await page.evaluate(() => {
    const chip = document.querySelector('[data-wimn-chip]').getBoundingClientRect()
    const input = document.getElementById('note-input').getBoundingClientRect()
    return { aboveInput: chip.bottom <= input.top + 1, doesNotOverlap: chip.bottom <= input.top, gap: Math.round(input.top - chip.bottom), dxLeft: Math.round(chip.left - input.left), insideX: chip.left >= 0 && chip.right <= innerWidth, insideY: chip.top >= 0, chipBottom: Math.round(chip.bottom), inputTop: Math.round(input.top) }
  })
  ok(placed.aboveInput, 'chip sits directly ABOVE the note text input, even with room below it')
  ok(placed.gap >= 4 && placed.gap <= 20, 'chip gap above the input is tight: ' + placed.gap + 'px')
  ok(placed.doesNotOverlap, 'chip does not overlap the input: bottom ' + placed.chipBottom + ' vs input top ' + placed.inputTop)
  ok(Math.abs(placed.dxLeft) <= 12, 'chip left-aligned with the text input (dx=' + placed.dxLeft + ')')
  ok(placed.insideX && placed.insideY, 'chip clamped inside the viewport')

  // 5. publish through the native share button
  await page.evaluate(() => { window.__shareFired = 0; document.getElementById('share').addEventListener('click', () => window.__shareFired++) })
  await page.click('#share')
  await page.waitForTimeout(400)
  const post = await page.evaluate(() => ({ fired: window.__shareFired, calls: window.__calls.filter((c) => c.url.includes('/api/graphql')) }))
  ok(post.fired === 0, 'IG share handler suppressed (capture phase)')
  ok(post.calls.length >= 1, 'posted through the create mutation')
  const vars = JSON.parse(new URLSearchParams(post.calls[0].body).get('variables'))
  const ncp = vars.request.additional_params.note_create_params
  ok(ncp.note_style === 1, 'note_style 1 — a music note')
  ok(ncp.note_create_info.music_note_create_info.audio_cluster_id === '22', 'the picked cluster id went out')
  ok(ncp.note_create_info.music_note_create_info.alacorn_session_id === 'alc-42', 'real alacorn from the shelf, not the placeholder')
  ok(ncp.text === '測試文字 🎵', "composer text read from IG's own input: " + JSON.stringify(ncp.text))

  // 6. Escape, then the diagnostics sheet
  await page.waitForLoadState('load')
  await page.waitForTimeout(900)
  await page.click('[data-wimn]')
  await page.waitForSelector('#wimn-root .sheet')
  await page.click('#wimn-root .row .main')
  await page.waitForSelector('[data-wimn-chip]')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  ok((await page.$$('[data-wimn-chip]')).length === 0, 'Escape clears the attached track')
  await page.click('[data-wimn]')
  await page.waitForSelector('#wimn-root .sheet')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  ok((await page.$$('#wimn-root .sheet')).length === 0, 'Escape closes the sheet')
  // diagnostics is reached from the gear in the music sheet — there is no keyboard shortcut
  await page.keyboard.press('Alt+Shift+M')
  await page.waitForTimeout(300)
  ok((await page.$$('#wimn-root .sheet, #wimn-root .acts')).length === 0, 'Alt+Shift+M no longer opens diagnostics')
  await page.click('[data-wimn]')
  await page.waitForSelector('#wimn-root .sheet', { timeout: 5000 })
  const callsBeforeDiag = await page.evaluate(() => window.__calls.length) // after the sheet's own loads
  await page.click('#wimn-root .head [data-wimn-diag]')
  await page.waitForSelector('#wimn-root .acts', { timeout: 5000 })
  ok((await page.$$('#wimn-root pre')).length === 0, 'no report box until a probe has actually run')
  const idlePanel = await page.evaluate(() => {
    const sheet = document.querySelector('#wimn-root .sheet')
    return { h: Math.round(sheet.getBoundingClientRect().height), kids: [...sheet.children].map((n) => n.className || n.tagName) }
  })
  ok(idlePanel.h < 260, 'the idle panel is compact, not a tall empty frame: ' + idlePanel.h + 'px')
  ok(!idlePanel.kids.includes('pre'), 'nothing pre-shaped in the idle panel: ' + JSON.stringify(idlePanel.kids))
  ok((await page.evaluate(() => window.__calls.length)) === callsBeforeDiag, 'no network calls until the button is pressed')
  ok((await page.$$('#wimn-root .btn')).length === 3, 'only run / refresh / copy — no test-note button: ' + (await page.$$('#wimn-root .btn')).length)
  await page.click('#wimn-root .acts .btn')
  await page.waitForFunction(() => (document.querySelector('#wimn-root pre')?.textContent || '').includes('anchors'), null, { timeout: 15000 })
  const report = JSON.parse(await page.textContent('#wimn-root pre'))
  ok(report.composer === 'paired', 'diagnostics: composer paired')
  ok(report.anchors.emojiCount >= 1 && report.anchors.shareCount >= 1, 'anchor dump lists what the finders saw')
  ok(Array.isArray(report.log) && report.log.length > 0, 'request log captured: ' + (report.log || []).length + ' lines')
  ok(report.mount.startsWith('mounted'), 'diagnostics: mount state ' + report.mount)
  ok(report.posted === undefined, 'diagnostics posts nothing: no `posted` field')

  // Input-level click at the measured centre: Playwright's actionability scroll heuristics balk at a
  // button in a position:fixed composer at the bottom-right of the viewport — a harness artifact, not
  // a product problem. The coordinates come from a live measurement, so the hit test still runs.
  const hit = async () => {
    const r = await page.evaluate(() => {
      const b = document.querySelector('[data-wimn]').getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
    })
    await page.mouse.click(r.x, r.y)
  }

  // 6b. the drag handle, on its own page: hovering must not drag, a tap must not dismiss, and a
  // drag past a third of the height must slide the sheet out and close it.
  const dragPage = await ctx.newPage()
  dragPage.on('pageerror', (e) => errors.push('drag: ' + String(e).slice(0, 160)))
  await dragPage.route(ROUTE, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: composer({ emojiId: 'emojiG', shareId: 'shareG' }) }))
  await dragPage.goto(ROUTE)
  await dragPage.waitForSelector('[data-wimn]', { timeout: 8000 })
  const openViaClick = () => dragPage.evaluate(() => {
    const b = document.querySelector('[data-wimn]').getBoundingClientRect()
    document.querySelector('[data-wimn]').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }))
  })
  await openViaClick()
  await dragPage.waitForSelector('#wimn-root .sheet', { timeout: 5000 })
  const dragResult = await dragPage.evaluate(async () => {
    const g = document.querySelector('#wimn-root .grab')
    const sheet = document.querySelector('#wimn-root .sheet')
    const at = (t, cy) => g.dispatchEvent(new PointerEvent(t, { pointerId: 1, clientX: g.getBoundingClientRect().left + 8, clientY: cy, bubbles: true, cancelable: true }))
    const y = g.getBoundingClientRect().top + 12
    at('pointermove', y + 400) // hover: no button down, so this must not move the sheet
    const afterHover = sheet.style.transform || '(none)'
    at('pointerdown', y)
    for (let i = 1; i <= 6; i++) at('pointermove', y + i * 40) // 240px, past the 1/3 threshold
    const during = /translateY\(([-\d.]+)px\)/.exec(sheet.style.transform)
    at('pointerup', y + 240)
    const slid = sheet.style.transform
    await new Promise((r) => setTimeout(r, 420)) // it finishes sliding out, then closes
    return { afterHover, during: during ? Number(during[1]) : 0, slid, gone: !document.querySelector('#wimn-root .sheet') }
  })
  ok(dragResult.afterHover === '(none)', 'hovering the handle does not drag it (pointermove fires without pointerdown): ' + dragResult.afterHover)
  ok(dragResult.during > 100, 'the sheet follows the pointer while dragging (translateY=' + dragResult.during + 'px)')
  ok(/translateY/.test(dragResult.slid), 'on release it animates the rest of the way out: ' + dragResult.slid)
  ok(dragResult.gone, 'dragging past a third of the height dismisses it')

  await openViaClick()
  await dragPage.waitForSelector('#wimn-root .sheet', { timeout: 5000 })
  await dragPage.evaluate(() => {
    const r = document.querySelector('#wimn-root .grab').getBoundingClientRect()
    const y = r.top + r.height / 2
    const g = document.querySelector('#wimn-root .grab')
    const at = (t) => g.dispatchEvent(new PointerEvent(t, { pointerId: 2, clientX: r.left + 8, clientY: y, bubbles: true, cancelable: true }))
    at('pointerdown')
    at('pointerup')
  })
  await dragPage.waitForTimeout(250)
  ok((await dragPage.$$('#wimn-root .sheet')).length === 1, 'a tap on the handle leaves the sheet open')
  await dragPage.close()

  // 7. a chat composer (傳送/Send) never gets a music button
  const chat = await ctx.newPage()
  await chat.route(ROUTE, (r) => r.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8',
    body: composer({ emojiId: 'emojiC', shareId: 'sendC', shareLabel: '傳送', text: '' }),
  }))
  await chat.goto(ROUTE)
  await chat.waitForTimeout(500)
  ok((await chat.$$('[data-wimn]')).length === 0, 'chat composer (傳送/Send) never gets a music button')
  await chat.close()

  // 8. label inside a <span>, aria-label on the svg only (a redrawn icon)
  const odd = await ctx.newPage()
  await odd.route(ROUTE, (r) => r.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="zh-Hant"><body><div id="composer">
      <div contenteditable="true" role="textbox" aria-label="建立便利貼…"></div>
      <div style="display:flex;justify-content:space-between">
        <div role="button" tabindex="0" class="${EMOJI_CLS}" id="emojiO"><div class="a"><svg aria-label="表情符號" class="${SVG_CLS}" fill="currentColor" height="16" viewBox="0 0 24 24" width="16"><title>表情符號</title><path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2Z"></path></svg></div></div>
        <div role="button" tabindex="0" class="${SHARE_CLS}" id="shareO"><div><span> 分享 </span></div></div>
      </div></div><script>${stubFetch}</script></body></html>`,
  }))
  await odd.goto(ROUTE)
  await odd.waitForTimeout(600)
  ok((await odd.$$('[data-wimn]')).length === 1, 'mounted on a redrawn icon (svg aria-label only) + label inside a <span>')
  ok((await odd.$$('#wimn-root .pill')).length === 0, 'no fallback pill while mounted')
  await odd.close()

  // 9. an unmountable composer leaves a diagnostics pill that says WHY. Chat threads (傳送) are out
  // of scope and stay silent; a notes thread that fails to mount must still get the pill.
  const bare = await ctx.newPage()
  await bare.route(ROUTE, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><body><div id="c"><div contenteditable="true" role="textbox" aria-label="note"></div><div role="button" tabindex="0" id="sendB">傳送</div></div></body></html>' }))
  await bare.goto(ROUTE)
  await bare.waitForTimeout(600)
  ok((await bare.$$('#wimn-root .pill')).length === 1, 'a diagnostics pill appears instead of silence')
  await bare.click('#wimn-root .pill')
  await bare.waitForSelector('#wimn-root .acts', { timeout: 5000 })
  ok((await bare.$$('#wimn-root pre')).length === 0, 'the pill opens the panel idle too — no report box until asked')
  await bare.click('#wimn-root .acts .btn')
  await bare.waitForFunction(() => (document.querySelector('#wimn-root pre')?.textContent || '').includes('anchors'), null, { timeout: 15000 })
  const bareReport = JSON.parse(await bare.textContent('#wimn-root pre'))
  ok(/no emoji button|no 分享/.test(bareReport.mount), 'the report states why: ' + bareReport.mount)
  await bare.close()

  const thread = await ctx.newPage()
  await thread.route('https://www.instagram.com/direct/t/123', (r) => r.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8',
    body: composer({ emojiId: 'emojiT', shareId: 'sendT', shareLabel: '傳送', text: '' }),
  }))
  await thread.goto('https://www.instagram.com/direct/t/123')
  await thread.waitForTimeout(600)
  ok((await thread.$$('[data-wimn]')).length === 0, 'thread route: no music button')
  ok((await thread.$$('#wimn-root .pill')).length === 0, 'chat thread: no diagnostics pill either — the feature is out of scope there')
  await thread.close()

  // 9a. the same thread page, but a notes composer (分享) whose mount failed: the pill is the only
  // remaining way into the diagnostics, so it has to show.
  const noteThread = await ctx.newPage()
  await noteThread.route('https://www.instagram.com/direct/t/456', (r) => r.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><body><div id="c"><div contenteditable="true" role="textbox" aria-label="分享想法……" data-lexical-editor="true"></div><div role="button" tabindex="0" id="sendN">分享</div></div></body></html>',
  }))
  await noteThread.goto('https://www.instagram.com/direct/t/456')
  await noteThread.waitForTimeout(600)
  ok((await noteThread.$$('[data-wimn]')).length === 0, 'notes thread with no emoji button: nothing to mount')
  ok((await noteThread.$$('#wimn-root .pill')).length === 1, 'notes thread that failed to mount still gets a diagnostics pill')
  await noteThread.close()

  // 9b. a toolbar with NO spare room and flex-wrap: the exact case that used to drop the button onto
  // its own line. Out of flow it must still sit beside the emoji button, on the same line.
  const tight = await ctx.newPage()
  await tight.route(ROUTE, (r) => r.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="zh-Hant"><body>
      <div id="composer" style="position:fixed;bottom:0;left:0;right:0;width:420px">
        <div contenteditable="true" role="textbox" aria-label="建立便利貼…"></div>
        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;width:180px">
          ${composerBadged('emojiT2')}
          <div role="button" tabindex="0" class="${SHARE_CLS}" style="flex:0 0 120px" id="shareT2">分享</div>
        </div></div><script>${stubFetch}</script></body></html>`,
  }))
  await tight.goto(ROUTE)
  await tight.waitForTimeout(600)
  const tightInfo = await tight.evaluate(() => {
    const b = document.querySelector('[data-wimn]')
    const e = document.getElementById('emojiT2')
    if (!b || !e) return null
    const br = b.getBoundingClientRect()
    const er = e.getBoundingClientRect()
    const gapToEmoji = Math.round(er.left - br.right)
    return {
      sameLine: Math.abs(br.top - er.top) <= 2,
      beside: gapToEmoji >= 0 && gapToEmoji <= 12,   // immediately left of it, with a small gap
      gapToEmoji, bt: Math.round(br.top), et: Math.round(er.top), bl: Math.round(br.left), el: Math.round(er.left),
      box: { w: Math.round(br.width), h: Math.round(br.height) }, emojiBox: { w: Math.round(er.width), h: Math.round(er.height) },
    }
  })
  ok(tightInfo !== null, 'mounted even in a toolbar with no spare room')
  ok(tightInfo.sameLine, 'stays on the SAME LINE as the emoji button (top ' + tightInfo.bt + ' vs ' + tightInfo.et + ')')
  // "beside" means the same row with no overlap: to the left of the emoji button, or right up
  // against it. In this fixture the emoji button is pushed right by its own auto margin, so the
  // music button lands to its left.
  ok(tightInfo.beside, 'sits immediately to the LEFT of the emoji button, ' + tightInfo.gapToEmoji + 'px gap, same row: ' + JSON.stringify(tightInfo))
  // The badge makes the ORIGINAL button wider than ours — that is IG's own width, not our bug. What
  // must hold is the height, the row, and that we never grow into a pill.
  ok(tightInfo.box.h === tightInfo.emojiBox.h, 'same height as the emoji button: ' + JSON.stringify(tightInfo.box) + ' vs ' + JSON.stringify(tightInfo.emojiBox))
  ok(tightInfo.box.h <= 48, 'not stretched into a tall pill: ' + tightInfo.box.h + 'px')
  await tight.close()

  // 8b. the REAL notes composer shape: a Lexical editor labelled 分享想法…… inside a wrapper that
  // also holds the avatar. The chip must sit above that whole wrapper, not across the text line.
  const real = await ctx.newPage()
  await real.route(ROUTE, (r) => r.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="zh-Hant"><body>
      <div id="composer" style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:12px">
        ${lexicalInput('note-real')}
        <div class="toolbar" style="display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px">
          <span class="grow" style="flex:1"></span>
          ${emojiControl('emojiR')}
          <div role="button" tabindex="0" class="${SHARE_CLS}" id="shareR">分享</div>
        </div>
      </div><script>${stubFetch}</script></body></html>`,
  }))
  await real.goto(ROUTE)
  await real.waitForSelector('[data-wimn]', { timeout: 8000 })
  ok((await real.$$('[data-wimn]')).length === 1, 'mounted on the real Lexical composer')
  const realBox = await real.evaluate(() => {
    const b = document.querySelector('[data-wimn]')
    const e = document.getElementById('emojiR')
    const br = b.getBoundingClientRect(); const er = e.getBoundingClientRect()
    const cs = (n) => getComputedStyle(n)
    const share = document.getElementById('shareR').getBoundingClientRect()
    // Separation is measured whichever side it landed on: negative means the two overlap.
    const overlapX = Math.min(br.right, er.right) - Math.max(br.left, er.left)
    const separation = overlapX > 0 ? -Math.round(overlapX) : Math.round(Math.max(er.left - br.right, br.left - er.right))
    const onLeft = br.right <= er.left + 1
    return {
      sameBox: Math.abs(br.width - er.width) <= 1 && Math.abs(br.height - er.height) <= 1,
      bw: Math.round(br.width), bh: Math.round(br.height), ew: Math.round(er.width), eh: Math.round(er.height),
      radius: cs(b).borderTopLeftRadius, eradius: cs(e).borderTopLeftRadius,
      gap: separation, onLeft, noShareCollision: br.right <= share.left, sameRow: Math.abs(br.top - er.top) <= 2,
      pos: getComputedStyle(document.querySelector('[data-wimn-shell]') || b).position,
      absolute: getComputedStyle(document.querySelector('[data-wimn-shell]') || b).position === 'absolute',
      margins: { emoji: e.style.marginLeft || '(none)', wrap: document.querySelector('[data-testid="wrap-emojiR"]').style.marginLeft || '(none)' },
      // the shift lands on the emoji control's WRAPPER, which is the node that actually holds it
      emojiMovedRight: parseFloat(document.querySelector('[data-testid="wrap-emojiR"]').style.marginLeft || '0') > 0,
      centreDelta: Math.round((br.top + br.height / 2) - (er.top + er.height / 2)),
      mineBtn: (() => { const m = b.querySelector('[data-wimn]') || b; const r = m.getBoundingClientRect(); return { top: Math.round(r.top), centre: Math.round(r.top + r.height / 2) } })(),
      refCentre: Math.round(er.top + er.height / 2),
      restorable: document.querySelector('[data-testid="wrap-emojiR"]').style.marginLeft !== '',
    }
  })
  ok(realBox.sameBox, 'button box is identical to the emoji button, classes alone: ' + JSON.stringify(realBox))
  const frame = await real.evaluate(() => {
    const wrap = document.querySelector('[data-wimn-shell]')
    const ref = document.querySelector('[data-testid="wrap-emojiR"]')
    if (!wrap || !ref) return null
    const w = wrap.getBoundingClientRect(); const r = ref.getBoundingClientRect()
    const b = wrap.querySelector('[data-wimn]')
    return { sameCls: wrap.className === ref.className, hasFrame: wrap.querySelector('[data-wimn]') !== null, w: Math.round(w.width), r: Math.round(r.width), h: Math.round(w.height), rh: Math.round(r.height), btnInside: !!b }
  })
  ok(frame && frame.sameCls, 'the outer wrapper is copied, which is what draws the circular frame')
  ok(frame && frame.btnInside, 'the button lives inside that wrapper')
  ok(frame && frame.w === frame.r && frame.h === frame.rh, 'wrapper box matches the emoji control exactly: ' + JSON.stringify(frame))
  // the regression an early return caused: positioned and clickable on the three-layer control
  ok(realBox.absolute, 'the music button is out of the flow (position:absolute), got ' + realBox.pos)
  ok(realBox.emojiMovedRight, 'the emoji control was shifted right to make room: ' + JSON.stringify(realBox.margins))
  ok(realBox.gap >= 4 && realBox.gap <= 10, 'and the music button sits right against it, ' + realBox.gap + 'px apart')
  ok(realBox.restorable, 'IG\'s original margin is remembered so it can be restored')
  ok(realBox.gap >= 0, 'never overlaps the emoji button: separation ' + realBox.gap + 'px')
  ok(realBox.sameRow, 'on the same row as the emoji button')
  ok(Math.abs(realBox.centreDelta) <= 1, 'the two visible controls share a vertical centre (delta ' + realBox.centreDelta + 'px)')
  ok(realBox.gap >= 6 && realBox.gap <= 32, 'the gap reads as deliberate on a wide composer: ' + realBox.gap + 'px')
  ok(realBox.noShareCollision, 'and it does not run into the 分享 button')
  ok(realBox.onLeft, 'placed to the LEFT of the emoji button, which is what was asked for')
  await real.evaluate(() => document.querySelector('[data-wimn]').dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await real.waitForSelector('#wimn-root .sheet', { timeout: 5000 })
  await real.click('#wimn-root .row .main')
  await real.waitForSelector('[data-wimn-chip]', { timeout: 3000 })
  const realChip = await real.evaluate(() => {
    const chip = document.querySelector('[data-wimn-chip]').getBoundingClientRect()
    const wrap = document.querySelector('.lex-wrap').getBoundingClientRect()
    const block = document.querySelector('.composer-inner').getBoundingClientRect()
    const avatar = document.querySelector('.avatar-wrap').getBoundingClientRect()
    const input = document.querySelector('[data-lexical-editor="true"]').getBoundingClientRect()
    const root = document.querySelector('#composer').getBoundingClientRect()
    return {
      aboveWrapper: chip.bottom <= wrap.top + 1,
      gap: Math.round(wrap.top - chip.bottom),
      dx: Math.round(chip.left - wrap.left),
      textH: Math.round(input.height),
      // the block that holds the text AND the 160px avatar — the live page measured 187px tall for a
      // 25px input, and anchoring there threw the chip ~195px up into the message list
      avatarBlockH: Math.round(block.height),
      sticksOut: Math.round(chip.top - root.top),
      avatarTop: Math.round(avatar.top),
    }
  })
  ok(realChip.aboveWrapper, 'chip sits ABOVE the text row, not across the text line')
  ok(realChip.textH * 2 + 24 >= 20 && realChip.avatarBlockH > realChip.textH * 2 + 24,
    'the fixture really does have the avatar block the anchor must skip (' + realChip.avatarBlockH + 'px block vs ' + realChip.textH + 'px text)')
  ok(realChip.sticksOut <= 60, 'chip stays within 60px of the composer top, not floating in the message list (sticks out ' + realChip.sticksOut + 'px)')
  ok(realChip.gap + realChip.avatarBlockH - realChip.textH < realChip.avatarBlockH,
    'the chip clears the text row it is anchored to')
  ok(realChip.gap >= 4 && realChip.gap <= 24, 'gap above the wrapper is tight: ' + realChip.gap + 'px')
  ok(Math.abs(realChip.dx) <= 12, 'left-aligned with that wrapper (dx=' + realChip.dx + ')')
  // and the text still comes from the Lexical editor, not some other field on the page
  await real.click('#shareR')
  await real.waitForTimeout(400)
  const realPosted = await real.evaluate(() => {
    const body = window.__calls.filter((c) => c.url.includes('/api/graphql')).pop()
    return body ? JSON.parse(new URLSearchParams(body.body).get('variables')).request.additional_params.note_create_params.text : null
  })
  ok(realPosted === '', 'note text read from the Lexical editor (empty, as typed): ' + JSON.stringify(realPosted))
  await real.close()

  // 9c. closing the notes panel must take the attached song with it — via IG's own 關閉 control,
  // and via the composer simply unmounting (which is how the panel usually goes away).
  const CLOSE_SVG = `<svg aria-label="關閉" class="x1lliihq x1n2onr6 x5n08af" fill="currentColor" height="16" role="img" viewBox="0 0 24 24" width="16"><title>關閉</title><line fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" x1="21" x2="3" y1="3" y2="21"></line><line fill="none" stroke="currentColor" stroke-width="2" x1="21" x2="3" y1="21" y2="3"></line></svg>`
  const closer = await ctx.newPage()
  await closer.route(ROUTE, (r) =>
    r.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8',
      body: composer({ emojiId: 'emojiC1', shareId: 'shareC1' }).replace('<div id="composer"', `<div role="button" tabindex="0" id="closeNotes" class="x1i10hfl">${CLOSE_SVG}</div><div id="composer"`),
    })
  )
  await closer.goto(ROUTE)
  await closer.waitForSelector('[data-wimn]', { timeout: 8000 })
  await closer.evaluate(() => document.querySelector('[data-wimn]').dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await closer.waitForSelector('#wimn-root .sheet', { timeout: 5000 })
  await closer.click('#wimn-root .row .main')
  await closer.waitForSelector('[data-wimn-chip]', { timeout: 3000 })
  await closer.evaluate(() => document.getElementById('closeNotes').dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await closer.waitForTimeout(200)
  ok((await closer.$$('[data-wimn-chip]')).length === 0, "IG's 關閉 control clears the attached song")

  // and the same when the composer simply disappears
  await closer.evaluate(() => document.querySelector('[data-wimn]').dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await closer.waitForSelector('#wimn-root .sheet', { timeout: 5000 })
  await closer.click('#wimn-root .row .main')
  await closer.waitForSelector('[data-wimn-chip]', { timeout: 3000 })
  await closer.evaluate(() => document.getElementById('composer').remove())
  await closer.waitForTimeout(1200) // the debounce before we give up on the composer
  ok((await closer.$$('[data-wimn-chip]')).length === 0, 'an unmounted composer clears the attached song too')
  await closer.close()

  // 10. the dimmed share button, the case that could not post at all before
  const dis = await ctx.newPage()
  await dis.route(ROUTE, (r) => r.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8',
    body: composer({
      emojiId: 'emojiD', shareId: 'shareD', inputId: 'noteD', text: '',
      shareAttrs: 'aria-disabled="true" style="pointer-events:none;opacity:.5;color:#c7c7c7"',
    }),
  }))
  await dis.goto(ROUTE)
  await dis.waitForSelector('[data-wimn]', { timeout: 8000 })
  ok((await dis.$$('#wimn-root .pill')).length === 0, 'a disabled share button is still recognised, so it mounts')
  await dis.click('[data-wimn]')
  await dis.waitForSelector('#wimn-root .sheet')
  await dis.click('#wimn-root .row .main')
  await dis.waitForSelector('[data-wimn-chip]')
  const armed = await dis.evaluate(() => {
    const b = document.getElementById('shareD')
    return { tagged: b.hasAttribute('data-wimn-share'), aria: b.getAttribute('aria-disabled'), pe: getComputedStyle(b).pointerEvents }
  })
  ok(armed.tagged, 'share button tagged for the pointer-events override')
  ok(armed.aria === null && armed.pe === 'auto', 'dim cleared while a song is attached: ' + JSON.stringify(armed))
  await dis.click('[data-wimn-chip] .remove')
  await dis.waitForTimeout(200)
  const restored = await dis.evaluate(() => {
    const b = document.getElementById('shareD')
    return { tagged: b.hasAttribute('data-wimn-share'), aria: b.getAttribute('aria-disabled'), pe: b.style.pointerEvents, op: b.style.opacity, c: b.style.color }
  })
  ok(!restored.tagged && restored.aria === 'true' && restored.pe === 'none' && restored.op === '0.5' && restored.c === 'rgb(199, 199, 199)', "IG's own disabled state restored byte-for-byte: " + JSON.stringify(restored))
  await dis.click('[data-wimn]')
  await dis.waitForSelector('#wimn-root .sheet')
  await dis.click('#wimn-root .row .main')
  await dis.waitForSelector('[data-wimn-chip]')
  ok((await dis.textContent('#noteD')) === '', 'still no text typed — the natural way to post a music note')
  await dis.evaluate(() => { window.__posts = 0; window.__body = ''; const of = window.fetch; window.fetch = (u, o) => { if (String(u).includes('/api/graphql')) { window.__posts++; window.__body = String(o?.body || '') } return of(u, o) } })
  // force: Playwright refuses to click aria-disabled elements, which is stricter than a browser.
  await dis.click('#shareD', { force: true })
  await dis.waitForTimeout(600)
  ok(await dis.evaluate(() => window.__posts === 1), 'clicking the dimmed share button with only a song attached posts the note')
  const posted = JSON.parse(new URLSearchParams(await dis.evaluate(() => window.__body)).get('variables')).request.additional_params.note_create_params
  ok(posted.note_style === 1 && posted.note_create_info.music_note_create_info.audio_cluster_id === '22' && posted.text === '', 'music note with empty text, correct cluster')
  await dis.close()

// ================================================================= 11. scale / 顯示比例
  // Every number content.js positions with comes from getBoundingClientRect(), which is CSS px in the
  // top-level layout viewport — device pixels never enter it. So a mutation only moves our UI if it
  // changes the MAPPING between "the anchor's CSS px rect" and "the CSS px that style.left /
  // style.top resolve in". Two classes:
  //   (i)  uniform — every element's rect is expressed in the same new CSS px (deviceScaleFactor,
  //        browser zoom, pinch zoom, viewport resize). Nothing can drift.
  //   (ii) differential — only the composer's side is scaled (an ancestor transform or CSS zoom).
  //        getBoundingClientRect is still one space, but `left` on an abspos child of the composer
  //        resolves in the composer's UNtransformed local space, so the delta is k times too big.
  // The chip is in neither class: it is parented INTO the anchor and placed by `bottom:100%`, so
  // the layout engine resolves it in the anchor's own space on every frame.

  /** One rAF can read a rect from before the override landed: the CDP metrics apply, the resize
   *  handler runs, and the compositor needs one more frame before getBoundingClientRect reports the
   *  new geometry. Two frames is a dependency, not a sleep. */
  const settle = async (pg) => {
    await pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  }

  /** Compact rects plus only the deltas the assertions read, so a failure prints one readable line. */
  const probe = async (pg, emojiId) => pg.evaluate((id) => {
    const r1 = (v) => Math.round(v * 10) / 10
    const R = (n) => { const b = n?.getBoundingClientRect(); if (!b) return null; return { l: r1(b.left), t: r1(b.top), r: r1(b.right), b: r1(b.bottom), w: r1(b.width), h: r1(b.height), cx: r1(b.left + b.width / 2), cy: r1(b.top + b.height / 2) } }
    const q = (s) => document.querySelector(s)
    const chip = q('[data-wimn-chip]')
    const shell = q('[data-wimn-shell]')
    const btn = shell || q('[data-wimn]')
    const emoji = document.getElementById(id)
    const anchor = chip?.parentElement || q('.lex-wrap')
    const c = R(chip), a = R(anchor), e = R(emoji), m = R(btn)
    return {
      dpr: window.devicePixelRatio, vw: innerWidth, vh: innerHeight,
      vv: Math.round(visualViewport.scale * 100) / 100,
      gapY: c && a ? Math.round(a.t - c.b) : null, // chip bottom -> anchor top; `bottom:100%` + 8px gap
      dxX: c && a ? Math.round(c.l - a.l) : null,   // left-aligned with the anchor
      inView: c ? c.l >= -1 && c.r <= innerWidth + 1 && c.t >= -1 && c.b <= innerHeight + 1 : null,
      anchorInView: a ? a.l >= -1 && a.r <= innerWidth + 1 && a.t >= -1 && a.b <= innerHeight + 1 : null,
      chipRect: c, anchorRect: a,
      gapX: m && e ? Math.round(e.l - m.r) : null,  // music button -> emoji control
      dyC: m && e ? Math.round(m.cy - e.cy) : null, // shared vertical centre
      nodes: { chip: document.querySelectorAll('[data-wimn-chip]').length, shell: document.querySelectorAll('[data-wimn-shell]').length, btn: document.querySelectorAll('[data-wimn]').length },
      // the chip must never live inside the editor: its own text would become part of the note
      inEditor: !!q('[contenteditable="true"] [data-wimn-chip], [data-lexical-editor="true"] [data-wimn-chip]'),
    }
  }, emojiId)

  /** The invariant: after ANY mutation the pair must translate TOGETHER. Absolute rects may move;
   *  the deltas between neighbours may not. Returns the failures; empty = pass. */
  const glue = (before, after, k = 1, tol = 2) => {
    const bad = []
    for (const key of ['chip', 'shell', 'btn']) if (after.nodes[key] !== 1) bad.push(key + '×' + after.nodes[key])
    if (after.inEditor) bad.push('chip is INSIDE the contenteditable')
    if (before.gapY === null || after.gapY === null) return bad.concat('chip/anchor not measurable')
    // Only meaningful while the anchor itself is on screen: scaling a full-viewport stage can push
    // the whole composer past an edge, and a chip glued to it goes with it.
    if (after.anchorInView && !after.inView) bad.push('chip off-viewport while its anchor is on it')
    const same = (a, b) => Math.abs(a / k - b) > tol
    if (same(after.gapY, before.gapY)) bad.push('chip↕gap ' + before.gapY + '→' + after.gapY)
    if (same(after.dxX, before.dxX)) bad.push('chip↔dx ' + before.dxX + '→' + after.dxX)
    if (after.gapX === null || after.dyC === null) return bad.concat('button/emoji not measurable')
    if (same(after.gapX, before.gapX)) bad.push('btn↔gapX ' + before.gapX + '→' + after.gapX)
    if (same(after.dyC, before.dyC)) bad.push('btn↔dyCentre ' + before.dyC + '→' + after.dyC)
    return bad
  }
  const line = (t, bad, p) => ok(bad.length === 0, t + (bad.length ? ' — ' + bad.join('; ') + ' :: ' + JSON.stringify(p) : ' [gapY ' + p.gapY + ' dxX ' + p.dxX + ' gapX ' + p.gapX + ' dyC ' + p.dyC + ' dpr ' + p.dpr + ' vp ' + p.vw + 'x' + p.vh + ']'))

  /** Absolute placement, checked on its own so a wrong "before" snapshot cannot mask a bad "after". */
  const absPlace = (p, k = 1) => {
    const bad = []
    if (p.gapY === null) return ['chip missing']
    if (p.gapY < 4 * k || p.gapY > 20 * k) bad.push('chip is ' + p.gapY + 'px from its anchor (want ' + 4 * k + '..' + 20 * k + ')')
    if (Math.abs(p.dxX) > 12 * k) bad.push('chip dx=' + p.dxX + ' (want |dx|<=' + 12 * k + ')')
    if (p.anchorInView && !p.inView) bad.push('chip outside the viewport while its anchor is on it')
    if (p.inEditor) bad.push('chip inside the contenteditable')
    if (p.gapX === null) return bad.concat('button missing')
    if (p.gapX < 4 * k || p.gapX > 32 * k) bad.push('button↔emoji gap ' + p.gapX + 'px (want ' + 4 * k + '..' + 32 * k + ')')
    if (Math.abs(p.dyC) > Math.max(1, k)) bad.push('button↔emoji centreΔ ' + p.dyC + 'px (want |Δ|<=' + Math.max(1, k) + ')')
    return bad
  }

  /** The notes composer inside a fixed full-viewport stage, so at scale 1 the geometry is identical
   *  to the bare fixture and any later difference is the mutation, not the wrapper. */
  const stageHtml = (emojiId, stageAttrs) => `<!doctype html><html lang="zh-Hant"><body>
    <div id="stage" style="position:fixed;inset:0;transform-origin:0 0;${stageAttrs || ''}">
    <div id="composer" style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:12px">
      ${lexicalInput('note-' + emojiId)}
      <div class="toolbar" style="display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px">
        <span class="grow" style="flex:1"></span>
        ${emojiControl(emojiId)}
        <div role="button" tabindex="0" class="${SHARE_CLS}" id="share-${emojiId}">分享</div>
      </div>
    </div></div><script>${stubFetch}</script></body></html>`

  const scalePage = async (emojiId, stageAttrs) => {
    const pg = await ctx.newPage()
    pg.on('pageerror', (e) => errors.push('scale: ' + String(e).slice(0, 160)))
    await pg.route(ROUTE, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: stageHtml(emojiId, stageAttrs) }))
    await pg.goto(ROUTE)
    await pg.waitForSelector('[data-wimn]', { timeout: 8000 })
    await pg.evaluate(() => document.querySelector('[data-wimn]').dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await pg.waitForSelector('#wimn-root .sheet', { timeout: 5000 })
    await pg.click('#wimn-root .row .main')
    await pg.waitForSelector('[data-wimn-chip]', { timeout: 3000 })
    await settle(pg)
    return pg
  }

  /** IG re-renders the composer's inner subtree. The markup goes as an ARG, not an evaluated
   *  string: Playwright compiles a string expression as a function body, so an inlined IIFE throws
   *  ReferenceError for its own identifiers. */
  const setInner = () => (arg) => { document.getElementById('composer').innerHTML = arg }
  const innerOf = (pg) => pg.evaluate(() => [...document.getElementById('composer').children].map((n) => n.outerHTML).join(''))
  /** What a React remount does: rebuild the subtree from scratch, so our own button is NOT in the
   *  markup and mount() has to run again from zero. */
  const FRESH = (id) => lexicalInput('note-' + id) +
    `<div class="toolbar" style="display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px">` +
    `<span class="grow" style="flex:1"></span>${emojiControl(id)}` +
    `<div role="button" tabindex="0" class="${SHARE_CLS}" id="share-${id}">分享</div></div>`

  const MUT = []
  /** k = the scale applied to the COMPOSER's side (1 = uniform mutation, nothing to normalise). */
  const mutate = (name, k, apply) => MUT.push({ name, k, apply })

  // 11a. deviceScaleFactor alone — a 顯示比例 change that does NOT reflow. The control case.
  mutate('CDP deviceScaleFactor 1→2 (no reflow)', 1, async (pg) => {
    const vp = pg.viewportSize()
    const s = await pg.context().newCDPSession(pg)
    await s.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: false })
    await settle(pg)
  })

  // 11b. real browser zoom at a fixed physical window: dpr×k AND the CSS viewport ÷k.
  for (const k of [1.25, 1.5, 2]) {
    mutate('browser zoom ' + Math.round(k * 100) + '% (viewport÷k, dpr×k)', 1, async (pg) => {
      const vp = pg.viewportSize()
      const s = await pg.context().newCDPSession(pg)
      await s.send('Emulation.setDeviceMetricsOverride', { width: Math.round(vp.width / k), height: Math.round(vp.height / k), deviceScaleFactor: k, mobile: false })
      await settle(pg)
    })
  }

  // 11c. pinch zoom — visual viewport only; getBoundingClientRect does not see it.
  mutate('CDP Emulation.setPageScaleFactor 2 (pinch zoom)', 1, async (pg) => {
    const s = await pg.context().newCDPSession(pg)
    await s.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 })
    await settle(pg)
  })

  // 11d. plain window resize.
  mutate('page.setViewportSize 900×700', 1, async (pg) => {
    await pg.setViewportSize({ width: 900, height: 700 })
    await settle(pg)
  })

  // 11e. DIFFERENTIAL: only the composer is scaled. transform-origin 0 0 keeps it linear.
  for (const k of [1.25, 1.5]) {
    mutate('ancestor transform:scale(' + k + ') + resize event', k, async (pg) => {
      await pg.evaluate((f) => { document.getElementById('stage').style.transform = 'scale(' + f + ')'; dispatchEvent(new Event('resize')) }, k)
      await settle(pg)
    })
  }
  mutate('ancestor transform:scale(1.5), NO event fired', 1.5, async (pg) => {
    await pg.evaluate(() => { document.getElementById('stage').style.transform = 'scale(1.5)' })
    await settle(pg)
  })
  mutate('ancestor transform:scale(1.25) origin 50% 50% + resize', 1.25, async (pg) => {
    await pg.evaluate(() => { const s = document.getElementById('stage'); s.style.transformOrigin = '50% 50%'; s.style.transform = 'scale(1.25)'; dispatchEvent(new Event('resize')) })
    await settle(pg)
  })

  // 11f. DIFFERENTIAL via CSS zoom on the composer side. zoom on <html> would zoom the overlay host
  //  too, which is not something a real page does — kept only because it isolates the old clamp bug.
  for (const k of [1.25, 1.5]) {
    mutate('CSS zoom:' + k + ' on the composer only + resize event', k, async (pg) => {
      await pg.evaluate((f) => { document.getElementById('stage').style.zoom = f; dispatchEvent(new Event('resize')) }, k)
      await settle(pg)
    })
  }
  mutate('CSS zoom:1.5 on <html> (overlay host zoomed too)', 1.5, async (pg) => {
    await pg.evaluate(() => { document.documentElement.style.zoom = '1.5'; dispatchEvent(new Event('resize')) })
    await settle(pg)
  })

  console.log('\n--- 11. scale / 顯示比例 ---------------------------------------------')
  for (const m of MUT) {
    const id = 's' + MUT.indexOf(m)
    const pg = await scalePage(id)
    const before = await probe(pg, id)
    await m.apply(pg)
    const after = await probe(pg, id)
    line(m.name + ' — stayed glued', glue(before, after, m.k), after)
    line(m.name + ' — correct placement (chip 4..20px above its anchor, button beside the emoji control)', absPlace(after, m.k), after)
    await pg.evaluate(setInner(), await innerOf(pg))
    await pg.waitForTimeout(260) // the 120ms mount debounce, then one batch
    await settle(pg)
    const after2 = await probe(pg, id)
    line(m.name + ' — still glued + single nodes after the composer subtree re-renders', glue(before, after2, m.k), after2)
    await pg.close()
  }

  // 11g. the composer subtree rebuilt from scratch — what a React remount really does.
  {
    const id = 'sFresh'
    const pg = await scalePage(id)
    const before = await probe(pg, id)
    await pg.evaluate(setInner(), FRESH(id))
    await pg.waitForTimeout(320)
    await settle(pg)
    const after = await probe(pg, id)
    ok(after.nodes.shell === 1 && after.nodes.btn === 1 && after.nodes.chip === 1, 'composer subtree rebuilt from scratch: one shell / one button / one chip — ' + JSON.stringify(after.nodes))
    ok((await pg.textContent('[data-wimn-chip]')).includes('Yellow'), 'the attached song survives the rebuild')
    line('composer subtree rebuilt from scratch — chip re-parents onto the new anchor', glue(before, after), after)
    await pg.close()
  }

  // 11h. the composer NODE ITSELF replaced, carrying our own button into the new markup
  // (outerHTML round-trip): mount() early-returns on the existing [data-wimn], so any cached
  // wrapper state would be measuring a node that is no longer in the document.
  {
    const id = 'sSwap'
    const pg = await scalePage(id)
    const before = await probe(pg, id)
    await pg.evaluate(() => { const c = document.getElementById('composer'); c.outerHTML = c.outerHTML })
    await pg.waitForTimeout(320)
    await settle(pg)
    const after = await probe(pg, id)
    ok(after.nodes.shell === 1 && after.nodes.btn === 1 && after.nodes.chip === 1, 'composer node replaced: one shell / one button / one chip — ' + JSON.stringify(after.nodes))
    line('composer node replaced (outerHTML round-trip) — chip re-parents, button stays welded', glue(before, after), after)
    await pg.close()
  }

  // 11i. a scale change landing WHILE the composer re-renders: worst case for a stale measurement.
  {
    const id = 'sRace'
    const pg = await scalePage(id)
    const before = await probe(pg, id)
    const s = await pg.context().newCDPSession(pg)
    await pg.evaluate(setInner(), FRESH(id))
    await s.send('Emulation.setDeviceMetricsOverride', { width: Math.round(pg.viewportSize().width / 1.5), height: Math.round(pg.viewportSize().height / 1.5), deviceScaleFactor: 1.5, mobile: false })
    await pg.waitForTimeout(300)
    await settle(pg)
    const after = await probe(pg, id)
    line('150% zoom applied WHILE the composer re-renders', glue(before, after), after)
    await pg.close()
  }
  // ================================================================= 12. the userscript build
  // Everything above exercises content.js as a content script. The userscript is a different ARTIFACT —
  // one file, GM_* instead of sendMessage, and no DNR rule to put the User-Agent on a request — so
  // the generated file itself is loaded here, with GM stubs, and has to mount, search, attach a song
  // and post on its own. A bridge that works in a unit sandbox and fails in a page is still broken.
  const usCtx = await browser.newContext()
  const gmStubs = `
  window.__gm = { xhr: [], cookie: 0, saved: {}, stored: 0 }
  window.GM_getValue = (k, d) => (k in window.__gm.saved ? window.__gm.saved[k] : d)
  window.GM_setValue = (k, v) => { window.__gm.saved[k] = v; window.__gm.stored++ }
  window.GM_cookie = (details, cb) => { window.__gm.cookie++; cb && cb({ ...details, value: '123%3Aabc%3Adef' }) }
  window.GM_xmlhttpRequest = (d) => {
    window.__gm.xhr.push({ url: d.url, ua: d.headers['User-Agent'], anonymous: d.anonymous })
    // delegate to the page's stubbed fetch: the fixture answers the shelf/search/graphql shapes
    window.fetch(d.url, { method: d.method, headers: d.headers, body: d.data }).then(
      (r) => r.text().then((t) => d.onload({ status: r.status, finalUrl: d.url, responseText: t })),
      () => d.onerror && d.onerror(),
    )
  }`
  await usCtx.addInitScript({ content: gmStubs })
  await usCtx.addInitScript({ content: readFileSync(EXT + '/wimn.user.js', 'utf8') })
  const us = await usCtx.newPage()
  us.on('pageerror', (e) => errors.push('userscript: ' + String(e).slice(0, 160)))
  await us.route(ROUTE, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: composer({ emojiId: 'emojiU', shareId: 'shareU' }) }))
  await us.goto(ROUTE)
  await us.waitForSelector('[data-wimn]', { timeout: 8000 })
  ok(true, 'the generated userscript mounts the music button with GM_* only')
  await us.evaluate(() => document.querySelector('[data-wimn]').dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await us.waitForSelector('#wimn-root .sheet', { timeout: 5000 })
  ok(await us.evaluate(() => [...document.querySelectorAll('#wimn-root .row')].length > 0), 'the shelf loads through GM_xmlhttpRequest')
  await us.click('#wimn-root .row .main')
  await us.waitForSelector('[data-wimn-chip]', { timeout: 3000 })
  ok(true, 'attaching a track renders the chip')
  const gmInfo = await us.evaluate(() => ({
    xhr: window.__gm.xhr.length,
    cookie: window.__gm.cookie,
    stored: window.__gm.stored,
    ua: window.__gm.xhr.find((x) => x.url.startsWith('https://i.instagram.com/'))?.ua || '',
    anon: window.__gm.xhr.filter((x) => x.url.startsWith('https://i.instagram.com/')).every((x) => x.anonymous === false),
    // the config mirrors are GM requests too — instagram.com's CSP connect-src would block a plain
    // fetch of them, which is why the UA silently rotted at the bundled version before
    // The count of plain fetches is NOT checked here: this stub delegates GM_xmlhttpRequest to the
    // page's stubbed fetch, so the fixture's own call log records the delegation too. test.mjs
    // checks that path properly, with a fetch stub of its own that only the bridge can reach.
    mirrors: window.__gm.xhr.filter((x) => x.url.includes('config.py')).length,
  }))
  ok(gmInfo.xhr > 0, 'the music calls went out as GM requests: ' + gmInfo.xhr)
  ok(gmInfo.mirrors === 3, 'and so do the three config mirrors, which a plain fetch could not reach through the page CSP: ' + gmInfo.mirrors)
  ok(gmInfo.ua.startsWith('Instagram 999.0.0.1 Android (34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky; en_US; 1234567890)'),
    'and carried the Android User-Agent parsed out of config.py on the request itself: ' + gmInfo.ua.slice(0, 40) + '…')
  ok(gmInfo.anon, 'with cookies attached (anonymous: false)')
  ok(gmInfo.cookie > 0, 'GM_cookie was consulted for the HttpOnly sessionid')
  ok(gmInfo.stored > 0, 'the UA config was persisted to GM storage')
  await us.evaluate(() => { window.__posts = 0; window.__body = ''; const of = window.fetch; window.fetch = (u, o) => { if (String(u).includes('/api/graphql')) { window.__posts++; window.__body = String(o?.body || '') } return of(u, o) } })
  await us.click('#shareU')
  await us.waitForTimeout(600)
  const usPosted = await us.evaluate(() => (window.__posts ? JSON.parse(new URLSearchParams(window.__body).get('variables')).request.additional_params.note_create_params : null))
  ok(usPosted?.note_style === 1 && !!usPosted?.note_create_info?.music_note_create_info?.audio_cluster_id, 'the userscript publishes a music note through the native share button')
  await us.close()
  await usCtx.close()

  // ================================================================= 13. the button must appear
  // DURING IG's first-paint burst, not after it
  // A 120ms debounce that resets on every mutation never fires while mutations keep arriving, and
  // IG's initial paint is exactly that. This drives a 2s mutation burst and requires the button to be
  // there well before it ends — the report was "the music button loads late too".
  const burst = await ctx.newPage()
  burst.on('pageerror', (e) => errors.push('burst: ' + String(e).slice(0, 160)))
  await burst.route(ROUTE, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: composer({ emojiId: 'emojiB', shareId: 'shareB' }) }))
  const t0 = Date.now()
  await burst.goto(ROUTE)
  // a mutation every animation frame for 2s — the shape of a hydrating SPA
  await burst.evaluate(() => {
    window.__burstEnd = performance.now() + 2000
    const tick = () => {
      const d = document.createElement('div')
      d.textContent = 'x'
      document.body.append(d)
      if (performance.now() < window.__burstEnd) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await burst.waitForSelector('[data-wimn]', { timeout: 3000 })
  const appeared = Date.now() - t0
  const stillBursting = await burst.evaluate(() => performance.now() < window.__burstEnd)
  ok(appeared < 700, 'the button appears while mutations are still arriving: +' + appeared + 'ms of a 2000ms burst')
  ok(stillBursting, 'and it was genuinely mid-burst, not on the quiet tail')
  await burst.close()

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''))
  await page.close()
  await browser.close()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})()