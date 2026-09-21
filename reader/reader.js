/* Making Minds · Reader — the course's outside readings in one place.
   Everything comes from ../data/course.json: the schedule's non-course-book readings (required and recommended,
   grouped into "works" by author + year) and the background lists under `resources`. A reading with a local PDF
   (`file`, or a non-http `url`) is rendered here with pdf.js; anything else gets a citation card that links out.
   Sidebar: by due date (the schedule's spine) or by name (A–Z). Hash forms: #<key> · #<key>/p12. */
import * as pdfjsLib from '../book/pdfjs/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '../book/pdfjs/pdf.worker.min.mjs';

const $ = (id) => document.getElementById(id);
const el = { main: $('main'), side: $('side'), backdrop: $('backdrop'), menu: $('menu'), crumb: $('crumb'), pageno: $('pageno'),
  zoom: $('zoom'), zoomwrap: $('zoomwrap'), filelink: $('filelink'), list: $('list'), sidefoot: $('sidefoot'),
  landing: $('landing'), doc: $('doc'), card: $('card'), pages: $('pages'), chapnav: $('chapnav'), status: $('status') };
const PAGE_MAX = 1000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const store = {
  get(k, d) { try { const v = localStorage.getItem('rd.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('rd.' + k, JSON.stringify(v)); } catch (e) { /* private mode etc. */ } }
};
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = (s) => String(s == null ? '' : s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
const slug = (s) => strip(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const isExt = (u) => /^(https?:|mailto:)/i.test(u || '');
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
function dateLabel(iso) { const p = iso.split('-').map(Number); return DOW[new Date(p[0], p[1] - 1, p[2], 12).getDay()] + ' ' + p[1] + '/' + p[2]; }
function shortDate(iso) { const p = iso.split('-').map(Number); return p[1] + '/' + p[2]; }
function nowIn(tz) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
  return p.year + '-' + p.month + '-' + p.day + 'T' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute;
}

let D = null;                 // course.json
let works = [], byKey = {};   // one work per author+year (or explicit id)
let lessons = [];             // schedule lessons with their outside readings
let bg = [];                  // background sections from `resources`
let rows = { date: [], name: [] };   // sidebar order per sort mode: [{key, page}]
let az = [];                  // the works with assignments, A–Z by first author
let sort = store.get('sort', 'date') === 'name' ? 'name' : 'date';
let zoom = +store.get('zoom', 1) || 1;
let cur = null;               // {work, pdf, pages:[…], gen, scale, pw}
let gen = 0;
let observer = null;
let curPage = null;

// ---------------------------------------------------------------- readings → works
// "Descartes (1637) <i>Discourse…</i>, Part V —" → {author:"Descartes", year:"1637", rest:"<i>Discourse…</i>, Part V"}
function parseCite(cite) {
  const html = String(cite || '').trim(), text = strip(html).trim();
  let m = text.match(/^(.+?)\s*\((\d{4}[a-z]?)\)/);
  let author, year, rest;
  if (m) { author = m[1].trim(); year = m[2]; const i = html.indexOf('(' + year + ')'); rest = i >= 0 ? html.slice(i + year.length + 2) : ''; }
  else {
    m = text.match(/^([^,:(]+?)(?:,|:|\s*$)/);
    author = m ? m[1].trim() : text.slice(0, 40); year = '';
    const i = html.indexOf(author); rest = i >= 0 ? html.slice(i + author.length) : html;
  }
  // keep a trailing "—" or ":" — it joins the remainder to the link text ("Part V — the automaton passage")
  rest = rest.replace(/^[\s,:—–-]+/, '').trim();
  return { author, year, rest, restClean: rest.replace(/[\s,:—–-]+$/, '') };
}
function surname(author) {
  return author.replace(/^(the|a|an)\s+/i, '').split(/\s*(?:,|\band\b|&|\bet al\b)\s*/)[0].trim().split(/\s+/)[0] || author;
}
function fileOf(r) {
  if (r.file) return r.file;
  if (r.url && !isExt(r.url)) return r.url;
  const l = (r.links || []).find((x) => x.url && !isExt(x.url));
  return l ? l.url : null;
}
// external links of an entry: the entry's own url (labelled by its link text) and any named links[]
function extLinks(r) {
  const out = [];
  if (r.url && isExt(r.url)) out.push({ url: r.url, text: strip(r.linkText || ''), named: false });
  (r.links || []).forEach((l) => { if (l.url && isExt(l.url)) out.push({ url: l.url, text: strip(l.text || ''), named: true }); });
  return out;
}
// local links other than the one shown in the viewer ("full paper" beside an excerpt)
function moreFiles(r) {
  const f = fileOf(r);
  return (r.links || []).filter((l) => l.url && !isExt(l.url) && l.url !== f).map((l) => ({ url: l.url, text: strip(l.text || 'PDF') }));
}
function truncate(s, n) { s = String(s).replace(/[,\s]+$/, ''); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; }
function keyOf(r) {
  if (r.id) return r.id;
  if (r.cite) { const c = parseCite(r.cite); return slug(c.author + (c.year ? ' ' + c.year : '')); }
  if (r.links) return slug(r.links.map((l) => l.text).join(' '));
  return slug(r.linkText || r.text || r.html || 'reading');
}
// the assigned part, for the sidebar (date mode) and the card: cite remainder + link text (+ note on the card)
function partHtml(r, full) {
  const c = r.cite ? parseCite(r.cite) : { rest: '', restClean: '' };
  const more = r.url && r.linkText ? r.linkText : (r.links && (full || !c.rest) ? r.links.map((l) => l.text).join(' · ') : '');
  const bits = [];
  if (c.rest) bits.push(more ? c.rest : c.restClean);
  if (more) bits.push(more);
  if (full && r.note) bits.push(r.note);
  return bits.join(' ');
}
function titleOf(w) {
  for (const a of w.assignments) {
    const m = (a.r.cite || '').match(/<i>(.*?)<\/i>/);
    if (m) return m[1];
  }
  for (const a of w.assignments) { if (a.r.url && a.r.linkText) return a.r.linkText; }
  for (const a of w.assignments) { const c = a.r.cite ? parseCite(a.r.cite).restClean : ''; if (c) return c; }
  for (const a of w.assignments) { if (a.r.links) return a.r.links.map((l) => l.text).join(' · '); }
  return '';
}
function addAssignment(r, lesson, required) {
  if (r.mm || r.html || r.text) return null;      // course-book chapters and prose entries stay on the schedule
  const key = keyOf(r);
  let w = byKey[key];
  if (!w) {
    const c = r.cite ? parseCite(r.cite) : { author: strip(r.linkText || (r.links || []).map((l) => l.text).join(' · ')), year: '' };
    w = byKey[key] = { key, author: c.author, year: c.year, sortName: surname(c.author).toLowerCase(), assignments: [], bg: [], file: null, tags: [] };
    works.push(w);
  }
  const a = { r, lesson, required, file: fileOf(r), page: r.filePage || null, key };
  w.assignments.push(a);
  if (a.file && !w.file) w.file = a.file;
  w.more = w.more || [];
  moreFiles(r).forEach((m) => { if (!w.more.some((x) => x.url === m.url)) w.more.push(m); });
  if (r.tag && w.tags.indexOf(r.tag) < 0) w.tags.push(r.tag);
  return a;
}
function buildModel(data) {
  D = data; works = []; byKey = {}; lessons = []; bg = [];
  let n = 0;
  data.schedule.forEach((x) => {
    if (x.type !== 'lesson') return;
    const L = { id: 'l' + (++n), n, date: x.date, d: dateLabel(x.date), unit: x.unit, topic: x.topic, required: [], recommended: [], endAt: x.date + 'T' + (x.end || data.course.lecture.end) };
    (x.read || []).forEach((r) => { const a = addAssignment(r, L, true); if (a) L.required.push(a); });
    (x.recommended || []).forEach((r) => { const a = addAssignment(r, L, false); if (a) L.recommended.push(a); });
    lessons.push(L);
  });
  // background texts (the old Resources lists); an item whose PDF is already a work's file joins that work
  Object.keys(data.resources || {}).forEach((heading) => {
    if (/course book/i.test(heading)) return;
    const items = [];
    data.resources[heading].forEach((it) => {
      const local = it.url && !isExt(it.url) ? it.url : null;
      let w = local ? works.find((x) => x.file === local) : null;
      if (!w) {
        const c = parseCite(it.title);
        const key = 'bg-' + slug(c.author + ' ' + (c.year || '') + ' ' + strip(c.rest || it.title).slice(0, 30));
        w = byKey[key] = byKey[key] || { key, author: c.author, year: c.year, sortName: surname(c.author).toLowerCase(), assignments: [], bg: [], file: local, tags: [], bgTitle: c.restClean || it.title };
        if (works.indexOf(w) < 0) works.push(w);
      }
      w.bg.push({ heading, it });
      items.push(w);
    });
    bg.push({ heading, items });
  });
  works.forEach((w) => {
    w.title = w.assignments.length ? titleOf(w) : (w.bgTitle || '');
    w.required = w.assignments.some((a) => a.required);
    w.ext = [];
    w.assignments.forEach((a) => extLinks(a.r).forEach((l) => { if (!w.ext.some((x) => x.url === l.url)) w.ext.push(l); }));
    w.bg.forEach((b) => { if (isExt(b.it.url) && !w.ext.some((x) => x.url === b.it.url)) w.ext.push({ url: b.it.url, text: b.it.kind || '', named: false }); });
    w.label = w.author + (w.year ? ' (' + w.year + ')' : '');
  });
  // sidebar orders
  rows.date = [];
  lessons.forEach((L) => { L.required.concat(L.recommended).forEach((a) => rows.date.push({ key: a.key, page: a.page, a })); });
  az = works.filter((w) => w.assignments.length).sort((a, b) => a.sortName.localeCompare(b.sortName) || (a.year || '').localeCompare(b.year || '') || a.label.localeCompare(b.label));
  rows.name = az.map((w) => ({ key: w.key, page: null }));
  bg.forEach((s) => s.items.forEach((w) => { rows.date.push({ key: w.key, page: null }); rows.name.push({ key: w.key, page: null }); }));
}

// ---------------------------------------------------------------- sidebar
function hashFor(key, page) { return '#' + key + (page ? '/p' + page : ''); }
function avail(w) { return w.file ? '<span class="av pdf" title="Read here">PDF</span>' : (w.ext.length ? '<span class="av ext" title="Opens elsewhere">↗</span>' : '<span class="av none" title="No link yet">–</span>'); }
function tagHtml(t) { if (!t) return ''; const cls = /C/.test(t) && /T/.test(t) ? 'ct' : (/^C/.test(t) ? 'c' : 't'); return '<span class="tag ' + cls + '">' + esc(t) + '</span>'; }
// one sidebar row: a specific assignment (date mode) or the work as a whole (name mode, background)
function rowHtml(w, a, extra, rec) {
  const tags = a ? tagHtml(a.r.tag) : w.tags.map(tagHtml).join('');
  const sub = a ? partHtml(a.r, false) : (w.title || '');
  const label = a && a.r.label ? '<span class="dim">' + esc(a.r.label) + '</span> ' : '';
  return '<li class="rd-row' + ((a && !a.required) || rec ? ' rec' : '') + '" data-key="' + esc(w.key) + '"><a href="' + hashFor(w.key, a ? a.page : null) + '">' +
    '<span class="l1">' + label + tags + '<span class="au">' + esc(w.label) + '</span>' + (extra || '') + '</span>' +
    (sub ? '<span class="l2">' + sub + '</span>' : '') + '</a>' + avail(w) + '</li>';
}
function buildList() {
  let h = '';
  if (sort === 'date') {
    const units = {}; D.units.forEach((u) => { units[u.n] = u; });
    let lastUnit = null;
    lessons.forEach((L) => {
      if (L.unit !== lastUnit) {
        if (lastUnit != null) h += '</div>';
        lastUnit = L.unit; const u = units[L.unit] || { n: L.unit, name: '' };
        h += '<div class="unit" style="--uc:var(--u' + u.n + ')"><button class="tog" type="button" aria-expanded="true" aria-label="Fold unit ' + u.n + '"></button><span class="un">Unit ' + u.n + '</span><span class="ut">' + esc(u.name) + '</span></div><div class="ulist">';
      }
      h += '<div class="rd-lesson" id="side-' + L.id + '" style="--uc:var(--u' + L.unit + ')"><a class="rd-lh" href="../index.html#' + L.id + '" title="This lesson on the schedule"><span class="d mono">' + esc(L.d) + '</span><span class="t">' + esc(L.topic) + '</span></a>';
      if (!L.required.length && !L.recommended.length) h += '<div class="rd-none">no outside reading</div>';
      if (L.required.length) h += '<ol>' + L.required.map((a) => rowHtml(byKey[a.key], a)).join('') + '</ol>';
      if (L.recommended.length) {
        h += '<div class="rd-rec"><button class="rd-rectog" type="button" aria-expanded="false">Recommended <span class="n">(' + L.recommended.length + ')</span></button><ol class="rd-reclist">' + L.recommended.map((a) => rowHtml(byKey[a.key], a)).join('') + '</ol></div>';
      }
      h += '</div>';
    });
    if (lastUnit != null) h += '</div>';
  } else {
    let last = '';
    h += '<ol class="rd-az">';
    az.forEach((w) => {
      const letter = (w.sortName[0] || '').toUpperCase();
      if (letter !== last) { last = letter; h += '<li class="rd-letter" aria-hidden="true">' + esc(letter) + '</li>'; }
      // one date chip per lesson (a work can be assigned twice on one day, e.g. two videos)
      const seen = {};
      const dates = w.assignments.filter((a) => { if (seen[a.lesson.id]) return false; seen[a.lesson.id] = true; return true; })
        .map((a) => '<span class="when' + (a.required ? '' : ' rec') + '" title="' + (a.required ? 'Required' : 'Recommended') + ' for ' + esc(a.lesson.d) + ' · ' + esc(a.lesson.topic) + '">' + esc(shortDate(a.lesson.date)) + '</span>').join('');
      h += rowHtml(w, null, '<span class="whens">' + dates + '</span>', !w.required);
    });
    h += '</ol>';
  }
  // background texts
  if (bg.length) {
    h += '<div class="unit bgunit" style="--uc:var(--accent)"><button class="tog" type="button" aria-expanded="true" aria-label="Fold background"></button><span class="un">Background</span><span class="ut">Further reading</span></div><div class="ulist">';
    bg.forEach((s) => {
      h += '<div class="rd-lesson"><div class="rd-lh rd-bgh"><span class="t">' + esc(s.heading) + '</span></div><ol>' +
        s.items.map((w) => rowHtml(w, null, '')).join('') + '</ol></div>';
    });
    h += '</div>';
  }
  el.list.innerHTML = h;
  document.querySelectorAll('.rd-sortbtn').forEach((b) => b.setAttribute('aria-checked', b.dataset.sort === sort ? 'true' : 'false'));
  const book = D.course.book;
  el.sidefoot.innerHTML = '<a href="../index.html">Schedule</a>' + (book && book.reader ? '<a href="../' + esc(book.reader) + '">Course book · <i>' + esc(book.title) + '</i></a>' : '') +
    '<span class="new">Readings marked <b>PDF</b> open here; the rest open where they live.</span>';
  if (cur) markCurrent(cur.work);
}
function markCurrent(w) {
  el.list.querySelectorAll('.cur').forEach((x) => x.classList.remove('cur'));
  if (!w) return;
  let first = null;
  el.list.querySelectorAll('.rd-row[data-key="' + CSS.escape(w.key) + '"]').forEach((li) => {
    li.classList.add('cur'); if (!first) first = li;
    const rec = li.closest('.rd-rec'); if (rec) { rec.classList.add('open'); rec.querySelector('.rd-rectog').setAttribute('aria-expanded', 'true'); }
  });
  if (first) keepInView(first);
}
function keepInView(node) {
  if (!node || node.offsetParent === null) return;
  const r = node.getBoundingClientRect(), s = el.side.getBoundingClientRect();
  if (r.top < s.top + 70 || r.bottom > s.bottom - 20) node.scrollIntoView({ block: 'center' });
}
function openSide(on) { el.side.classList.toggle('open', on); el.backdrop.classList.toggle('on', on); el.menu.setAttribute('aria-expanded', on ? 'true' : 'false'); }
function setSort(s) {
  if (s !== 'date' && s !== 'name') return;
  sort = s; store.set('sort', s); buildList();
  if (cur) { cur.row = null; chapNav(cur.work); }
}

// ---------------------------------------------------------------- landing
function showLanding() {
  gen++; cur = null; curPage = null;
  if (observer) observer.disconnect();
  el.doc.hidden = true; el.status.hidden = true; el.landing.hidden = false;
  el.pages.innerHTML = ''; el.card.innerHTML = ''; el.chapnav.innerHTML = '';
  const assigned = works.filter((w) => w.assignments.length), here = assigned.filter((w) => w.file).length,
    out = assigned.filter((w) => !w.file && w.ext.length).length, none = assigned.length - here - out;
  const now = nowIn(D.course.timezone);
  const next = lessons.find((L) => L.endAt > now);
  let h = '<h1>Reader</h1><p class="lede">The outside readings for the course, in one place. Readings we host open right here; the rest link to where they live. ' +
    'Sort the list by <b>due date</b> to follow the schedule, or by <b>name</b> to find an author. Chapters of <i>' + esc(D.course.book.title) + '</i> are in the <a href="../' + esc(D.course.book.reader || D.course.book.pdf) + '">course book</a>.</p>';
  const last = store.get('last', null);
  if (last && byKey[last.key] && byKey[last.key].file) {
    const w = byKey[last.key];
    h += '<p class="rd-cont"><a class="cont" href="' + hashFor(w.key, last.page) + '">Continue <span class="sub">· ' + esc(w.label) + (last.page ? ', p. ' + last.page : '') + '</span></a></p>';
  }
  if (next) {
    h += '<section class="rd-next"><div class="chip">' + (next.date === now.slice(0, 10) ? 'Today’s class' : 'Next class') + '</div>' +
      '<div class="nx-body"><a class="nx-main" href="../index.html#' + next.id + '"><span class="mono nx-date">' + esc(next.d) + '</span> ' + esc(next.topic) + '</a>';
    if (next.required.length) h += '<ul class="rd-nextlist">' + next.required.map((a) => '<li>' + tagHtml(a.r.tag) + '<a href="' + hashFor(a.key, a.page) + '">' + esc(byKey[a.key].label) + '</a> <span class="part">' + partHtml(a.r, false) + '</span></li>').join('') + '</ul>';
    else h += '<div class="rd-none">No outside reading — just the course book.</div>';
    if (next.recommended.length) h += '<div class="rd-nextrec">+ ' + next.recommended.length + ' recommended</div>';
    h += '</div></section>';
  }
  h += '<p class="rd-stats">' + assigned.length + ' readings on the schedule · <b>' + here + '</b> open here · ' + out + ' link out' + (none ? ' · ' + none + ' without a link yet' : '') + '</p>';
  el.landing.innerHTML = h;
  el.crumb.innerHTML = '<span class="cur">Readings</span>';
  el.pageno.textContent = ''; el.filelink.innerHTML = ''; el.zoomwrap.hidden = true;
  document.title = 'Making Minds · Reader';
  markCurrent(null);
  el.main.scrollTop = 0;
}

// ---------------------------------------------------------------- work view
function cardHtml(w, ctx) {
  let h = '<header class="rd-head"><div class="rd-tags">' + w.tags.map(tagHtml).join('') + (w.assignments.length ? '' : '<span class="tag file">Background</span>') + '</div>' +
    '<h1>' + esc(w.label) + '</h1>' + (w.title ? '<div class="rd-title">' + w.title + '</div>' : '') + '</header>';
  if (w.assignments.length) {
    h += '<ul class="rd-asg">' + w.assignments.map((a) => {
      const L = a.lesson;
      return '<li' + (ctx && ctx.a === a ? ' class="cur"' : '') + '><div class="when"><a class="mono d" href="../index.html#' + L.id + '" title="On the schedule">' + esc(L.d) + '</a> <span class="t">' + esc(L.topic) + '</span> <span class="req' + (a.required ? '' : ' rec') + '">' + (a.required ? 'required' : 'recommended') + '</span></div>' +
        '<div class="what">' + (a.r.label ? '<span class="dim">' + esc(a.r.label) + '</span> ' : '') + partHtml(a.r, true) +
        (a.page && w.file ? ' <a class="goto" href="' + hashFor(w.key, a.page) + '">open at p. ' + a.page + ' ↓</a>' : '') + '</div></li>';
    }).join('') + '</ul>';
  }
  if (w.bg.length) {
    h += '<ul class="rd-asg bg">' + w.bg.map((b) => '<li><div class="when"><span class="t">' + esc(b.heading) + '</span></div><div class="what">' + b.it.title + (b.it.note ? ' <span class="dim">· ' + b.it.note + '</span>' : '') + '</div></li>').join('') + '</ul>';
  }
  h += '<div class="rd-actions">';
  if (w.file) h += '<a class="primary" href="../' + esc(w.file) + '" download>Download PDF</a>';
  (w.more || []).forEach((m) => { h += '<a href="../' + esc(m.url) + '" download>' + esc(m.text) + ' <span class="sub">PDF ↓</span></a>'; });
  // one "Open" button per outside link: a lone unnamed link is "Open on <host>", several are told apart by their text
  w.ext.forEach((l) => {
    const text = (w.ext.length === 1 && !l.named) || !l.text ? 'Open on ' + esc(host(l.url)) : esc(truncate(l.text, 44)) + ' <span class="sub">' + esc(host(l.url)) + '</span>';
    h += '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + text + ' <span class="sub">↗</span></a>';
  });
  h += '</div>';
  if (!w.file) h += '<p class="rd-nofile">' + (w.ext.length ? 'Not hosted here yet — this one opens on ' + esc(host(w.ext[0].url)) + '.' : 'No file or link for this one yet.') + '</p>';
  return h;
}
function chapNav(w) {
  const list = rows[sort];
  let i = list.findIndex((r) => r.key === w.key);
  if (cur && cur.row != null && list[cur.row] && list[cur.row].key === w.key) i = cur.row;
  const prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  const lab = (r) => { const x = byKey[r.key]; return esc(x.label) + (r.a ? ' <span class="dim">· ' + esc(r.a.lesson.d) + '</span>' : ''); };
  el.chapnav.innerHTML = (prev ? '<a class="prev" href="' + hashFor(prev.key, prev.page) + '" data-row="' + (i - 1) + '"><span class="k">Previous</span><span>' + lab(prev) + '</span></a>' : '') +
    (next ? '<a class="next" href="' + hashFor(next.key, next.page) + '" data-row="' + (i + 1) + '"><span class="k">Next</span><span>' + lab(next) + '</span></a>' : '');
}
function crumbFor(w, ctx) {
  let h = '';
  if (ctx && ctx.a) h += '<a class="unit" style="--uc:var(--u' + ctx.a.lesson.unit + ')" href="../index.html#' + ctx.a.lesson.id + '">' + esc(ctx.a.lesson.d) + '</a><span class="sep">›</span>';
  else h += '<a href="#">Readings</a><span class="sep">›</span>';
  h += '<span class="cur">' + esc(w.label) + '</span>' + (w.title ? '<span class="sep">·</span><span class="ttl">' + w.title + '</span>' : '');
  el.crumb.innerHTML = h;
}
async function openWork(w, page, ctx) {
  const same = cur && cur.work === w;
  if (same) {          // another assignment of the same work (or a page link): keep the loaded PDF
    cur.row = ctx ? ctx.row : null;
    el.card.innerHTML = cardHtml(w, ctx); chapNav(w); crumbFor(w, ctx); markCurrent(w);
    if (page) scrollToPage(page); else el.main.scrollTop = 0;
    return;
  }
  gen++; const g = gen;
  cur = { work: w, pdf: null, pages: [], gen: g, scale: 1, pw: 0, row: ctx ? ctx.row : null };
  curPage = null;
  el.landing.hidden = true; el.doc.hidden = false; el.status.hidden = true;
  el.pages.innerHTML = ''; el.card.innerHTML = cardHtml(w, ctx);
  chapNav(w); crumbFor(w, ctx); markCurrent(w);
  document.title = w.label + ' · Reader · Making Minds';
  el.pageno.textContent = '';
  el.filelink.innerHTML = w.file ? '<a href="../' + esc(w.file) + '" download title="Download the PDF">PDF ↓</a>' : (w.ext.length ? '<a href="' + esc(w.ext[0].url) + '" target="_blank" rel="noopener">Open ↗</a>' : '');
  el.zoomwrap.hidden = !w.file;
  if (observer) observer.disconnect();
  el.main.scrollTop = 0;
  if (!w.file) return;
  store.set('last', { key: w.key, page: page || null });
  el.status.hidden = false; el.status.textContent = 'Loading…';
  try {
    const pdf = await pdfjsLib.getDocument({ url: '../' + w.file }).promise;
    if (gen !== g) { pdf.destroy(); return; }
    cur.pdf = pdf;
    const first = await pdf.getPage(1);
    if (gen !== g) return;
    const vp = first.getViewport({ scale: 1 });
    cur.w0 = vp.width; cur.h0 = vp.height;
    for (let i = 1; i <= pdf.numPages; i++) {
      const div = document.createElement('div'); div.className = 'pg'; div.dataset.p = i; div.setAttribute('aria-label', 'Page ' + i);
      div.innerHTML = '<span class="pnum">' + i + '</span>';
      el.pages.appendChild(div);
      cur.pages.push({ i, p: i, el: div, pdfPage: i === 1 ? first : null, w: vp.width, h: vp.height, renderedScale: null, rendering: false, task: null, near: false });
    }
    el.status.hidden = true;
    layout();
    observer = new IntersectionObserver(onIntersect, { root: el.main, rootMargin: '120% 0px', threshold: 0 });
    cur.pages.forEach((pg) => observer.observe(pg.el));
    if (page) scrollToPage(page); else onScroll();
  } catch (err) {
    if (gen !== g) return;
    el.status.hidden = false; el.status.innerHTML = 'Couldn’t load the PDF (' + esc(err && err.message || err) + '). <a href="../' + esc(w.file) + '">Open it directly</a>.';
  }
}
function fitWidth() { const w = el.main.clientWidth - (window.innerWidth <= 900 ? 16 : 32); return Math.max(200, Math.min(w, PAGE_MAX)); }
function layout() {
  if (!cur || !cur.pdf) return;
  cur.pw = Math.round(fitWidth() * zoom); cur.scale = cur.pw / cur.w0;
  cur.pages.forEach((pg) => sizePage(pg));
}
function sizePage(pg) {
  const s = cur.pw / pg.w;                       // this page's own scale (pages may differ in size)
  pg.scale = s;
  pg.el.style.setProperty('--pw', cur.pw + 'px'); pg.el.style.setProperty('--ph', Math.round(pg.h * s) + 'px'); pg.el.style.setProperty('--scale-factor', s);
}
function pageTop(p) { const pg = cur && cur.pages[p - 1]; return pg ? pg.el.offsetTop : 0; }
function scrollToPage(p) {
  if (!cur || !cur.pages.length) return;
  p = Math.max(1, Math.min(cur.pages.length, p));
  el.main.scrollTop = Math.max(0, pageTop(p) - 12);
  onScroll();
}
function onIntersect(entries) {
  if (!cur) return;
  entries.forEach((e) => { const pg = cur.pages[+e.target.dataset.p - 1]; if (pg) pg.near = e.isIntersecting; });
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
  if (!cur || !cur.pdf || pg.rendering || pg.renderedScale === cur.pw) return;
  const g = gen, pw = cur.pw;
  pg.rendering = true;
  try {
    if (!pg.pdfPage) pg.pdfPage = await cur.pdf.getPage(pg.i);
    if (gen !== g) return;
    const page = pg.pdfPage;
    const v1 = page.getViewport({ scale: 1 });
    if (Math.abs(v1.width - pg.w) > 0.5 || Math.abs(v1.height - pg.h) > 0.5) { pg.w = v1.width; pg.h = v1.height; sizePage(pg); }
    const viewport = page.getViewport({ scale: pg.scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr); canvas.height = Math.floor(viewport.height * dpr);
    const ctx = canvas.getContext('2d', { alpha: false });
    pg.task = page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
    await pg.task.promise; pg.task = null;
    if (gen !== g || cur.pw !== pw) { pg.rendering = false; if (gen === g) renderPage(pg); return; }
    pg.el.querySelectorAll('canvas').forEach((x) => x.remove());
    pg.el.prepend(canvas);
    const tl = document.createElement('div'); tl.className = 'textLayer';
    pg.el.querySelectorAll('.textLayer').forEach((x) => x.remove());
    pg.el.appendChild(tl);
    const textLayer = new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport });
    await textLayer.render();
    const eoc = document.createElement('div'); eoc.className = 'endOfContent'; tl.appendChild(eoc);
    pg.renderedScale = pw; pg.rendering = false;
  } catch (err) {
    pg.rendering = false;
    if (err && err.name !== 'RenderingCancelledException') console.warn('render', pg.p, err);
  }
}
function rerenderAll() {
  if (!cur || !cur.pdf) return;
  const keepPage = curPage, keepFrac = keepPage ? (el.main.scrollTop - pageTop(keepPage)) / Math.max(1, cur.pages[keepPage - 1].el.offsetHeight) : 0;
  layout();
  cur.pages.forEach((pg) => { if (pg.renderedScale != null) releasePage(pg); });
  if (keepPage) el.main.scrollTop = pageTop(keepPage) + keepFrac * cur.pages[keepPage - 1].el.offsetHeight;
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
  if (page.p !== curPage) {
    curPage = page.p;
    el.pageno.textContent = 'p. ' + page.p + ' of ' + cur.pages.length;
    store.set('last', { key: cur.work.key, page: page.p });
    history.replaceState(null, '', hashFor(cur.work.key, page.p > 1 ? page.p : null));
  }
}

// ---------------------------------------------------------------- routing
let pendingRow = null;        // sidebar/chapnav click → which row of the current order was chosen (for prev/next)
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  const m = h.match(/^([a-z0-9-]+)(?:\/p(\d+))?$/i);
  if (!h) { showLanding(); }
  else if (m && byKey[m[1]]) {
    const w = byKey[m[1]], page = m[2] ? +m[2] : null;
    let row = pendingRow; pendingRow = null;
    const list = rows[sort];
    if (row == null || !list[row] || list[row].key !== w.key) row = list.findIndex((r) => r.key === w.key && (page == null || r.page == null || r.page === page));
    const r = row >= 0 ? list[row] : null;
    openWork(w, page, { a: r && r.a ? r.a : (w.assignments[0] || null), row: row >= 0 ? row : null });
  } else showLanding();
  if (window.innerWidth <= 900) openSide(false);
}

// ---------------------------------------------------------------- events
function wire() {
  window.addEventListener('hashchange', route);
  el.main.addEventListener('scroll', onScroll, { passive: true });
  new ResizeObserver(() => { if (cur && cur.pdf) { const w = Math.round(fitWidth() * zoom); if (w !== cur.pw) rerenderAll(); } }).observe(el.main);
  el.zoom.value = String(zoom);
  el.zoom.addEventListener('change', () => { zoom = +el.zoom.value || 1; store.set('zoom', zoom); rerenderAll(); });
  el.menu.addEventListener('click', () => openSide(!el.side.classList.contains('open')));
  el.backdrop.addEventListener('click', () => openSide(false));
  document.querySelectorAll('.rd-sortbtn').forEach((b) => b.addEventListener('click', () => setSort(b.dataset.sort)));
  el.list.addEventListener('click', (e) => {
    const t = e.target.closest('button.tog');
    if (t) { e.preventDefault(); const u = t.closest('.unit'); const closed = u.classList.toggle('closed'); t.setAttribute('aria-expanded', closed ? 'false' : 'true'); return; }
    const rt = e.target.closest('button.rd-rectog');
    if (rt) { e.preventDefault(); const box = rt.closest('.rd-rec'); const on = box.classList.toggle('open'); rt.setAttribute('aria-expanded', on ? 'true' : 'false'); return; }
    const a = e.target.closest('.rd-row a'); if (!a) return;
    const li = a.closest('.rd-row');
    const all = [...el.list.querySelectorAll('.rd-row a')];
    pendingRow = all.indexOf(a);
    // map the sidebar's row order onto rows[sort] (same order in both modes: lessons then background)
    if (a.getAttribute('href') === location.hash) { e.preventDefault(); route(); }
  });
  el.chapnav.addEventListener('click', (e) => { const a = e.target.closest('a[data-row]'); if (a) pendingRow = +a.dataset.row; });
  el.pages.addEventListener('mousedown', (e) => { const tl = e.target.closest('.textLayer'); if (tl) tl.classList.add('selecting'); });
  document.addEventListener('mouseup', () => { el.pages.querySelectorAll('.textLayer.selecting').forEach((t) => t.classList.remove('selecting')); });
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName);
    if (inField) return;
    if (e.key === 'Escape') { openSide(false); return; }
    if (!cur) return;
    const list = rows[sort], i = cur.row != null ? cur.row : list.findIndex((r) => r.key === cur.work.key);
    const go = (j) => { if (list[j]) { pendingRow = j; location.hash = hashFor(list[j].key, list[j].page); } };
    if (e.key === 'ArrowRight' || e.key === 'j') { e.preventDefault(); if (cur.pdf && curPage < cur.pages.length) scrollToPage(curPage + 1); else go(i + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'k') { e.preventDefault(); if (cur.pdf && curPage > 1) scrollToPage(curPage - 1); else go(i - 1); }
    else if (e.key === ']') go(i + 1);
    else if (e.key === '[') go(i - 1);
  });
}

// ---------------------------------------------------------------- go
fetch('../data/course.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((data) => {
  buildModel(data); buildList(); wire(); route();
}).catch((err) => {
  el.status.hidden = false;
  el.status.innerHTML = 'Couldn’t load <code>data/course.json</code> (' + esc(err && err.message || err) + '). If you opened this file from disk, serve the folder over http instead; or view it at www.makingminds.org.';
});
