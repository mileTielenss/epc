# Werkwijze voor Claude in deze repo

## SPEC.md is de bron van waarheid

`SPEC.md` beschrijft exact en volledig wat de app moet doen. Elke functionaliteit
daarin is **bewust gekozen** door de gebruiker. Daarom:

1. **Lees `SPEC.md` volledig** voor je iets aan de app wijzigt.
2. Bij elke gevraagde wijziging: **pas eerst `SPEC.md` aan** (of in dezelfde commit),
   en breng daarna de code in lijn met de spec. Spec en code mogen nooit uiteenlopen.
3. **Verwijder of verplaats nooit functionaliteit** die in `SPEC.md` staat, tenzij de
   gebruiker daar expliciet om vraagt — en schrap ze dan óók uit de spec.
4. Twijfel of iets een bug of een feature is? De spec beslist. Staat het er niet in,
   vraag het of voeg het bewust toe aan de spec.
5. Na afloop van een sessie met wijzigingen moet `SPEC.md` opnieuw de volledige,
   actuele waarheid zijn — iemand moet de app louter uit de spec kunnen herbouwen.

## Vaste afspraken

- Vanilla HTML/CSS/JS, geen dependencies, alles in het Nederlands (UI én commits).
- Bestanden: `index.html`, `app.js`, `db.js`, `maakpdf.js`, `pdfworker.js`,
  `style.css`, `sw.js`, `manifest.json` — zie de tabel in `SPEC.md` §2.
- Werk **direct op `main`**; push deployt automatisch naar GitHub Pages.
  Branches `v1`, `v2`, … zijn historische checkpoints — nooit op verder bouwen.
  Maak op vraag van de gebruiker een nieuwe checkpoint-branch vóór grote verbouwingen.
- **Eén versieconstante**: `VERSIE` in `sw.js`. Bump die bij elke release; `app.js`
  kent geen versie.
- Destructieve acties gebruiken `confirm()`/`prompt()`, **behalve foto's**: die
  krijgen een undo-toast van 6 s (SPEC.md §1).
- Testen vóór elke push (SPEC.md §11):
  - `node --check` op `app.js`, `db.js`, `maakpdf.js`, `pdfworker.js`, `sw.js`.
  - Unit-tests van `maakpdf.js` in Node (AFM-waarden, DeviceGray, progressive-fout).
  - Playwright-klikflows op iPhone-viewport (393×852), bij voorkeur WebKit
    (WebKit ≠ mobile Safari); camera met
    `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`.
    Na `page.fill` is de tabbalk verborgen: eerst blurren.
  - PDF valideren: `qpdf --check`, dan pypdf (tekst, paginaformaten), dan
    `pdftoppm` op drie pagina's.
  - Failsafes: geïnjecteerde `QuotaExceededError` → rode balk; verwijderen
    geblokkeerd zolang `pdfBewaardOp === null`.
- Wat alleen op het echte toestel te testen valt (share, user gesture, camera,
  torch, EXIF) staat in de handmatige iPhone-checklist in SPEC.md §11 — vermeld
  bij een release expliciet dat die checklist bij de gebruiker ligt.
- Verifieer na de deploy dat `https://miletielenss.github.io/epc/sw.js` de nieuwe
  versie serveert.
- `normaliseer()` corrigeert nooit stil: elke correctie in `woning.problemen[]`
  plus één toast (SPEC.md §5.1).
- Wat iOS niet kan (bv. torch in getUserMedia, share zonder user gesture) wordt
  eerlijk opgevangen met een fallback en zo in de spec gedocumenteerd.
