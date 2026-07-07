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
- Werk **direct op `main`**; push deployt automatisch naar GitHub Pages.
  Branches `v1`, `v2`, … zijn historische checkpoints — nooit op verder bouwen.
  Maak op vraag van de gebruiker een nieuwe checkpoint-branch vóór grote verbouwingen.
- **Bump bij elke release de cache-versie in `sw.js` én `APP_VERSIE` in `app.js`**
  (zelfde `epc-vNN`-waarde), anders krijgen toestellen de update niet of blijft
  het zelfherstel herladen.
- **Test vóór elke push** met Playwright in de meegeleverde Chromium
  (`/opt/pw-browsers/chromium-*/chrome-linux/chrome`; camera met
  `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`):
  volledige klikflows op iPhone-viewport (390×844), PDF-inhoud (`bouwPrintDocument()`),
  en persistentie na een reload. Plus `node --check` op alle JS.
- Verifieer na de deploy dat `https://miletielenss.github.io/epc/sw.js` de nieuwe
  versie serveert.
- Oude woningrecords moeten altijd blijven werken: migraties horen in
  `normaliseer()` en zijn nooit destructief.
- Wat iOS niet kan (bv. torch in getUserMedia, window.print in standalone) wordt
  eerlijk opgevangen met een fallback en zo in de spec gedocumenteerd.
