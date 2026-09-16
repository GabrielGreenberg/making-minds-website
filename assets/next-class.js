/* "Up next" box: two compact lines built from the schedule table — the next
   lecture/exam (with its required readings) and the next homework deadline.
   Los Angeles time; a class stays "next" until it ends (the row's data-end:
   1:45pm for lectures, 6pm for the final), then the box rolls over. */
(function () {
  var box = document.getElementById('next');
  if (!box) return;

  // Current time in Los Angeles as "YYYY-MM-DDTHH:MM" (compares as a string).
  function nowLA() {
    var p = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    var h = p.hour === '24' ? '00' : p.hour;
    return p.year + '-' + p.month + '-' + p.day + 'T' + h + ':' + p.minute;
  }
  var now = nowLA();
  var today = now.slice(0, 10);

  function firstAfter(selector, attr) {
    var rows = document.querySelectorAll('table.sched ' + selector);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute(attr) > now) return rows[i];
    }
    return null;
  }
  var next = firstAfter('tr[data-end]', 'data-end');
  var due = firstAfter('tr[data-due]', 'data-due');

  function text(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }
  // Topic cell text without its .sub line.
  function topicOf(tr) {
    var td = tr.querySelector('td.topic'), out = '';
    td.childNodes.forEach(function (n) {
      if (n.nodeType === 3) out += n.textContent;
      else if (n.nodeType === 1 && !n.classList.contains('sub')) out += n.textContent;
    });
    return out.replace(/\s+/g, ' ').trim();
  }
  function line(label, tr, mainText, detailHtml) {
    var row = document.createElement('div');
    row.className = 'nx';
    var chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = label;
    var body = document.createElement('div');
    body.className = 'nx-body';
    var a = document.createElement('a');
    a.className = 'nx-main';
    if (tr && tr.id) a.href = '#' + tr.id;
    a.innerHTML = '<span class="mono nx-date">' + text(tr.querySelector('td.date')) + '</span> ' + mainText;
    body.appendChild(a);
    if (detailHtml) {
      var d = document.createElement('div');
      d.className = 'nx-detail';
      d.innerHTML = detailHtml;
      body.appendChild(d);
    }
    row.appendChild(chip);
    row.appendChild(body);
    return row;
  }

  box.innerHTML = '';
  if (!next && !due) {
    var done = document.createElement('div');
    done.className = 'nx-done';
    done.textContent = 'Fall 2026 · the quarter is over — thanks for a great course.';
    box.appendChild(done);
  } else {
    if (next) {
      var isExam = next.getAttribute('data-kind') === 'exam';
      var isToday = next.getAttribute('data-end').slice(0, 10) === today;
      var label = isExam ? (isToday ? 'Today' : 'Next up') : (isToday ? 'Today’s class' : 'Next class');
      var main = topicOf(next), detail = '';
      if (isExam) {
        var sub = text(next.querySelector('td.topic .sub'));
        if (sub) main += ' <span class="dim">· ' + sub + '</span>';
        detail = text(next.querySelector('td.readings'));
      } else {
        var items = [];
        next.querySelectorAll('.rg.read li').forEach(function (li) { items.push(li.innerHTML.trim()); });
        if (items.length) detail = '<span class="rl">Read</span> ' + items.join(' <span class="sep">·</span> ');
      }
      box.appendChild(line(label, next, main, detail));
    }
    if (due) {
      box.appendChild(line('Next due', due, topicOf(due) + ' <span class="dim">· 11:59pm</span>', ''));
    }
  }
  box.hidden = false;
})();
