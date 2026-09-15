# Making Minds — Phil 133 course website

Source for **www.makingminds.org** (GitHub Pages, served from the root of `main`).

Static site, no build step: `index.html` (schedule), `policies.html`, `resources.html`, one stylesheet (`assets/site.css`), one script (`assets/next-class.js`, the "next class / next due" box, Los Angeles time), and the course PDFs under `uploads/` (paths unchanged from the old Weebly site). `.nojekyll` keeps GitHub Pages from skipping files that start with an underscore (e.g. `_mm_11.20.25.pdf`). Editing notes are in the schedule page's source and in the course project.
