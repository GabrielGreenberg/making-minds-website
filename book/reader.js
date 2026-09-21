/* Making Minds · web reader
   Reads book/manifest.json (structure, files, sections) and renders the chapter PDFs with pdf.js in a
   continuous, lazily rendered scroll with a selectable text layer. The sidebar is the live table of contents;
   whole-book search runs over book/search.json. Position is in the URL hash and remembered in localStorage.
   Hash forms: #contents · #front · #ps · #ch12 · #p33 · #p22,683 (page + y in slide points from the top). */
import * as pdfjsLib from './pdfjs/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdfjs/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
const el = { main: $('main'), side: $('side'), backdrop: $('backdrop'), menu: $('menu'), crumb: $('crumb'), pageno: $('pageno'),
  zoom: $('zoom'), q: $('q'), qclear: $('qclear'), toc: $('toc'), results: $('results'), sidefoot: $('sidefoot'),
  landing: $('landing'), cover: $('coverimg'), actions: $('actions'), updated: $('updated'), doc: $('doc'), pages: $('pages'),
  chapnav: $('chapnav'), status: $('status') };
const PW = 1460, PH = 1888, PAGE_MAX = 1000;
const store = {
  get(k, d) { try { const v = localStorage.getItem('mm.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('mm.' + k, JSON.stringify(v)); } catch (e) { /* private mode etc. */ } }
};
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let M = null;                 // manifest
let docs = [];                // reading order: front, chapters…, problem sets
let byId = {};
let cur = null;               // {doc, pdf, scale, pw, ph, pages:[{i, p, el, pdfPage, renderedScale, rendering, task}], gen}
let gen = 0;
let zoom = +store.get('zoom', 1) || 1;
let lastCurId = null;         // which document the sidebar last marked current (chevron auto-open resets on change)
let observer = null;
let searchIndex = null, searchLoading = null;
let hl = null;                // {page, y, tokens}: what to highlight once that page renders (after a search click)
let fromSearch = false;
let curPage = null, curSection = null;

// ---------------------------------------------------------------- manifest → model
function buildModel(m) {
  M = m; docs = []; byId = {};
  const units = {}; m.units.forEach((u) => { units[u.n] = u; });
  if (m.front) docs.push({ id: 'front', kind: 'front', label: 'Front matter', title: 'Front matter', file: m.front.file,
    filePages: m.front.pages, pages: m.front.pages, sections: [] });
  m.chapters.forEach((c) => {
    docs.push({ id: c.id, kind: 'ch', n: c.n, unit: c.unit, unitName: units[c.unit] ? units[c.unit].name : '', title: c.title,
      label: c.n + '. ' + c.title, file: c.file, filePages: c.filePages || c.pages, pages: c.pages, sections: c.sections || [] });
  });
  if (m.problemSets) docs.push({ id: 'ps', kind: 'ps', label: 'Problem sets', title: m.problemSets.title || 'Problem Sets',
    file: m.problemSets.file, filePages: m.problemSets.pages, pages: m.problemSets.pages, sections: m.problemSets.sections || [] });
  docs.forEach((d, i) => { d.index = i; byId[d.id] = d; });
}
const chapterByN = (n) => docs.find((d) => d.kind === 'ch' && d.n === n);
const docByPage = (p) => docs.find((d) => p >= d.filePages[0] && p <= d.filePages[1]);
function hashFor(d) { return d.kind === 'ch' ? '#ch' + d.n : '#' + d.id; }
// the last changelog entry as "ch. 4, 7", "problem sets", "front matter" …
function lastUpdate() {
  const last = (M.changelog || []).slice(-1)[0];
  if (!last) return null;
  const parts = [];
  if (last.chapters && last.chapters.length) parts.push('ch. ' + last.chapters.join(', '));
  (last.other || []).forEach((o) => { if (o === 'ps') parts.push('problem sets'); });   // the cover's date changes every build: not news
  return parts.length ? { date: last.date, what: parts.join(' · ') } : null;
}
function fmtDate(iso) { const p = iso.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2], 12).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

// ---------------------------------------------------------------- sidebar
function buildToc() {
  let h = '';
  const front = byId.front;
  if (front) h += '<a class="front" href="#front" data-id="front">Front matter <span class="dim">· cover, contents</span></a>';
  M.units.forEach((u) => {
    h += '<div class="unit" style="--uc:var(--u' + u.n + ')"><button class="tog" type="button" aria-expanded="true" aria-label="Fold unit ' + u.n + '"></button><span class="un">Unit ' + u.n + '</span><span class="ut">' + esc(u.name) + '</span></div><ol>';
    u.chapters.forEach((n) => { const d = chapterByN(n); if (d) h += tocItem(d, 'var(--u' + u.n + ')'); });
    h += '</ol>';
  });
  if (byId.ps) h += '<ol class="ps">' + tocItem(byId.ps, 'var(--accent)') + '</ol>';
  el.toc.innerHTML = h;
  let foot = '<a href="' + esc(M.wholeBook) + '" target="_blank" rel="noopener">Download the whole book (PDF)</a>';
  const upd = lastUpdate();
  if (upd) foot += '<span class="new">Updated <b>' + esc(fmtDate(upd.date)) + '</b> · ' + esc(upd.what) + '</span>';
  el.sidefoot.innerHTML = foot;
}
function tocItem(d, color) {
  const n = d.kind === 'ch' ? d.n : (d.kind === 'ps' ? 'PS' : '');
  const has = d.sections.length > 0;
  let h = '<li class="ch" data-id="' + esc(d.id) + '" style="--uc:' + color + '"><div class="row">' +
    '<button class="tog' + (has ? '' : ' none') + '" type="button" aria-expanded="false" aria-label="Show sections of ' + esc(d.label) + '"' + (has ? '' : ' tabindex="-1"') + '></button>' +
    '<a href="' + hashFor(d) + '"><span class="n">' + n + '</span><span class="t">' + esc(d.title) + '</span></a></div>';
  if (has) {
    h += '<div class="secs">' + d.sections.map((s, i) => '<a href="#p' + s.page + ',' + Math.round(s.y) + '" data-sec="' + i + '"' + (s.l === 3 ? ' class="l3"' : '') + '>' + esc(s.title) + '</a>').join('') + '</div>';
  }
  return h + '</li>';
}
// a chapter's sections show when it is the current chapter (unless folded shut) or was folded open by hand
function secsVisible(li) { return li.classList.contains('open') || (li.classList.contains('cur') && !li.classList.contains('closed')); }
function syncTogs() {
  el.toc.querySelectorAll('.ch').forEach((li) => { const t = li.querySelector('.tog'); if (t) t.setAttribute('aria-expanded', secsVisible(li) ? 'true' : 'false'); });
}
function toggleChapter(li) {
  if (secsVisible(li)) { li.classList.remove('open'); if (li.classList.contains('cur')) li.classList.add('closed'); }
  else { li.classList.add('open'); li.classList.remove('closed'); }
  syncTogs();
}
function toggleUnit(unitEl) {
  const closed = unitEl.classList.toggle('closed');
  unitEl.querySelector('.tog').setAttribute('aria-expanded', closed ? 'false' : 'true');
}
function markCurrent(d, secIndex) {
  el.toc.querySelectorAll('.cur').forEach((x) => x.classList.remove('cur'));
  if ((d && d.id) !== lastCurId) {           // a new chapter: its sections unfold, hand-folded states of others are kept
    el.toc.querySelectorAll('.ch.closed').forEach((x) => x.classList.remove('closed'));
    lastCurId = d ? d.id : null;
  }
  if (!d) { syncTogs(); return; }
  const li = el.toc.querySelector('[data-id="' + CSS.escape(d.id) + '"]');
  if (!li) { syncTogs(); return; }
  li.classList.add('cur');
  syncTogs();
  if (secIndex != null) { const a = li.querySelector('[data-sec="' + secIndex + '"]'); if (a) { a.classList.add('cur'); keepInView(a); } }
  else keepInView(li.querySelector('.row a') || li);
}
function keepInView(node) {
  if (!node || el.results.hidden === false || node.offsetParent === null) return;
  const r = node.getBoundingClientRect(), s = el.side.getBoundingClientRect();
  if (r.top < s.top + 70 || r.bottom > s.bottom - 20) node.scrollIntoView({ block: 'center' });
}
function openSide(on) { el.side.classList.toggle('open', on); el.backdrop.classList.toggle('on', on); el.menu.setAttribute('aria-expanded', on ? 'true' : 'false'); }

// ---------------------------------------------------------------- landing
function showLanding() {
  gen++; cur = null; curPage = null; curSection = null;
  el.doc.hidden = true; el.status.hidden = true; el.landing.hidden = false;
  el.cover.src = M.cover;
  const last = store.get('lastPos', null);
  const first = chapterByN(1) || docs[0];
  let h = '';
  const ld = last && byId[last.id];
  if (ld && last.page) h += '<a class="cont" href="#p' + last.page + '">Continue <span class="sub">· ' + esc(ld.label) + ', p. ' + last.page + '</span></a>';
  h += '<a class="' + (ld ? '' : 'primary') + '" href="' + hashFor(first) + '">Start reading <span class="sub">· ' + esc(first.label) + '</span></a>';
  h += '<a class="contents" href="#" data-act="contents">Contents</a>';
  h += '<a href="' + esc(M.wholeBook) + '" target="_blank" rel="noopener">Download PDF</a>';
  el.actions.innerHTML = h;
  const upd = lastUpdate();
  el.updated.innerHTML = 'Book pages 1–' + M.bookPages + (M.problemSets ? ' · problem sets ' + M.problemSets.pages[0] + '–' + M.problemSets.pages[1] : '') +
    (upd ? ' · <b>updated ' + esc(fmtDate(upd.date)) + '</b>: ' + esc(upd.what) : '');
  el.crumb.innerHTML = '<span class="cur">Contents</span>';
  el.pageno.textContent = '';
  document.title = 'Making Minds · Read';
  markCurrent(null);
  el.main.scrollTop = 0;
}

// ---------------------------------------------------------------- document view
function fitWidth() {
  const w = el.main.clientWidth - (window.innerWidth <= 900 ? 16 : 32);
  return Math.max(200, Math.min(w, PAGE_MAX));
}
function layout() {
  if (!cur) return;
  cur.pw = Math.round(fitWidth() * zoom); cur.ph = Math.round(cur.pw * PH / PW); cur.scale = cur.pw / PW;
  el.pages.style.setProperty('--pw', cur.pw + 'px'); el.pages.style.setProperty('--ph', cur.ph + 'px');
  cur.pages.forEach((pg) => { pg.el.style.setProperty('--scale-factor', cur.scale); });
}
async function openDoc(d, target) {
  if (cur && cur.doc === d) { scrollTo(target); return; }
  gen++; const g = gen;
  cur = { doc: d, pdf: null, pages: [], gen: g, scale: 1, pw: 0, ph: 0 };
  curPage = null; curSection = null;
  el.landing.hidden = true; el.doc.hidden = false; el.status.hidden = true;
  el.pages.innerHTML = ''; el.chapnav.innerHTML = '';
  if (observer) observer.disconnect();
  const n = d.filePages[1] - d.filePages[0] + 1;
  for (let i = 0; i < n; i++) {
    const p = d.filePages[0] + i;
    const div = document.createElement('div'); div.className = 'pg'; div.dataset.p = p; div.setAttribute('aria-label', 'Page ' + p);
    div.innerHTML = '<span class="pnum">' + p + '</span>';
    el.pages.appendChild(div);
    cur.pages.push({ i, p, el: div, pdfPage: null, renderedScale: null, rendering: false, task: null });
  }
  layout();
  updateCrumb(d, null); markCurrent(d, null);
  document.title = d.label + ' · Making Minds';
  const prev = docs[d.index - 1], next = docs[d.index + 1];
  el.chapnav.innerHTML = (prev ? '<a class="prev" href="' + hashFor(prev) + '"><span class="k">Previous</span><span>' + esc(prev.label) + '</span></a>' : '') +
    (next ? '<a class="next" href="' + hashFor(next) + '"><span class="k">Next</span><span>' + esc(next.label) + '</span></a>' : '');
  scrollTo(target);
  observer = new IntersectionObserver(onIntersect, { root: el.main, rootMargin: '120% 0px', threshold: 0 });
  cur.pages.forEach((pg) => observer.observe(pg.el));
  try {
    const pdf = await pdfjsLib.getDocument({ url: d.file }).promise;
    if (gen !== g) { pdf.destroy(); return; }
    cur.pdf = pdf;
    if (pdf.numPages !== n) console.warn('page count mismatch', d.file, pdf.numPages, n);
    cur.pages.forEach((pg) => { if (pg.near) renderPage(pg); });
  } catch (err) {
    if (gen !== g) return;
    el.status.hidden = false; el.status.textContent = 'Couldn’t load ' + d.file + ' (' + (err && err.message || err) + ').';
  }
}
function pageTop(p) { const pg = cur && cur.pages[p - cur.doc.filePages[0]]; return pg ? pg.el.offsetTop : 0; }
function scrollTo(t) {
  if (!cur) return;
  let y;
  if (t && t.page) {
    y = pageTop(t.page);
    if (t.y != null) y += t.y / PH * cur.ph - 110; else y -= 12;
  } else y = pageTop(cur.doc.pages[0]) - 12;
  el.main.scrollTop = Math.max(0, y);
  onScroll();
}
function onIntersect(entries) {
  if (!cur) return;
  entries.forEach((e) => { const pg = cur.pages[+e.target.dataset.p - cur.doc.filePages[0]]; if (pg) pg.near = e.isIntersecting; });
  cur.pages.forEach((pg) => {
    if (pg.near) renderPage(pg);
    else if (pg.renderedScale != null && Math.abs(pg.p - (curPage || 0)) > 4) releasePage(pg);
  });
}
function releasePage(pg) {
  if (pg.task) { try { pg.task.cancel(); } catch (e) {} pg.task = null; }
  pg.el.querySelectorAll('canvas, .textLayer').forEach((x) => x.remove());
  pg.renderedScale = null; pg.rendering = false;
}
async function renderPage(pg) {
  if (!cur || !cur.pdf || pg.rendering || pg.renderedScale === cur.scale) return;
  const g = gen, scale = cur.scale;
  pg.rendering = true;
  try {
    if (!pg.pdfPage) pg.pdfPage = await cur.pdf.getPage(pg.i + 1);
    if (gen !== g) return;
    const page = pg.pdfPage;
    const viewport = page.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr); canvas.height = Math.floor(viewport.height * dpr);
    const ctx = canvas.getContext('2d', { alpha: false });
    pg.task = page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
    await pg.task.promise; pg.task = null;
    if (gen !== g || cur.scale !== scale) { pg.rendering = false; if (gen === g) renderPage(pg); return; }
    pg.el.querySelectorAll('canvas').forEach((x) => x.remove());
    pg.el.prepend(canvas);
    const tl = document.createElement('div'); tl.className = 'textLayer';
    pg.el.querySelectorAll('.textLayer').forEach((x) => x.remove());
    pg.el.appendChild(tl);
    const textLayer = new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport });
    await textLayer.render();
    const eoc = document.createElement('div'); eoc.className = 'endOfContent'; tl.appendChild(eoc);
    pg.renderedScale = scale; pg.rendering = false;
    if (hl) highlightPage(pg);
  } catch (err) {
    pg.rendering = false;
    if (err && err.name !== 'RenderingCancelledException') console.warn('render', pg.p, err);
  }
}
function rerenderAll() {
  if (!cur) return;
  const keepPage = curPage, keepFrac = keepPage ? (el.main.scrollTop - pageTop(keepPage)) / Math.max(1, cur.ph) : 0;
  layout();
  cur.pages.forEach((pg) => { if (pg.renderedScale != null) releasePage(pg); });
  if (keepPage) el.main.scrollTop = pageTop(keepPage) + keepFrac * cur.ph;
  cur.pages.forEach((pg) => { if (pg.near) renderPage(pg); });
  onScroll();
}

// ---------------------------------------------------------------- position tracking
let scrollPending = false;
function onScroll() {
  if (scrollPending) return;
  scrollPending = true;
  requestAnimationFrame(() => { scrollPending = false; trackPosition(); });
}
function trackPosition() {
  if (!cur || !cur.pages.length) return;
  const st = el.main.scrollTop, mid = st + el.main.clientHeight * 0.45;
  let page = cur.pages[0];
  for (const pg of cur.pages) { if (pg.el.offsetTop <= mid) page = pg; else break; }
  const d = cur.doc;
  let sec = null, secIndex = null;
  const probe = st + 130;
  d.sections.forEach((s, i) => {
    if (s.page > page.p) return;
    const y = pageTop(s.page) + s.y / PH * cur.ph;
    if (y <= probe) { sec = s; secIndex = i; }
  });
  if (page.p !== curPage) {
    curPage = page.p;
    el.pageno.textContent = 'p. ' + page.p + ' of ' + (d.kind === 'ps' ? M.totalPages : M.bookPages);
    if (page.p >= d.pages[0]) {
      store.set('lastPos', { id: d.id, page: page.p });
      history.replaceState(null, '', '#p' + page.p);
    } else history.replaceState(null, '', hashFor(d));
  }
  if (sec !== curSection || page.p !== curPage) {
    curSection = sec;
    updateCrumb(d, sec); markCurrent(d, secIndex);
  }
}
function updateCrumb(d, sec) {
  let h = '';
  if (d.kind === 'ch') h += '<a class="unit" style="--uc:var(--u' + d.unit + ')" href="#contents">Unit ' + d.unit + '</a><span class="sep">›</span>';
  h += '<a class="' + (sec ? '' : 'cur') + '" href="' + hashFor(d) + '">' + esc(d.label) + '</a>';
  if (sec) h += '<span class="sep">›</span><span class="cur">' + esc(sec.title) + '</span>';
  el.crumb.innerHTML = h;
}

// ---------------------------------------------------------------- routing
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!fromSearch) hl = null; fromSearch = false;
  let m;
  if (!h || h === 'contents') { showLanding(); }
  else if ((m = h.match(/^ch(\d+)$/))) { const d = chapterByN(+m[1]); if (d) openDoc(d, { page: d.pages[0] }); else showLanding(); }
  else if (h === 'front' && byId.front) openDoc(byId.front, { page: byId.front.pages[0] });
  else if (h === 'ps' && byId.ps) openDoc(byId.ps, { page: byId.ps.pages[0] });
  else if ((m = h.match(/^p(\d+)(?:,(\d+(?:\.\d+)?))?$/))) {
    const p = +m[1], d = docByPage(p);
    if (d) openDoc(d, { page: p, y: m[2] != null ? +m[2] : null }); else showLanding();
  } else showLanding();
  if (window.innerWidth <= 900) openSide(false);
}

// ---------------------------------------------------------------- search
function tokens(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}
// a query word matches a book word exactly, or as a prefix once it is 3+ letters ("transition" finds "transitions")
const tokMatch = (w, q) => w === q || (q.length >= 3 && w.startsWith(q));
function loadSearch() {
  if (searchIndex || searchLoading) return searchLoading;
  searchLoading = fetch('search.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((j) => {
    j.pages.forEach((p) => { p.b.forEach((b) => { b.push(tokens(b[2])); }); });
    searchIndex = j; return j;
  });
  return searchLoading;
}
function runSearch(q) {
  const toks = tokens(q);
  if (!toks.length) { closeResults(); return; }
  if (!searchIndex) { el.results.hidden = false; el.toc.hidden = true; el.results.innerHTML = '<div class="rs-head">Loading the index…</div>'; loadSearch().then(() => { if (el.q.value === q) runSearch(q); }); return; }
  const hits = [];
  for (const p of searchIndex.pages) {
    const d = docByPage(p.p); if (!d) continue;
    for (const b of p.b) {
      const bt = b[3];
      let phrase = false;
      if (toks.length > 1) {
        for (let i = 0; i + toks.length <= bt.length && !phrase; i++) { let ok = true; for (let k = 0; k < toks.length; k++) if (!tokMatch(bt[i + k], toks[k])) { ok = false; break; } phrase = ok; }
      } else phrase = bt.some((w) => tokMatch(w, toks[0]));
      const all = phrase || toks.every((t) => bt.some((w) => tokMatch(w, t)));
      if (all) hits.push({ p: p.p, y: b[0], t: b[2], phrase, d });
      if (hits.length > 400) break;
    }
  }
  hits.sort((a, b) => (b.phrase - a.phrase) || (a.p - b.p) || (a.y - b.y));
  const shown = hits.slice(0, 150);
  el.toc.hidden = true; el.results.hidden = false; el.qclear.hidden = false;
  if (!shown.length) { el.results.innerHTML = '<div class="none">No matches for “' + esc(q) + '”.</div>'; return; }
  const re = new RegExp('\\b(' + toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  let h = '<div class="rs-head">' + hits.length + (hits.length > 150 ? ' matches (first 150)' : hits.length === 1 ? ' match' : ' matches') + '</div>';
  // group by document in book order for the phrase group and the rest separately
  let lastKey = null;
  shown.forEach((x) => {
    const key = (x.phrase ? 'P' : 'A') + x.d.id;
    if (key !== lastKey) { lastKey = key; h += '<div class="rs-ch"><span class="n">' + (x.d.kind === 'ch' ? x.d.n : (x.d.kind === 'ps' ? 'PS' : '')) + '</span>' + esc(x.d.title) + (x.phrase ? '' : ' <span class="dim">(words)</span>') + '</div>'; }
    const sec = sectionAt(x.d, x.p, x.y);
    h += '<a class="hit" href="#p' + x.p + ',' + Math.round(x.y) + '" data-q="' + esc(q) + '"><span class="where">' + (sec ? esc(sec.title) + ' · ' : '') + '<span class="p">p. ' + x.p + '</span></span>' + snippet(x.t, re) + '</a>';
  });
  el.results.innerHTML = h;
}
function sectionAt(d, p, y) {
  let best = null;
  d.sections.forEach((s) => { if (s.l === 3) return; if (s.page < p || (s.page === p && s.y <= y + 40)) best = s; });
  return best;
}
function snippet(t, re) {
  re.lastIndex = 0;
  const m = re.exec(t);
  let start = 0, end = t.length;
  if (m && t.length > 160) { start = Math.max(0, m.index - 60); end = Math.min(t.length, m.index + 110); }
  let s = t.slice(start, end);
  if (start > 0) s = '…' + s.replace(/^\S*\s/, ''); if (end < t.length) s = s.replace(/\s\S*$/, '') + '…';
  return esc(s).replace(re, '<mark>$1</mark>');
}
function closeResults() {
  el.results.hidden = true; el.toc.hidden = false; el.qclear.hidden = true; el.results.innerHTML = '';
  if (cur) markCurrent(cur.doc, curSection ? cur.doc.sections.indexOf(curSection) : null);
}
function highlightPage(pg) {
  const tl = pg.el.querySelector('.textLayer'); if (!tl || !hl || pg.p !== hl.page) return;
  const escd = hl.tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const spans = [...tl.querySelectorAll('span')].map((s) => ({ s, t: s.textContent.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ''), y: s.offsetTop / Math.max(1, cur.ph) * PH }));
  // candidates: the hit's own paragraph first (spans within ~150 pt of its top), then the whole page;
  // tests: the whole phrase in one span, then every word in one span, then any word
  const tests = [];
  if (escd.length > 1) {
    const phrase = new RegExp('\\b' + escd.join('\\W+'), 'i');
    tests.push((t) => phrase.test(t));
    const each = escd.map((e) => new RegExp('\\b' + e, 'i'));
    tests.push((t) => each.every((re) => re.test(t)));
  }
  const any = new RegExp('\\b(' + escd.join('|') + ')', 'i');
  tests.push((t) => any.test(t));
  const near = hl.y != null ? spans.filter((x) => x.y >= hl.y - 30 && x.y <= hl.y + 150) : [];
  for (const pool of (near.length ? [near, spans] : [spans])) {
    for (const ok of tests) {
      const hit = pool.filter((x) => ok(x.t));
      if (hit.length) { hit.forEach((x) => x.s.classList.add('hl')); return; }
    }
  }
}
function clearHighlights() { el.pages.querySelectorAll('.textLayer span.hl').forEach((s) => s.classList.remove('hl')); }

// ---------------------------------------------------------------- events
function wire() {
  window.addEventListener('hashchange', route);
  el.main.addEventListener('scroll', onScroll, { passive: true });
  new ResizeObserver(() => { if (cur) { const w = Math.round(fitWidth() * zoom); if (w !== cur.pw) rerenderAll(); } }).observe(el.main);
  el.zoom.value = String(zoom);
  el.zoom.addEventListener('change', () => { zoom = +el.zoom.value || 1; store.set('zoom', zoom); rerenderAll(); });
  el.menu.addEventListener('click', () => openSide(!el.side.classList.contains('open')));
  el.backdrop.addEventListener('click', () => openSide(false));
  el.actions.addEventListener('click', (e) => { const a = e.target.closest('a[data-act="contents"]'); if (a) { e.preventDefault(); openSide(true); } });
  el.toc.addEventListener('click', (e) => {
    const t = e.target.closest('button.tog');
    if (t) { e.preventDefault(); const u = t.closest('.unit'); if (u) toggleUnit(u); else { const li = t.closest('.ch'); if (li) toggleChapter(li); } return; }
    const a = e.target.closest('a'); if (!a) return;
    if (a.getAttribute('href') === location.hash) { e.preventDefault(); route(); }   // same target: re-scroll
  });
  el.results.addEventListener('click', (e) => {
    const a = e.target.closest('a.hit'); if (!a) return;
    const mm = a.getAttribute('href').match(/^#p(\d+)(?:,(\d+))?/);
    clearHighlights(); hl = { page: mm ? +mm[1] : 0, y: mm && mm[2] != null ? +mm[2] : null, tokens: tokens(a.dataset.q) }; fromSearch = true;
    el.results.querySelectorAll('.cur').forEach((x) => x.classList.remove('cur')); a.classList.add('cur');
    if (a.getAttribute('href') === location.hash) { e.preventDefault(); route(); }
    else setTimeout(() => { if (cur) cur.pages.forEach((pg) => { if (pg.renderedScale != null) highlightPage(pg); }); }, 0);
  });
  let timer = null;
  el.q.addEventListener('focus', () => { loadSearch(); });
  el.q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => runSearch(el.q.value.trim()), 160); });
  el.q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { el.q.value = ''; closeResults(); el.q.blur(); } if (e.key === 'Enter') { e.preventDefault(); const first = el.results.querySelector('a.hit'); if (first) first.click(); } });
  el.qclear.addEventListener('click', () => { el.q.value = ''; closeResults(); el.q.focus(); });
  $('searchform').addEventListener('submit', (e) => e.preventDefault());
  // clean text selection: pdf.js's endOfContent trick
  el.pages.addEventListener('mousedown', (e) => { const tl = e.target.closest('.textLayer'); if (tl) tl.classList.add('selecting'); });
  document.addEventListener('mouseup', () => { el.pages.querySelectorAll('.textLayer.selecting').forEach((t) => t.classList.remove('selecting')); });
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
    if (e.key === '/' && !inField) { e.preventDefault(); openSide(true); el.q.focus(); el.q.select(); return; }
    if (inField) return;
    if (e.key === 'Escape') { if (!el.results.hidden) { el.q.value = ''; closeResults(); } else openSide(false); return; }
    if (!cur) return;
    const d = cur.doc;
    if (e.key === 'ArrowRight' || e.key === 'j' || e.key === 'PageDown' && false) { e.preventDefault(); if (curPage < d.filePages[1]) scrollTo({ page: curPage + 1 }); else if (docs[d.index + 1]) location.hash = hashFor(docs[d.index + 1]); }
    else if (e.key === 'ArrowLeft' || e.key === 'k') { e.preventDefault(); if (curPage > d.filePages[0]) scrollTo({ page: curPage - 1 }); else if (docs[d.index - 1]) location.hash = hashFor(docs[d.index - 1]); }
    else if (e.key === ']') { if (docs[d.index + 1]) location.hash = hashFor(docs[d.index + 1]); }
    else if (e.key === '[') { if (docs[d.index - 1]) location.hash = hashFor(docs[d.index - 1]); }
  });
}

// ---------------------------------------------------------------- go
fetch('manifest.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((m) => {
  buildModel(m); buildToc(); wire(); route();
}).catch((err) => {
  el.status.hidden = false;
  el.status.innerHTML = 'Couldn’t load the book’s manifest (' + esc(err && err.message || err) + '). The whole book is still available as a <a href="making-minds.pdf">PDF</a>.';
});
