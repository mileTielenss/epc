# Testsuite — EPC Plaatsbezoek

Volledige suite volgens SPEC.md §11. De app zelf blijft dependency-vrij; alle
tooling leeft hier.

## Eenmalig

```
cd tests
npm install
npx playwright-core install webkit   # PLAYWRIGHT_BROWSERS_PATH respecteren indien gezet
```

Voor de PDF-validatieketen zijn ook `qpdf` en `pdftoppm` (poppler-utils) nodig,
plus `pip install pypdf` voor de tekstextractie.

## Draaien

| Commando | Wat |
|---|---|
| `npm run unit` | Node-unittests: `maakpdf.js` (AFM, CP1252, SOF, sortering, volledige bouw), `pdfworker.js` en `sw.js` met stubs |
| `npm run flows` | WebKit-klikflows op iPhone-viewport: woning → PDF → verwijderen, failsafes, clean-start van een oude databank |
| `npm run camera` | Chromium-cameraflows (nepcamera-vlaggen bestaan enkel in Chromium) |
| `npm run dekking` | draait de Node-tests én de Chromium-dekkingssuite, voegt alle V8-dekking samen en **faalt onder 100% regeldekking** op de vijf app-bestanden |

## PDF-validatie (release-stap)

```
node unittest-maakpdf.mjs
qpdf --check uitvoer/unittest.pdf
python3 -c "from pypdf import PdfReader; r = PdfReader('uitvoer/unittest.pdf'); print(len(r.pages), 'paginas'); [p.extract_text() for p in r.pages]"
pdftoppm -png -r 40 -f 1 -l 3 uitvoer/unittest.pdf uitvoer/pagina
```

## Valkuilen

- Na `page.fill` is de tabbalk verborgen (toetsenbordgedrag): eerst blurren.
- WebKit op Linux bewaart geen Blobs in IndexedDB in een tijdelijk profiel;
  de flows gebruiken daarom `launchPersistentContext` met een vers profiel.
- `waitForSelector('#x[hidden]')` wacht op zichtbaarheid en hangt dus altijd:
  gebruik `{ state: 'hidden' }` of `waitForFunction`.
