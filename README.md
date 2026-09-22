# Making Minds — Phil 133 course website

Source for **www.makingminds.org** (GitHub Pages, served from the root of `main`).

## Where the information lives

**`data/course.json` is the single source of truth.** The pages are shells: `assets/site.js` fetches the JSON and renders the hero details, the course-facts grid, the "next class / next due" box and the syllabus table; a few values on the Policies page (exam dates, course-app link) are bound to it too; `reader/reader.js` renders the Reader (the outside readings) from the same file. Edit the JSON and the site updates on the next push — no build step.

- `course` — code, title, term, instructor/TA (with office hours), lecture days/time/room, sections, course book links, course app, homework defaults, calendar anchors (`weekOneMonday` drives the UCLA week numbers).
- `units` — unit numbers and names (unit colors are `--u1`…`--u3` in the CSS).
- `schedule` — one entry per row, in order. `type` is `lesson` (date, unit, topic, `read`, optional `recommended`), `hw` (date, n, title, covers, optional note), `exam` (date, title, start/end, where, note) or `holiday` (date, title). Dates are ISO `YYYY-MM-DD`; weekday labels and week numbers are computed. A lecture counts as "next" until `course.lecture.end` on its day; an exam until its own `end`.
- Readings: `{"mm": "Chapter"}` for a course-book chapter; otherwise `{tag, cite, url, linkText, note}` (or `links: [{url, text}, …]` for several links). `cite`/`note` may contain `<i>…</i>` and `<a>`; `label` (e.g. "Of interest:") is optional; `{"html": …}` is the escape hatch. `short` is the compact form the syllabus shows — author (year) and the assigned titles, e.g. `Hillis (1999), “Nuts and Bolts”`; page selections just say “excerpt”, section selections keep their numbers — and it links to the Reader (or to the outside URL, marked ↗), where the full `cite`/`note` live. Without `short` the syllabus shows the full citation. An outside reading hosted on this site adds `id` (a stable key such as `chomsky-1957`) and `file` (the PDF's path), plus `filePage` when the assigned part starts inside a longer PDF; the schedule then links that reading into the Reader (`reader/#chomsky-1957`, `reader/#crane-2003/p96`), and `course.readings.reader` is where the Reader lives.
- `resources` — headings → lists of `{kind, url, title, note}`; the Reader shows these as "Background" (an item whose `url` is a reading's `file` joins that reading).

## The Reader (`reader/`)

`reader/index.html` + `reader.js` + `reader.css` — the outside readings, sorted by due date (the schedule's lessons, required readings listed and recommended ones folded) or by name (A–Z by first author, one entry per work). A reading with a `file` is rendered in the page with pdf.js (shared with the course-book reader, `book/pdfjs/`), with a Download button; anything else gets a citation card and an "Open" button to wherever it lives. Hash forms: `#<id>`, `#<id>/p12`. Readings without an `id` in the JSON get one derived from the citation (author + year), so `reader/#turing-1950` works without editing anything. New PDFs can go anywhere under the site; `reader/files/` is the intended home for ones added from now on.

## Files

`index.html`, `policies.html` (mostly prose, kept in the HTML), `resources.html` (now just a redirect to `reader/`), `reader/` (the Reader), `book/` (the course book: PDF, web reader, generated chapter data), `assets/site.css`, `assets/site.js`, `assets/splash.jpg`, `data/course.json`, `uploads/…` (course PDFs, paths unchanged from the old site), `.nojekyll` (so GitHub Pages serves underscore-prefixed files such as `_mm_11.20.25.pdf`), `CNAME`.

Previewing locally: the pages fetch the JSON, so open them through a local server (`python3 -m http.server` in this folder, then http://localhost:8000/), not as `file://`.
