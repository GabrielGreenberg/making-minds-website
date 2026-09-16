# Making Minds — Phil 133 course website

Source for **www.makingminds.org** (GitHub Pages, served from the root of `main`).

## Where the information lives

**`data/course.json` is the single source of truth.** The pages are shells: `assets/site.js` fetches the JSON and renders the hero details, the course-facts grid, the "next class / next due" box, the schedule, and the Resources list; a few values on the Policies page (exam dates, course-app link) are bound to it too. Edit the JSON and the site updates on the next push — no build step.

- `course` — code, title, term, instructor/TA (with office hours), lecture days/time/room, sections, course book links, course app, homework defaults, calendar anchors (`weekOneMonday` drives the UCLA week numbers).
- `units` — unit numbers and names (unit colors are `--u1`…`--u3` in the CSS).
- `schedule` — one entry per row, in order. `type` is `lesson` (date, unit, topic, `read`, optional `recommended`), `hw` (date, n, title, covers, optional note), `exam` (date, title, start/end, where, note) or `holiday` (date, title). Dates are ISO `YYYY-MM-DD`; weekday labels and week numbers are computed. A lecture counts as "next" until `course.lecture.end` on its day; an exam until its own `end`.
- Readings: `{"mm": "Chapter"}` for a course-book chapter; otherwise `{tag, cite, url, linkText, note}` (or `links: [{url, text}, …]` for several links). `cite`/`note` may contain `<i>…</i>` and `<a>`; `label` (e.g. "Of interest:") is optional; `{"html": …}` is the escape hatch.
- `resources` — headings → lists of `{kind, url, title, note}`.

## Files

`index.html`, `policies.html` (mostly prose, kept in the HTML), `resources.html`, `assets/site.css`, `assets/site.js`, `assets/splash.jpg`, `data/course.json`, `uploads/…` (course PDFs, paths unchanged from the old site), `.nojekyll` (so GitHub Pages serves underscore-prefixed files such as `_mm_11.20.25.pdf`), `CNAME`.

Previewing locally: the pages fetch the JSON, so open them through a local server (`python3 -m http.server` in this folder, then http://localhost:8000/), not as `file://`.
