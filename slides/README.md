# Slides

Drop your deck here as images (PNG, JPG, WebP, GIF or SVG), one file per slide, exported at the
display's aspect ratio (16:9, 1920×1080 or larger). Files are ordered by name with numbers compared
numerically, so `slide-2.png` comes before `slide-10.png`. New files show up on the console without a
restart. Builds and transitions are not preserved: export each build step as its own image.

The console shows the deck as a thumbnail strip. `S` shows or hides the current slide on the display,
`X` and `Z` step forward and back through it, and `P` or "Live view" returns the display to the live
phase view. Page Up, Page Down, the arrow keys and Escape do nothing, so a presentation clicker will
not move the deck. The room's state keeps running underneath, so you can set up the next phase while
a slide is on screen and reveal it when ready.

Set `SLIDES_DIR` in `.env` to use a folder elsewhere.

## Run-of-show slides

The files are numbered 01 to 25 in the order they go up, so each file's number is the number the console shows
under its thumbnail. They follow the cheat sheet (`docs/speaker-cheat-sheet.html`) in six parts. `01`–`06` open the
talk: `05` sets up Project Atlas, the scenario every part runs on, and lists the six parts against it; `06`
explains how to read the screen. Each part then has a mint SETUP slide (the idea, and what the room does in
each of its presets) that goes up before the live stretch, and a forest LESSONS slide that goes up after it: `07`/`08`
part 1 (presets 01–02), `09`/`10` part 2 (03–05), `11`/`12` part 3 (06–08), `13`/`14` part 4 (09–10), `15`/`19`
part 5 (11–13, with the Buy, Blend and Build section slides `16`, `17`, `18` between them), `20` the Context Window
Architecture statement slide with its four planes and the question each answers, `21`/`22` part 6 (14–15), `23` the
recap, and `24`–`25` the closing pair. The caption in the corner of each generated slide names the presets to run
with it. The optional activities A1–A5 have no slides; the display carries them. A slide added later means
renumbering the files after it, and the stems in `scripts/show-slides.py`, `scripts/cheatsheet.ts`, the transcripts and the spec, the slide numbers in
`shared/src/runsheet.ts`, and `firstSlide` in `TALK_PARTS` (`shared/src/presets.ts`).

Those generated slides, `02`, `05` and `20` come from `scripts/show-slides.py`: edit the copy there and run `python3 scripts/show-slides.py`
to rewrite them. The speaker line on `02` is a placeholder: put your name, role and company in `TITLE` before the talk. Fonts, the AfroTech artwork and the floorplan on `20` live in `slides/src`.

## Google Slides copy

`slides-png/` (not in this folder, so the console does not load it) holds one 1920×1080 PNG per slide, named like the
SVGs, plus the app captures that `slides-png/README-app-backup.md` lists. The folder is not tracked in git. To build a
Google Slides deck from it with speaker notes:

1. Write the notes file. It maps every PNG to its run-sheet steps in `notes/speaker-notes.md` and prints the table:

   ```bash
   npm run gslides:notes
   ```

   Output: `slides-png/speaker-notes.json`. A capture whose beat has no step (the `25a-…` appendix) gets the README's
   description instead.
2. Upload the PNGs you want in the deck and `speaker-notes.json` to one Google Drive folder. Every PNG in it becomes a
   slide.
3. Set the presentation to 16:9 (File → Page setup) and delete its blank first slide.
4. Paste `scripts/google-slides-import.gs` into a new project at script.google.com, set `PRESENTATION_ID` and
   `FOLDER_ID` from the two URLs, and run `addPngSlides`. Each run appends; delete the earlier slides before running it
   again.
