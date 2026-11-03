// Google Apps Script: appends one full-bleed slide per PNG in a Drive folder, in filename order, with speaker notes
// from speaker-notes.json in the same folder (written by `npm run gslides:notes`). Paste into script.google.com, set
// the two IDs and run addPngSlides. Each run appends; delete earlier slides before running again.
const PRESENTATION_ID = 'PASTE_ID'; // from docs.google.com/presentation/d/<ID>/edit
const FOLDER_ID = 'PASTE_ID';       // from drive.google.com/drive/folders/<ID>

function addPngSlides() {
  const deck = SlidesApp.openById(PRESENTATION_ID);
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const w = deck.getPageWidth(), h = deck.getPageHeight(); // 16:9 deck → image fills the slide

  const json = folder.getFilesByName('speaker-notes.json');
  const notes = json.hasNext() ? JSON.parse(json.next().getBlob().getDataAsString()) : {};

  const files = [];
  const it = folder.getFilesByType(MimeType.PNG);
  while (it.hasNext()) files.push(it.next());
  files.sort((a, b) => (a.getName() < b.getName() ? -1 : a.getName() > b.getName() ? 1 : 0)); // byte order, as in google-slides-notes.ts

  for (const f of files) {
    const slide = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    slide.insertImage(f.getBlob(), 0, 0, w, h);
    const text = notes[f.getName()];
    if (text) slide.getNotesPage().getSpeakerNotesShape().getText().setText(text);
  }
}
