/* Making Minds · Phil 133 — renders the site from data/course.json.
   index.html: hero meta, course facts, the "up next" box, the syllabus table.
   policies.html: a few bound values.  (resources.html now redirects to reader/, which renders the readings itself.)
   Dates in the JSON are ISO (YYYY-MM-DD); weekday labels and UCLA week
   numbers are computed here. Times are local to course.timezone. */
(function () {
  'use strict';

  // ---------- helpers ----------
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function dateLabel(iso) {           // "2026-09-24" -> "Thu 9/24"
    var p = iso.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2], 12);
    return DOW[d.getDay()] + ' ' + p[1] + '/' + p[2];
  }
  function longDate(iso) {            // "2026-10-29" -> "Thursday, October 29"
    var p = iso.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2], 12).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function ampm(t) {                  // "13:45" -> "1:45pm"
    var h = +t.slice(0, 2), m = t.slice(3);
    return ((h + 11) % 12 + 1) + ':' + m + (h < 12 ? 'am' : 'pm');
  }
  function timeRange(a, b) { return ampm(a).replace(/[ap]m$/, '') + '–' + ampm(b); }
  function weekOf(iso, mondayOfWeek1) {
    var d = new Date(iso + 'T12:00:00'), w1 = new Date(mondayOfWeek1 + 'T12:00:00');
    var n = Math.floor((d - w1) / (7 * 864e5)) + 1;
    return n < 1 ? '0' : (n > 10 ? 'F' : String(n));
  }
  function link(url, text) {
    var ext = /^https?:/.test(url);
    return '<a href="' + esc(url) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + text + '</a>';
  }
  // Dim a "TBA" inside otherwise real text ("Tue 2–3pm, location TBA").
  function tba(t) { return esc(t).replace(/\bTBA\b/g, '<em>TBA</em>'); }
  var WORDS = ['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
  function words(n) { var w = WORDS[n]; return w ? w.charAt(0).toUpperCase() + w.slice(1) : String(n); }
  function tag(t) {
    var cls = /C/.test(t) && /T/.test(t) ? 'ct' : (/^C/.test(t) ? 'c' : 't');
    return '<span class="tag ' + cls + '">' + esc(t) + '</span>';
  }
  // One reading entry -> inline HTML. bare: chapter number without the "MM" prefix
  // (the syllabus's Making Minds column, where the header already names the book).
  function reading(r, bare) {
    if (r.mm) {   // course-book chapter: the title links into the web reader by chapter number
      var bk = window.__course && window.__course.course.book, rd = bk && bk.reader;
      var t = rd && r.n ? '<a class="mmlink" href="' + esc(rd + '#ch' + r.n) + '">' + esc(r.mm) + '</a>' : esc(r.mm);
      var pre = bare ? (r.n ? String(r.n) : '') : 'MM' + (r.n ? ' ' + r.n : '');
      return '<span class="mm">' + pre + '</span><span class="mmt">' + t + '</span>';
    }
    if (r.html) return r.html;
    if (r.text) return r.text;
    // an outside reading hosted on this site (id + a local file) opens in the readings reader, like MM chapters do
    var rr = window.__course && window.__course.course.readings && window.__course.course.readings.reader;
    var here = rr && r.id && (r.file || (r.url && !/^https?:/.test(r.url)) || (r.links || []).some(function (l) { return !/^https?:/.test(l.url); }))
      ? rr + '#' + r.id + (r.filePage ? '/p' + r.filePage : '') : null;
    // the entry's own link (or its first local link) opens the reader when the reading is hosted here;
    // further local links (e.g. "full paper" beside an excerpt) and outside links stay as they are
    var sent = false;
    function rl(url, text) {
      var local = !/^https?:/.test(url);
      if (here && !sent && (local || (r.file && url === r.url))) { sent = true; return link(here, text); }
      return link(url, text);
    }
    var parts = [];
    if (r.label) parts.push('<span class="dim">' + esc(r.label) + '</span>');
    if (r.tag) parts.push(tag(r.tag));
    if (r.short) {   // compact form for the syllabus: author (year) + the assigned titles; the full citation lives in the Reader
      var to = here || (r.url && /^https?:/.test(r.url) ? r.url : null) || ((r.links || [])[0] || {}).url || null;
      var out = to && /^https?:/.test(to);
      parts.push(to ? '<a class="rdlink' + (out ? ' out' : '') + '" href="' + esc(to) + '"' + (out ? ' target="_blank" rel="noopener"' : '') + '>' + r.short + '</a>' : r.short);
      return parts.join(' ');
    }
    if (r.cite) parts.push(r.cite);
    if (r.url) parts.push(rl(r.url, r.linkText || r.url));
    else if (here && r.linkText) parts.push(link(here, r.linkText));
    if (r.links) parts.push(r.links.map(function (l) { return rl(l.url, l.text); }).join(' · '));
    if (r.note) parts.push(r.note);
    return parts.join(' ');
  }
  function ul(items, bare) { return '<ul class="rlist">' + items.map(function (r) { return '<li>' + reading(r, bare) + '</li>'; }).join('') + '</ul>'; }

  // Current time in the course timezone as "YYYY-MM-DDTHH:MM" (compares as a string).
  function nowIn(tz) {
    var p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day + 'T' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute;
  }

  // Derived fields on schedule entries: id, end/due datetime, labels.
  function prepare(data) {
    var c = data.course, lessonNo = 0, hwNo = 0;
    data.schedule.forEach(function (x) {
      x.d = dateLabel(x.date);
      x.wk = weekOf(x.date, c.calendar.weekOneMonday);
      if (x.type === 'lesson') { x.id = 'l' + (++lessonNo); x.endAt = x.date + 'T' + (x.end || c.lecture.end); }
      else if (x.type === 'exam') { x.id = x.title.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, ''); x.endAt = x.date + 'T' + x.end; }
      else if (x.type === 'hw') { x.id = 'hw' + (x.n || ++hwNo); x.dueAt = x.date + 'T' + (x.dueTime || c.homework.dueTime); }
    });
    return data;
  }

  // ---------- home page ----------
  function renderFacts(c) {
    var el = document.getElementById('facts');
    if (!el) return;
    var sec = c.sections;
    var facts = [
      ['Lecture', '<b>' + esc(c.lecture.days) + ' ' + esc(c.lecture.time) + '</b><br>' + esc(c.lecture.room)],
      ['Sections', esc(sec.day) + ' · ' + tba(sec.room) + (sec.list || []).map(function (x) {
        return '<br>' + esc(x.id) + ' ' + esc(x.time); }).join('')],
      ['Instructor', esc(c.instructor.title + ' ' + c.instructor.name) + (c.instructor.email ? '<br>' + link('mailto:' + c.instructor.email, c.instructor.email) : '') + '<br>office hours ' + tba(c.instructor.officeHours)],
      ['TA', esc(c.ta.name) + (c.ta.email ? '<br>' + link('mailto:' + c.ta.email, c.ta.email) : '') + '<br>office hours ' + tba(c.ta.officeHours)],
      ['Course book', '<b>' + esc(c.book.title) + '</b> (' + esc(c.book.abbrev) + ') — ' + (c.book.reader ? link(c.book.reader, 'online') + ' · ' : '') + link(c.book.pdf, 'PDF') + (c.book.drive ? ' · ' + link(c.book.drive, 'current version') : '') + (c.book.note ? ' <span class="dim">· ' + esc(c.book.note) + '</span>' : '')],
      ['Homework', words(c.homework.count) + ' problem sets, in the ' + link(c.app.url, c.app.label) + '<br>' + esc(c.homework.summary)],
    ];
    var exams = window.__course.schedule.filter(function (x) { return x.type === 'exam'; });
    facts.push(['Exams', exams.map(function (x) {
      return esc(x.title.replace(/ exam$/, '')) + ' <b>' + esc(x.d) + (x.title === 'Final exam' ? ', ' + esc(timeRange(x.start, x.end)) : '') + '</b>, ' + esc(x.where);
    }).join('<br>')]);
    facts.push(['Policies', 'Grading, group work, late work, and more:<br>' + link('policies.html', 'Course Policies')]);
    el.innerHTML = facts.map(function (f) { return '<div class="fact"><div class="k">' + f[0] + '</div><div class="v">' + f[1] + '</div></div>'; }).join('');
  }

  function renderHeroMeta(c) {
    var el = document.getElementById('hero-meta');
    if (!el) return;
    el.innerHTML = esc(c.code) + ' · ' + esc(c.term) + ' · ' + esc(c.institution) + '<br>' +
      esc(c.instructor.title + ' ' + c.instructor.name) + ' · TA ' + esc(c.ta.name) + '<br>' +
      esc(c.lecture.days) + ' ' + esc(c.lecture.time) + ' · ' + esc(c.lecture.room);
  }

  function renderSchedule(data) {
    var el = document.getElementById('schedule');
    if (!el) return;
    var cols = '<colgroup><col class="c-wk"><col class="c-date"><col class="c-topic"><col class="c-mm"><col class="c-ext"></colgroup>';
    var html = ['<table class="sched sched-head" aria-hidden="true">' + cols + '<thead><tr><th>Wk</th><th>Date</th><th>Topic</th><th>Making Minds readings</th><th>Outside readings</th></tr></thead></table>'];
    var units = {};
    data.units.forEach(function (u) { units[u.n] = u; });
    // group entries into unit blocks: an entry belongs to the current unit until the next lesson with a new unit
    var blocks = [], cur = null;
    data.schedule.forEach(function (x) {
      if (x.type === 'lesson' && (!cur || cur.unit !== x.unit)) { cur = { unit: x.unit, rows: [] }; blocks.push(cur); }
      if (!cur) { cur = { unit: x.unit || 1, rows: [] }; blocks.push(cur); }
      cur.rows.push(x);
    });
    blocks.forEach(function (b) {
      var u = units[b.unit] || { n: b.unit, name: '' };
      var rows = ['<tr class="unit" style="--uc:var(--u' + u.n + ')"><td colspan="5"><span class="un">Unit ' + u.n + '</span><span class="ut">' + esc(u.name) + '</span></td></tr>'];
      var lastWk = null;
      b.rows.forEach(function (x) {
        var wk = x.wk === lastWk ? '' : x.wk; if (wk) lastWk = x.wk;
        var wkTd = '<td class="wk mono">' + wk + '</td><td class="date mono">' + esc(x.d) + '</td>';
        if (x.type === 'lesson') {
          // course-book chapters in one column, everything else (required, then folded recommended) in the next
          var mm = (x.read || []).filter(function (r) { return r.mm; }), other = (x.read || []).filter(function (r) { return !r.mm; });
          var ext = other.length ? ul(other) : '';
          if (x.recommended && x.recommended.length) {
            ext += '<details class="rec"><summary>Recommended <span class="n">(' + x.recommended.length + ')</span></summary>' + ul(x.recommended) + '</details>';
          }
          rows.push('<tr class="u' + x.unit + '" id="' + x.id + '">' + wkTd + '<td class="topic">' + esc(x.topic) + '</td><td class="readings mmcol">' + (mm.length ? ul(mm, true) : '') + '</td><td class="readings extcol">' + ext + '</td></tr>');
        } else if (x.type === 'hw') {
          var note = esc(data.course.homework.dueLabel) + ' · covers ' + esc(x.covers) + (x.note ? ' · ' + esc(x.note) : '');
          rows.push('<tr class="hw" id="' + x.id + '">' + wkTd + '<td class="topic">HW' + x.n + ' due<span class="sub">' + esc(x.title) + '</span></td><td class="readings" colspan="2"><span class="note">' + note + '</span></td></tr>');
        } else if (x.type === 'exam') {
          var sub = x.where === 'in class' ? 'in class, ' + timeRange(x.start, x.end) : timeRange(x.start, x.end) + ' · ' + x.where;
          rows.push('<tr class="exam" id="' + x.id + '">' + wkTd + '<td class="topic">' + esc(x.title) + '<span class="sub">' + esc(sub) + '</span></td><td class="readings" colspan="2"><span class="note">' + esc(x.note || '') + '</span></td></tr>');
        } else if (x.type === 'holiday') {
          rows.push('<tr class="holiday">' + wkTd + '<td class="topic">' + esc(x.title) + '</td><td class="readings" colspan="2"></td></tr>');
        }
      });
      html.push('<div class="tablewrap schedwrap"><table class="sched" style="--uc:var(--u' + u.n + ')">' + cols + '<tbody>' + rows.join('') + '</tbody></table></div>');
    });
    el.innerHTML = html.join('');
  }

  function renderNext(data) {
    var box = document.getElementById('next');
    if (!box) return;
    var c = data.course, now = nowIn(c.timezone), today = now.slice(0, 10);
    var next = null, due = null;
    data.schedule.forEach(function (x) {
      if (!next && x.endAt && x.endAt > now) next = x;
      if (!due && x.dueAt && x.dueAt > now) due = x;
    });
    function line(label, x, mainHtml, detailHtml) {
      return '<div class="nx"><span class="chip">' + esc(label) + '</span><div class="nx-body">' +
        '<a class="nx-main" href="#' + x.id + '"><span class="mono nx-date">' + esc(x.d) + '</span> ' + mainHtml + '</a>' +
        (detailHtml ? '<div class="nx-detail">' + detailHtml + '</div>' : '') + '</div></div>';
    }
    var html = '';
    if (!next && !due) {
      html = '<div class="nx-done">' + esc(c.term) + ' · the quarter is over — thanks for a great course.</div>';
    } else {
      if (next) {
        var isExam = next.type === 'exam', isToday = next.date === today;
        var label = isExam ? (isToday ? 'Today' : 'Next up') : (isToday ? 'Today’s class' : 'Next class');
        if (isExam) {
          var sub = next.where === 'in class' ? 'in class, ' + timeRange(next.start, next.end) : timeRange(next.start, next.end) + ' · ' + next.where;
          html += line(label, next, esc(next.title) + ' <span class="dim">· ' + esc(sub) + '</span>', esc(next.note || ''));
        } else {
          var items = (next.read || []).map(function (r) { return reading(r); }).join(' <span class="sep">·</span> ');
          html += line(label, next, esc(next.topic), items ? '<span class="rl">Read</span> ' + items : '');
        }
      }
      if (due) html += line('Next due', due, 'HW' + due.n + ' due <span class="dim">· ' + esc(c.homework.dueLabel) + '</span>', '');
    }
    box.innerHTML = html;
    box.hidden = false;
  }

  // ---------- resources page ----------
  function renderResources(data) {
    var el = document.getElementById('resources');
    if (!el) return;
    var html = '';
    Object.keys(data.resources).forEach(function (heading) {
      html += '<h2>' + esc(heading) + '</h2><ul>' + data.resources[heading].map(function (r) {
        return '<li><span class="tag file">' + esc(r.kind) + '</span>' + link(r.url, r.title) + (r.note ? '<span class="rnote">' + r.note + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
    });
    el.innerHTML = html;
  }

  // ---------- simple bindings (policies page) ----------
  // <span data-course="midterm.long"></span>, <a data-course-href="app.url">
  function bindValues(data) {
    var c = data.course, exams = {};
    data.schedule.forEach(function (x) { if (x.type === 'exam') exams[x.title === 'Midterm' ? 'midterm' : 'final'] = x; });
    var values = {
      'app.url': c.app.url, 'app.label': c.app.label,
      'book.title': c.book.title, 'book.abbrev': c.book.abbrev, 'book.pdf': c.book.pdf, 'book.reader': c.book.reader || c.book.pdf,
      'midterm.long': exams.midterm ? longDate(exams.midterm.date) : '', 'midterm.note': exams.midterm ? exams.midterm.note : '',
      'final.long': exams.final ? longDate(exams.final.date) + ', ' + timeRange(exams.final.start, exams.final.end) : '',
      'final.where': exams.final ? exams.final.where : '',
      'homework.count': c.homework.count,
      'instructor.title': c.instructor.title, 'instructor.name': c.instructor.name,
      'instructor.email': c.instructor.email || '',
      'instructor.mailto': c.instructor.email ? 'mailto:' + c.instructor.email : '',
      'ta.name': c.ta.name, 'ta.email': c.ta.email || '',
      'ta.mailto': c.ta.email ? 'mailto:' + c.ta.email : ''
    };
    document.querySelectorAll('[data-course]').forEach(function (el) { var v = values[el.getAttribute('data-course')]; if (v != null) el.textContent = v; });
    document.querySelectorAll('[data-course-href]').forEach(function (el) { var v = values[el.getAttribute('data-course-href')]; if (v != null) el.setAttribute('href', v); });
  }

  // ---------- Grade calculator (policies page) ----------
  function gradeCalc(data) {
    var el = document.getElementById('calc'); if (!el) return;
    var g = data && data.course && data.course.grading;
    var bonus = g ? g.bonus   : +el.getAttribute('data-bonus');
    var n     = g ? g.hwCount : +el.getAttribute('data-hw');
    var w     = g ? [g.weights.problemSets, g.weights.midterm, g.weights.final, g.weights.participation]
                  : el.getAttribute('data-weights').split(',').map(Number);
    var scale = (g && g.scale) || [[93,'A'],[90,'A\u2212'],[87,'B+'],[83,'B'],[80,'B\u2212'],[77,'C+'],
                                   [73,'C'],[70,'C\u2212'],[67,'D+'],[63,'D'],[60,'D\u2212'],[0,'F']];
    var fields = [], i;
    for (i = 1; i <= n; i++) fields.push({ id: 'hw' + i, label: 'HW ' + i });
    fields.push({ id: 'mid', label: 'Midterm' });
    fields.push({ id: 'fin', label: 'Final' });
    fields.push({ id: 'part', label: 'Particip.', value: 95 });

    el.querySelector('.calc-grid').innerHTML = fields.map(function (f) {
      return '<label class="calc-f" for="c-' + f.id + '"><span>' + esc(f.label) + '</span>' +
             '<input class="mono" id="c-' + f.id + '" type="number" min="0" max="110" step="0.1" inputmode="decimal"' +
             (f.value != null ? ' value="' + f.value + '"' : '') + '></label>';
    }).join('');

    var numEl = el.querySelector('#calc-num'), ltrEl = el.querySelector('#calc-ltr'),
        basisEl = el.querySelector('#calc-basis'), evalBox = el.querySelector('#c-eval');

    function val(id) { var v = parseFloat(el.querySelector('#c-' + id).value); return isFinite(v) ? v : null; }

    function run() {
      var hw = [], k, v;
      for (k = 1; k <= n; k++) { v = val('hw' + k); if (v != null) hw.push(v); }
      var parts = [];
      if (hw.length) parts.push([w[0], hw.reduce(function (a, b) { return a + b; }, 0) / hw.length]);
      var m = val('mid'), f = val('fin'), p = val('part');
      if (m != null) parts.push([w[1], m]);
      if (f != null) parts.push([w[2], f]);
      if (p != null) parts.push([w[3], p]);

      // participation alone is a prefilled default, not a result worth showing
      var graded = hw.length || m != null || f != null;
      var tw = parts.reduce(function (a, x) { return a + x[0]; }, 0);
      if (!graded || !tw) { numEl.textContent = '\u2014'; ltrEl.textContent = '\u2014';
                 basisEl.textContent = 'Enter at least one problem-set or exam grade.'; return; }

      var total = parts.reduce(function (a, x) { return a + x[0] * x[1]; }, 0) / tw;
      if (evalBox && evalBox.checked) total += bonus;
      total = Math.round(total * 10) / 10;
      numEl.textContent = total.toFixed(1);

      var L = scale[scale.length - 1][1];
      for (k = 0; k < scale.length; k++) { if (total >= scale[k][0]) { L = scale[k][1]; break; } }
      ltrEl.textContent = L;

      var pct = Math.round(tw);
      basisEl.textContent = (hw.length === n && m != null && f != null && p != null)
        ? 'Everything entered \u2014 this is the whole course grade.'
        : 'Based on the ' + pct + '% of the course grade you have filled in, projected as if the rest went the same way.';
    }

    el.addEventListener('input', run);
    el.addEventListener('change', run);
    run();
  }

  // ---------- go ----------
  var here = location.pathname.replace(/[^/]*$/, '');
  fetch(here + 'data/course.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      window.__course = prepare(data);
      renderHeroMeta(data.course);
      renderFacts(data.course);
      renderSchedule(data);
      renderNext(data);
      renderResources(data);
      bindValues(data);
      gradeCalc(data);
      // a #hash link to a row rendered after load
      if (location.hash) { var t = document.querySelector(location.hash); if (t) t.scrollIntoView(); }
    })
    .catch(function (err) {
      gradeCalc(null);
      var el = document.getElementById('schedule') || document.getElementById('resources');
      if (el) el.innerHTML = '<p class="dim">Couldn’t load <code>data/course.json</code> (' + esc(err.message) + '). ' +
        'If you opened this file directly from disk, serve the folder over http instead (e.g. <code>python3 -m http.server</code>), or view it at www.makingminds.org.</p>';
    });
})();
