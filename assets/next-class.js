/* "Up next" box. Copies the next lecture/exam row and the next homework row
   out of the schedule table, so they look exactly like the schedule. Uses
   Los Angeles time; a class stays "next" until it ends (the row's data-end,
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

  function labelRow(text, href) {
    var tr = document.createElement('tr');
    tr.className = 'lbl';
    var td = document.createElement('td');
    td.colSpan = 4;
    var chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = text;
    td.appendChild(chip);
    if (href) {
      var a = document.createElement('a');
      a.href = href;
      a.className = 'jump';
      a.textContent = 'show in schedule ↓';
      td.appendChild(a);
    }
    tr.appendChild(td);
    return tr;
  }
  function copyRow(tr) {
    var c = tr.cloneNode(true);
    c.removeAttribute('id');
    return c;
  }
  // The homework reminder is just "HW1 due · 11:59pm": no title, no coverage note.
  function copyDueRow(tr) {
    var c = copyRow(tr);
    var sub = c.querySelector('td.topic .sub');
    if (sub) sub.parentNode.removeChild(sub);
    var note = c.querySelector('td.readings');
    if (note) note.textContent = (note.textContent.split('\u00b7')[0] || '').trim();
    return c;
  }

  var table = document.createElement('table');
  table.className = 'sched';
  var tbody = document.createElement('tbody');

  if (!next && !due) {
    tbody.appendChild(labelRow('Fall 2026 · the quarter is over — thanks for a great course'));
  } else {
    if (next) {
      var isExam = next.getAttribute('data-kind') === 'exam';
      var isToday = next.getAttribute('data-end').slice(0, 10) === today;
      var label = isExam ? (isToday ? 'Today' : 'Next up') : (isToday ? 'Today’s class' : 'Next class');
      tbody.appendChild(labelRow(label, next.id ? '#' + next.id : null));
      tbody.appendChild(copyRow(next));
    }
    if (due) {
      tbody.appendChild(labelRow('Next due', due.id ? '#' + due.id : null));
      tbody.appendChild(copyDueRow(due));
    }
  }
  table.appendChild(tbody);
  box.innerHTML = '';
  box.appendChild(table);
  box.hidden = false;
})();
