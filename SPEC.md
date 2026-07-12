# SPEC — EPC Plaatsbezoek
Bron van waarheid. Code die afwijkt is een bug. Wijzigingen beginnen hier.
Geen versienummers of regelaantallen in dit bestand.
## 1. Doel
Mobile-first offline PWA voor één energiedeskundige type A (Vlaanderen), op één
iPhone. Verzamelt tijdens het plaatsbezoek gegevens en foto's per ruimte.
- Nieuwe woning starten, al wandelend invullen. Dagen later aanvullen kan.
- Op het einde "Bewaar dossier": een **zip** met de PDF (het eigenlijke dossier,
  10 jaar bewaarplicht), de hoofdfoto als losse `hoofdfoto.jpg`, alle foto's als
  jpeg in `fotos/`, en een `woning.json` met alle gegevens — voor latere
  automatisaties (de json bevat geen beeldbytes, wel verwijzingen naar `fotos/`).
- Diezelfde zip kan via "Importeer dossier" op de woningenlijst integraal terug
  ingeladen worden — ook jaren later (§9.4).
- Na oplevering wordt de woning verwijderd. Verwijderen kan pas ná een geslaagd
  dossier.
- Invoer in de VEKA-software gebeurt manueel of via latere automatisatie op
  basis van `woning.json`; de PDF blijft het leesbare dossier.
- Eén gebruiker: geen accounts, geen instellingen, geen hulpteksten, geen updateknop.
- Alles Nederlands: UI, commentaar, commits, spec.
### UI-principes
- Minimum aan kliks. Elke sectie mag leeg blijven.
- Meter met komma-decimalen (`1,335`); m² en m³ rekenen live mee tijdens typen.
- Destructief = `confirm()`, behalve foto's: die krijgen een undo-toast van 6 s
  (blob wordt pas gewist als de toast verloopt).
- Bij focus op input/textarea verdwijnt de tabbalk (klasse `toets`); bij focusout na
  60 ms controle komt hij terug.
## 2. Bestanden
Vanilla HTML/CSS/JS. Nul dependencies, geen build-stap.
| Bestand | Rol |
|---|---|
| `index.html` | één pagina, alle views |
| `app.js` | UI en applicatielogica |
| `db.js` | IndexedDB: open, CRUD, blob-URL-cache, foutkanaal |
| `maakpdf.js` | PDF-generator uit de `woning.json`-structuur, `bouwPdf(dossierWoning, Map<pad,{bytes}>) → Blob` (was `pdf.js`) |
| `maakzip.js` | zip-schrijver en -lezer (store + CRC-32, geen compressie) en `woningExport()` voor `woning.json`; puur, Node-testbaar |
| `pdfworker.js` | `new Worker`, importeert `maakpdf.js` en `maakzip.js`, bouwt de dossier-zip, postMessage voortgang |
| `style.css` | opmaak, CSS-variabelen in `:root` |
| `sw.js` | service worker, **enige** versieconstante `const VERSIE = 'epc-vNN'` |
| `manifest.json` | "EPC Plaatsbezoek", standalone, portrait, `#0a6b3d` |
| `icon-180/192/512.png` | `node tools/make-icons.js` |
| `.github/workflows/deploy.yml` | Pages-deploy bij push naar `main` |
`maakpdf.js` importeert niets en bouwt de PDF **volledig uit de geneste
`woning.json`-structuur** (§9.3.1), niet uit het interne model: input =
`bouwPdf(dossierWoning, Map<pad, {bytes:Uint8Array}>, {versie, voortgang})`,
met de foto's op hun `fotos/000N.jpg`-pad. Los testbaar in Node.
Kleuren: accent `#0a6b3d`, accent-donker `#07522e`, inkt `#101418`, gedempt
`#5a6570`, achtergrond `#eef1f3`, kaart `#ffffff`, lijn `#c9d1d8`, waarschuwing
`#b3261e`. Systeemfont, `html{font-size:14px}`.
## 3. Deploy
- GitHub Pages, `https://miletielenss.github.io/epc/`, repo `mileTielenss/epc`.
- Push naar `main` → upload-pages-artifact → deploy-pages. Direct op `main` werken.
- Eén versieconstante: `VERSIE` in `sw.js`. `app.js` kent geen versie.
## 4. Service worker
- Install: cachet alle assets in cache `VERSIE`. **Geen `skipWaiting()`.**
- Activate: verwijdert alle andere caches, dan `clients.claim()`.
- Fetch: cache-first, **uitsluitend uit de eigen cache**
  (`caches.open(VERSIE).match(req, {ignoreSearch:true})`). Miss → netwerk, gelukte
  same-origin-responses bijcachen. Offline navigatie → `./index.html` uit eigen cache.
- Geen `message`-handler.
- App-kant: `register(..., {updateViaCache:'none'})`, `reg.update()` bij start en bij
  visibilitychange. Verder niets.
- De nieuwe versie draait zodra de app uit de app-switcher geveegd en heropend wordt.
  Geen `controllerchange`-reload: een reload middenin een camerasessie is dataverlies.
- `VERSIE` wordt doorgegeven aan de generator en komt in `/Producer` van de PDF.
  `sw.js` staat daarvoor mee in de asset-cache: de app fetcht `./sw.js` (die uit
  de eigen cache komt en dus bij de draaiende versie hoort) en leest de constante
  eruit. SW-updates gebeuren buiten de fetch-handler om, dus dit blokkeert niets.
## 5. Datamodel
IndexedDB `epc-db`, versie 3. Geen upgradepad: `onupgradeneeded` maakt de stores
aan en maakt een databank van een oudere versie **leeg** (bewuste keuze — clean
start; records in het oude formaat zijn onbruikbaar en zouden anders
onverwijderbaar blijven omdat verwijderen een geslaagde PDF vereist).
| Store | keyPath | Index | Inhoud |
|---|---|---|---|
| `woningen` | `id` | — | woningrecord, **zonder beeldbytes** |
| `fotos` | `id` | `woningId` | `{id, woningId, blob, breedte, hoogte, groep, volgorde, gemaakt}` |
- Geen `instellingen`-store.
- Foto's zijn Blobs, geen dataURLs. Een woningrecord is enkele kB; een foto wordt één
  keer geschreven, bij de opname.
- `groep` = `'gevels' | 'algemeen' | ruimteId`. De fotostore is de enige waarheid over
  foto's; het woningrecord heeft geen `fotodossier`-array.
- Foto's die aan een element hangen (raam-afstandhouder, kenplaat, kranen) staan in
  dezelfde store maar met `groep: null`: ze horen niet bij het dossier en worden enkel
  via hun `fotoId` bereikt.
- Ids overal, nooit namen. Geen `nr`/`teller`-velden: volgnummers worden afgeleid uit
  de sorteervolgorde (§7.4), zodat lijst en PDF niet kunnen verschillen.
```
woning = {
  id: base36-timestamp + '-' + random5,
  nummer: geheel getal,        // dossiernummer (§7.1), app-zijde; niet in pdf/json
  gemaakt, gewijzigd,          // ISO
  pdfBewaardOp: ISO | null,    // enige statusbron
  algemeen: { adres, datum (YYYY-MM-DD, default vandaag), notities,
              hoofdFotoId | null },   // moet een foto met groep 'gevels' zijn
  ruimtes: [ { id, naam,
               vent: 'geen'|'natuurlijk'|'mechanisch'|'mechanisch-permanent'|'ander',
               ventBeschrijving, opm,
               afm: {b,d,h} | null } ],   // enkel bij eigen toestel, zie §7.4
  ramen: [ { id, ruimteId,
             element: 'raam'|'deur'|'dakraam',
             gevel: 'voor'|'achter'|'links'|'rechts',
             b, h, aantal (>=1),
             beglazing: 'enkel'|'dubbel'|'hr-dubbel'|'drievoudig'|'paneel'
                        | null,   // deur: altijd null, enkel het profiel telt
             kader: 'pvc'|'alu'|'hout', rolluik (bool),
             fotoId | null } ],
  energie: {
    opwekkers: [ { id,
                   type: 'gas'|'stookolie'|'andere'         // centraal, ruimteId=null
                       | 'airco'|'kachel'|'ruimte-andere',  // ruimtegebonden
                   ruimteId | null,
                   functie: ['radiatoren'|'vloer'|'sww'],
                   beschrijving, fotoId, fotoKraanId } ],
    pvPanelen: [ { id, orientatie: 'plat'|'voor'|'achter'|'links'|'rechts'|'', wp } ],
    zonneboiler: 'nee'|'ja', zonneboilerM2
  }
}
```
Nieuwe woning start met Living, Keuken, Badkamer, WC, Slaapkamer 1 en Hal.
Bewust niet ingevoerd: bouwjaar, gebouwtype, kelder, zolder, oriëntatie van de
voorgevel, beschermd volume. Die komen uit documenten, plannen of de VEKA-software.
### 5.1 `normaliseer()` bij elke load
- Ontbrekende velden → defaults. Enum buiten de set → default.
- Dode `ruimteId`/`fotoId` → `null`, item blijft bestaan.
- `hoofdFotoId` dat geen `gevels`-foto meer is → `null`.
- Elke correctie in `woning.problemen[]`, één toast "N gegevens hersteld".
  Stil corrigeren is verboden.
- Weesfotosweep bij app-start (op idle, faalt stil): foto's zonder bestaande woning of
  zonder verwijzing.
### 5.2 Blob-URLs
`db.js` houdt `Map<fotoId, objectURL>`. Lui aanmaken, revoken bij het sluiten van de
woning en bij `pagehide`. Nooit een objectURL per render.
## 6. Failsafes
De app is het enige exemplaar van het bewijsmateriaal tot de PDF bestaat.
- **Autosave**: dirty-vlag + debounce 500 ms, plus `pagehide` en `visibilitychange`
  (verborgen). Geen interval. `{durability:'strict'}` in een `try`.
- Geslaagd = `tx.oncomplete`, niet `request.onsuccess`.
- **Succes**: geen ruis, alleen een groen bolletje van 400 ms rechtsboven.
- **Falen**: permanente rode balk "NIET OPGESLAGEN — <foutnaam>". Dirty-vlag blijft,
  retry elke 5 s, balk verdwijnt enkel bij een geslaagde write. De oude savestamp
  toonde altijd "opgeslagen", ook wanneer het niet zo was.
- De rode balk bevat één knop: **"Bewaar dossier nu"** (noodklep, werkt op het geheugen).
- `QuotaExceededError` → "Opslag vol — bewaar de PDF en verwijder een afgewerkte woning".
- **Foto's**: verklein → `put` in `fotos` → pas dán `fotoId` in het woningrecord en
  tegel tonen. Faalt de `put`: "Foto niet bewaard", geen dode verwijzing.
- **Opslag**: bij start `navigator.storage.persist()` in een `try`, tegen eviction.
  Geen opslagbanner: quotaproblemen melden zich via de rode balk zodra een write
  echt faalt (`QuotaExceededError`).
- **DB open faalt**: niets wissen. Rode balk + read-only geheugenmodus waarin enkel
  "Bewaar PDF" nog werkt.
- **Verwijderen**: uitgeschakeld zolang `pdfBewaardOp === null` (knop toont "Bewaar
  eerst het dossier"; de veldnaam blijft historisch `pdfBewaardOp`). Anders confirm met datum en uur. Wist woning + alle `fotos` met die
  `woningId` in één transactie.
- `pdfBewaardOp` wordt enkel gezet nadat `share()` of de download **resolved** heeft.
  `AbortError` zet niets.
## 7. Schermen
### 7.1 Woningenlijst
- Titelbalk "EPC Plaatsbezoek". Gesorteerd op laatst gewijzigd.
- Per rij: hoofdfoto-thumb, **`<nummer>. <adres>`** ("Zonder adres"), datum,
  statuspill afgeleid uit `pdfBewaardOp` (grijs "Open" / groen "PDF ✓", **geen
  knop**). Het prefix valt weg als de woning (nog) geen nummer heeft.
- Verwijderen kan niet vanuit de lijst, enkel op de tab Afronden.
- "+ Nieuwe woning" maakt en opent een record.
- Daaronder "Importeer dossier": kies een eerder bewaarde dossier-zip en de
  woning wordt integraal teruggeladen (§9.4).
- Geen Info-blok, geen versielabel, geen updateknop.
- **Dossiernummer (per woning, app-zijde).** Elk dossier heeft een eigen `nummer`.
  Een **nieuwe woning én een import** krijgen automatisch het volgende vrije
  nummer uit een globale teller (`localStorage['epc-volgindex']`), die daarbij met
  1 ophoogt. Het nummer verschijnt in het overzicht en als prefix van de
  zip-bestandsnaam (§9.3). Het staat **niet** in de pdf of `woning.json`, zodat de
  zip-inhoud nummeronafhankelijk en reproduceerbaar blijft.
- **Verstopt: nummer corrigeren.** Klopt de teller ooit niet, dan corrigeer je het
  nummer van het **geopende** dossier met een **lange druk** (± 0,8 s) op de titel
  in de editorheader: `prompt()` "Dossiernummer van deze woning:" met het huidige
  nummer voorin. Een geheel getal > 0 wordt het nieuwe `nummer` en zet de globale
  teller op nummer+1 (zodat de volgende woning verder telt); anders toast
  "Ongeldig nummer".
### 7.2 Header (editor)
- Groene sticky balk: terugpijl `‹`, titel `<nummer>. <adres>` (ellipsis),
  save-bolletje. Rode balk daarboven. Lang indrukken op de titel corrigeert het
  dossiernummer (§7.1).
- Tabs: Algemeen · Details · Foto's · Afronden.
- Op **Details** en **Foto's**: ruimtebalk, horizontaal scrollbare chip-rij
  (outline-chips, actieve gevuld). Actieve chip scrollt in beeld.
  - Details: enkel echte ruimtes + "+ Ruimte". Altijd één geselecteerd.
  - Foto's en camerascherm: vooraan "Algemeen" (`algemeen`) en "Gevels" (`gevels`).
- "+ Ruimte": Slaapkamer, Badkamer, WC, Berging, Bureau, Garage, Zolder, Kelder,
  Veranda, "Andere naam…" (`prompt()`). Bestaande naam → autonummering
  ("Slaapkamer 2"). Nieuwe ruimte wordt geselecteerd, Ventilatie klapt open.
- **Hernoemen**: lang indrukken op de chip → `prompt()`. Naam is geen sleutel meer.
- **Verwijderen**: enkel als de ruimte geen ramen, toestellen of foto's heeft. Anders
  is de optie afwezig. De knop "Ruimte verwijderen" staat onderaan de Details-tab,
  onder de opmerking, en vraagt een `confirm()`.
- Groepering: op basisnaam (naam zonder eindcijfer), volgorde van eerste voorkomen,
  binnen een groep numeriek.
### 7.3 Tab Algemeen — vier accordeons, alleen **Woning** open
1. **Woning**: adres + 📍 (geolocation → Nominatim reverse geocoding,
   `accept-language=nl&zoom=18`; mislukt → "lat, lon"). Enige externe call, alleen op
   een tik. Datum plaatsbezoek (date-input, default vandaag).
2. **Verwarming** (centraal, `ruimteId: null`): cycle Gas/Stookolie/Andere; chips
   Radiatoren/Vloerverwarming/Sanitair warm water (meerkeuze); beschrijving;
   📷 Foto kenplaat; 📷 Foto radiatorkranen (rij enkel zichtbaar bij "radiatoren"; bij
   bewaren wordt `fotoKraanId` genuld en de blob gewist als radiatoren weg is);
   "Voeg verwarming toe" + lijst (nieuwste eerst, tik = bewerken, × = confirm).
3. **Extra installaties**: Zonnepanelen (cycle Plat dak/Voor/Achter/Links/Rechts +
   Wp-veld + ronde "+", lijst met ×, geen bewerken). Zonneboiler (cycle Nee/Ja,
   default Nee; bij Ja veld "Oppervlakte zonnecollector (m²)").
4. **Opmerkingen**: textarea.
### 7.4 Tab Details — per geselecteerde ruimte, drie accordeons
Volgorde: **Ventilatie (open) → Verwarming in deze ruimte → Ramen & deuren.**
- **Ventilatie**: cycle `geen → natuurlijk → mechanisch → mechanisch permanent →
  ander`. Bij "ander" een beschrijvingsveld onder de knop, met focus, geen popup.
- **Verwarming in deze ruimte**: cycle Airco/Kachel/Andere (`ruimte-andere`);
  **Afmetingen ruimte (m)** b × d × h met live m³, opgeslagen op de ruimte (één keer
  per ruimte; leeg = `afm: null`); beschrijving; 📷 Foto kenplaat; "Voeg toestel toe".
  Lijst toont enkel de toestellen van deze ruimte, met volume. Tik = bewerken.
  - Afmetingen zijn enkel nodig voor ruimtes met een eigen toestel: die vormen een
    aparte ruimtecluster die van het totale volume afgetrokken wordt. Ruimtes zonder
    eigen toestel horen bij de algemene cluster; het totale volume komt uit de
    tekening in de VEKA-software.
- **Ramen & deuren**: element-rij en gevel-rij zonder label; b × h met live m²
  (placeholders "breedte (m)"/"hoogte (m)"); "Aantal identieke" met inline −/1/+
  (min. 1); drie mini-cycles naast elkaar: Beglazing (Enkel/Dubbel/HR dubbel/
  Drievoudig/Vol paneel), Kader (PVC/Alu/Hout), Rolluik (Nee/Ja); bij
  element=deur verdwijnt de beglazing-cycle — een deur heeft enkel een profiel
  (hout/alu/pvc), geen beglazingswaarde;
  **"📷 Foto afstandhouder"**, bij element=dakraam automatisch **"📷 Foto kenplaatje"**;
  "Voeg toe".
  - Na toevoegen blijven de keuzes staan; afmetingen, aantal en foto worden geleegd.
  - Zonder geldige b én h: toast "Vul breedte en hoogte in (m)".
  - Een dakraam behoudt gevel voor/achter/links/rechts. "Vol paneel" blijft een
    beglazingswaarde voor vaste panelen die als raam worden ingegeven (zo gaat
    het ook in de VEKA-software). Deuren hebben geen beglazingswaarde; een
    poort wordt als deur ingegeven.
- **Sorteervolgorde** (één functie, gebruikt door lijst, PDF en nummering): eerst alle
  deuren, dan de rest; binnen elk blok gevel voor → achter → links → rechts; dan
  aanmaakvolgorde. `#nr` = 1-gebaseerde index in die volgorde.
- De lijst toont enkel de elementen van de gekozen ruimte (net als de
  toestellen); het `#nr` blijft het huisbrede volgnummer uit §7.4 (matcht de PDF).
- Rij toont "#nr Element · Gevel · n×", "b × h m = x m² (totaal)", tags (beglazing ·
  kader · rolluik). Totaalregel: elementen en m² **van deze ruimte** (aantallen
  meegeteld).
- Onderaan de tab, buiten de secties: **"Opmerking bij deze ruimte"** (textarea).
### 7.5 Tab Foto's
- **"📷 Start camera"** en **"🖼 Kies foto's"** (`multiple`, elk bestand door §8).
- Dichtgeklapt blok **"📋 Welke foto's zijn minimaal vereist? (inspectieprotocol)"**:
  gevels (elke veilig bereikbare), schildelen per hoofdtype, isolatie (type en dikte
  herkenbaar), beglazing en kaders (opschriften leesbaar), verwarming (kenplaat,
  label, thermostaat, afgifte, buitenvoeler), sanitair warm water, koeling,
  ventilatie, zonne-energie met oriëntatie; telkens detail én overzicht. Bron VEKA,
  10 jaar bewaren. Blijft: werkinstrument, geen app-uitleg.
- Raster toont enkel de foto's van de geselecteerde chip. Totaalregel "N foto's in
  <label> · M in totaal".
- Per tegel: **⇄** verplaats naar andere groep (bottom-sheet met chips, huidige
  gemarkeerd), **×** verwijderen (undo-toast), en op `gevels`-foto's een **★**
  (wit = kiesbaar, geel = hoofdfoto; tik zet `hoofdFotoId`, geen confirm).
  Tik op de foto = lightbox.
- Verplaats je de hoofdfoto weg uit `gevels`, dan wordt `hoofdFotoId` gewist.
### 7.6 Camerascherm (fullscreen overlay)
- `getUserMedia` achtercamera, ideal 2560×1920; `<video playsinline autoplay muted>`.
- **Dossier-modus** ("Start camera"): ruimtechips bovenaan (wisselen zonder sluiten),
  flitsknop 🔦 rechtsboven **enkel als `getCapabilities()` torch meldt** (toggle via
  `applyConstraints({advanced:[{torch}]})`, geel als aan); onderaan teller "N foto's",
  witte sluiterknop, "Klaar". Elke tik: frame → JPEG → foto in de actieve groep.
- **Enkel-modus** (kenplaat, kranen, afstandhouder, toestel): geen chips, knop
  "Annuleer", één tik → foto op zijn plek, camera dicht.
- **Fallbacks**: enkel-modus → verborgen `<input type="file" accept="image/*"
  capture="environment">`; dossier-modus → toast met foutnaam, bibliotheekkiezer opent.
- Tracks stoppen bij Klaar/Annuleer, visibilitychange (met save) en pagehide.
### 7.7 Tab Afronden
- **Controlelijstje** (informatief, nooit blokkerend, vers berekend bij openen):
  ✅/❌ voor (1) elke ruimte minstens één foto (bij ❌ de namen), (2) verwarming
  ingevuld (≥1 opwekker of toestel), (3) hoofdfoto gekozen.
- **"💾 Bewaar dossier"** met voortgangsbalk uit de worker.
- Grijze regel "Dossier bewaard op <datum en uur>" indien `pdfBewaardOp`.
- "Woning sluiten" (navigeert terug, wijzigt niets).
- "Woning verwijderen" (rood, gedrag volgens §6).
## 8. Foto-pijplijn
Alles wordt via canvas hergecodeerd naar JPEG en als Blob opgeslagen. Originele bytes
worden nooit hergebruikt.
| Soort | Groep | Max langste zijde | Kwaliteit |
|---|---|---|---|
| `document` | `algemeen` (facturen, moeten leesbaar zijn) | 2400 px | 0,80 |
| `foto` | alle andere (ruimtes, gevels, kenplaten, isolatie, detail) | 1600 px | 0,70 |
- Bij tekst weegt de kwaliteitsfactor zwaarder dan de resolutie; 2400 px op een
  paginavullende liggende A4 is ruim 350 dpi.
- **EXIF**: importeren met `createImageBitmap(file, {imageOrientation:'from-image'})`;
  gooit dat, dan `<img>` met `style.imageOrientation='from-image'` na `decode()`.
  Door het hercoderen zit de oriëntatie daarna in de pixels en bevat de opgeslagen
  JPEG geen EXIF. Hier steunt `maakpdf.js` op.
- `breedte` en `hoogte` worden meegeschreven, zodat de generator niets hoeft te
  decoderen om te layouten.
- Hoofdfoto is altijd een foto met groep `gevels`.
## 9. `maakpdf.js`
Schrijft zelf een volledig PDF-document. Geen print-dialoog, geen library.
### 9.1 Technisch
- Draait in `pdfworker.js`, niet op de main thread. Voortgang via `postMessage`.
- Uitvoer = array van `Uint8Array`-chunks met lopende byte-offset, op het einde
  `new Blob(chunks, {type:'application/pdf'})`. Nooit één grote string, nooit base64.
- PDF 1.4. Xref-tabel met exacte byte-offsets, `/ID` in de trailer, `/Info` met
  `/Title` (adres), `/Producer` ("EPC Plaatsbezoek <VERSIE>") en `/CreationDate`.
- **Encoding = WinAnsiEncoding (CP1252), niet Latin-1.** Volledige tabel voor
  0x80–0x9F: `€`80 `‚`82 `ƒ`83 `„`84 `…`85 `†`86 `‡`87 `ˆ`88 `‰`89 `Š`8A `‹`8B `Œ`8C
  `Ž`8E `'`91 `'`92 `"`93 `"`94 `•`95 `–`96 `—`97 `˜`98 `™`99 `š`9A `›`9B `œ`9C `ž`9E
  `Ÿ`9F. 0xA0–0xFF rechtstreeks. NBSP → spatie. Rest → `?`. `(`, `)` en `\` escapen.
- **Tekstbreedte** uit twee `Uint16Array(256)`-tabellen met de advance widths (1/1000
  em) van Helvetica (F1) en Helvetica-Bold (F2), Adobe Core14 AFM, geïndexeerd op
  WinAnsi-code. Geen canvas-metingen: de browser substitueert Arial voor "Helvetica",
  waardoor de layout per platform verschilde.
- **Afbeeldingen**: JPEG-bytes rechtstreeks als Image-XObject met DCTDecode. Lees de
  SOF-marker: 1 component → `/DeviceGray`, 3 → `/DeviceRGB`, anders (of een andere
  marker dan `0xFFC0`, dus progressive) → **fout gooien**. Geen `Image`-load nodig.
- **Dedupe op `fotoId`**: één XObject, meermaals getekend.
- A4 staand 595,28 × 841,89 pt of liggend (omgewisseld). Marge 40 pt. Cursor van boven
  naar onder, automatische paginabreuk.
- **Geen PDF/A**: base-14 fonts worden niet ingebed. Bewust; embedding vraagt een
  fontbestand en een build-stap.
### 9.2 Indeling
1. **Kop**: klein grijs "EPC Plaatsbezoek", adres (vet 15 pt, gewrapt), "Datum
   plaatsbezoek: …". Hoofdfoto rechtsboven, 130 pt breed, max 100 pt hoog.
2. **RAMEN & DEUREN** (hoofdletters + lijn): tabel #, Type, Ruimte, Gevel, Aant.,
   B (m), H (m), m² (aantal meegerekend), Beglazing (leeg bij deuren), Kader,
   Rolluik. 7,5 pt, celranden, wrap per cel, getallen rechts, totaalregel vet.
   Alle maten in de PDF staan met exact twee cijfers na de komma ("1,00");
   de UI toont meters zonder afkapping (1,335). Sortering en nummering exact als
   §7.4. Daaronder de raamfoto's: 4 per rij, cel 82 pt, contain, gecentreerd, grijs
   bijschrift 6,5 pt "Element gevel – ruimte, afstandhouder/kenplaatje".
3. **ENERGIE**: tabel #, Opwekker, Ruimte, Doet, Beschrijving (bij airco/kachel met
   "ruimte b × d × h m = x m³"). Daaronder kenplaat- en kranenfoto's, zelfde raster,
   bijschrift "Type – ruimte, kenplaat/radiatorkranen". Dan **Zonnepanelen**
   ("Plat dak 4200 Wp · Voor 2000 Wp" of "—") en, alleen bij ja, **Zonneboiler**
   ("ja, 4,6 m²").
4. **VENTILATIE**: tabel met enkel Ruimte en Ventilatie (+ "(beschrijving)" bij
   ander) — afmetingen horen bij het toestel in ENERGIE en staan daar al.
   Natte ruimtes (keuken, badkamer, wc) eerst, rest alfabetisch-numeriek.
   Onder de tabel één regel "Ruimte — opmerking" per ruimte met een opmerking.
5. **NOTITIES**: alleen indien ingevuld.
6. **FOTODOSSIER**, nieuwe pagina: koptekst + "adres · plaatsbezoek datum · N foto's".
   Groepstitel in hoofdletters. Volgorde: Gevels, dan de ruimtes in ruimtevolgorde,
   Algemeen laatst. Gewone groepen: 4 per rij, cel 95 pt, geen bijschriften; een
   groepstitel staat nooit alleen onderaan (titel + eerste rij verhuizen samen).
   **Algemeen: eigen liggende pagina's, 2 foto's per pagina, paginavullend** (contain).
7. **Voetregel** op elke pagina: "adres · pagina X/Y", 7 pt grijs, gecentreerd.
### 9.3 Bewaren: de dossier-zip
1. Toast "Dossier maken…", worker start, voortgangsbalk.
2. In de worker, strikt **json-first**: het interne woningobject →
   `maakzip.woningExport(...)` → `woning.json` (de enige bron) →
   `maakpdf.bouwPdf(json.woning, fotosOpPad)` → PDF → de zip via `maakzip.bouwZip`
   (store, geen compressie — PDF en JPEG zijn al gecomprimeerd). Een import
   reproduceert zo gegarandeerd dezelfde PDF. Leden (allemaal **nummervrij**, zodat
   de inhoud niet afhangt van het dossiernummer):
   - `<adres>.pdf` — het dossier;
   - `hoofdfoto.jpg` — de hoofdfoto op opgeslagen resolutie (weggelaten als er
     geen hoofdfoto is);
   - `fotos/0001.jpg` … — álle foto's (dossier én elementfoto's zoals
     kenplaten en afstandhouders), op de opgeslagen resolutie;
   - `woning.json` — alle gegevens machineleesbaar, bedoeld om de VEKA-invoer
     later te automatiseren én als bron voor de import. **Genest en zonder
     afgeleide waarden of ruis** (§9.3.1); bevat géén dossiernummer.
3. **`<adres>`** = het ingevulde adres met tekens die een bestandsnaam breken
   (`/ \ : * ? " < > |`) vervangen door spaties, meervoudige spaties
   samengevouwen (fallback "EPC plaatsbezoek"); spaties, komma's en koppeltekens
   blijven behouden. **De zip zelf** heet `"<nummer>. <adres>.zip"` (§7.1), bv.
   `"24. Pelgrimlaan 15, Hasselt.zip"` — het nummer staat enkel op de
   buitenverpakking. `File` met die naam → `navigator.share({files})`.
4. **`NotAllowedError`** (iOS eist een user gesture, de bouw zit ertussen): de Blob
   blijft in het geheugen, op de plaats van de knop verschijnt **"Deel dossier"**
   die `share()` rechtstreeks vanuit een tik aanroept.
5. Geen share-ondersteuning → download via tijdelijke `<a download>`.
6. Resolve → `pdfBewaardOp = now`, meteen bewaren. `AbortError` → toast "Niet
   bewaard". Andere fout → toast "Dossier maken mislukt (naam)". (Het nummer telt
   niet hier op — het is al bij het aanmaken/importeren toegekend, §7.1.)
7. Blob > 150 MB → eerst confirm "Groot dossier, delen kan mislukken".
### 9.3.1 Structuur van `woning.json`
Ontworpen zodat elke koppeling structureel is en niets afgeleids of leeg wordt
opgeslagen:
- **Genest, geen tekststring-verwijzingen.** Elementen (ramen/deuren) staan
  onder hun ruimte in `elementen`; ruimtegebonden toestellen (airco/kachel)
  onder hun ruimte in `toestellen`. Een element kan zo nooit naar een
  onbestaande ruimte wijzen.
- **Foto's genest onder hun ruimte** in `fotos` (een geordende lijst
  `fotos/000N.jpg`-paden; de volgorde ís de volgorde, geen los volgnummer).
- **"Gevels" en "Algemeen" zijn gewone ruimtes** met enkel een `fotos`-lijst,
  geen ventilatie of elementen. Eén structuur voor "een naam met foto's
  eronder"; geen aparte fotogroepen-lijst. Beide zijn gereserveerde namen.
- **De opwekkerfoto's staan enkel op de opwekker** (`kenplaatFoto`,
  `kranenFoto`), niet nog eens in een ruimte.
- **Eén `hoofdfoto` op woningniveau** (pad naar een gevelfoto).
- **Geen afgeleide waarden**: geen oppervlakte per element, geen totaalblok,
  geen volume bij afmetingen. De maten staan er (`breedteM`, `hoogteM`,
  `aantal`, afmetingen `breedteM`/`diepteM`/`hoogteM`); m², m³ en totalen
  worden pas bij weergave/PDF berekend.
- **Optionele velden ontbreken gewoon** i.p.v. op `null` te staan: `beglazing`
  is er niet bij een deur; `ventilatie` ontbreekt bij "geen"; `opmerking`,
  `afmetingen`, `foto`, `elementen`, `toestellen`, `fotos`, `notities`,
  `energie` en de `zonneboiler` verschijnen enkel als ze inhoud hebben.
- Topniveau: `formaat`, `geexporteerd`, `woning`. Geen `nr`, geen `appVersie`
  (de PDF houdt de versie in `/Producer`).
```
woning: {
  adres, datumPlaatsbezoek, notities?, hoofdfoto?,
  ruimtes: [
    { naam: "Gevels", fotos: ["fotos/0001.jpg", …] },
    { naam, ventilatie?, ventilatieBeschrijving?, opmerking?,
      afmetingen?: { breedteM, diepteM, hoogteM },
      elementen?: [ { type, gevel, breedteM, hoogteM, aantal, beglazing?, kader, rolluik, foto? } ],
      toestellen?: [ { type, beschrijving?, kenplaatFoto? } ],
      fotos?: [ … ] },
    { naam: "Algemeen", fotos: [ … ] }
  ],
  energie?: {
    opwekkers?: [ { type, functies?, beschrijving?, kenplaatFoto?, kranenFoto? } ],
    zonnepanelen?: [ { orientatie?, wp } ],
    zonneboiler?: { collectorM2? }
  }
}
```
### 9.4 Importeren
- "Importeer dossier" op de woningenlijst opent een bestandskiezer (.zip).
- `maakzip.js` leest de zip (enkel store-leden — dossiers van deze app zelf);
  `woning.json` wordt gecontroleerd op `formaat: 'epc-plaatsbezoek-dossier'`.
- Er wordt een **nieuwe** woning aangemaakt (nieuwe ids, `pdfBewaardOp: null`, het
  volgende vrije dossiernummer volgens §7.1):
  de geneste structuur wordt teruggevouwen — "Gevels"/"Algemeen" worden weer
  fotogroepen, de andere ruimtes echte ruimtes, hun `elementen` worden ramen,
  hun `toestellen` en de centrale `opwekkers` worden energie-opwekkers, foto's
  uit `fotos/` komen terug in hun groep en de `hoofdfoto` wordt hersteld. Elk
  fotobestand wordt maar één keer geschreven (dedupe op pad); dimensies uit de
  JPEG-header. Daarna opent de woning; `normaliseer()` vangt rommel in een
  bewerkte json op zoals altijd.
- Mislukt het (geen zip, verkeerd formaat, onleesbaar lid) → toast
  "Importeren mislukt (reden)", er wordt niets half aangemaakt.
## 10. Bewuste keuzes
- Geen bouwjaar, gebouwtype, kelder, zolder, oriëntatie voorgevel, beschermd volume.
- Geen backup, export, import, JSON-bijlage. Geen bewerken van PV-installaties.
- Geen updateknop, versielabel, Info-blok, `skipWaiting`, automatische reload.
- Geen `screen.orientation.lock` (bestaat niet op iOS). Manifest zet `portrait`.
- Torch werkt zelden in iOS-Safari → knop enkel bij echte ondersteuning; donkere
  ruimtes via "Kies foto's" en de native camera met flits.
- `confirm()` en `prompt()` blijven, behalve bij foto's (undo).
- Netwerk: uitsluitend Nominatim, uitsluitend op een tik.
## 11. Testen
De volledige suite staat in `tests/` (eigen `package.json`; enkel test-tooling,
de app zelf blijft dependency-vrij). Draaien vanuit `tests/`: `npm install`,
dan `npm run unit`, `npm run flows`, `npm run camera` en `npm run dekking`.
- **100% regeldekking, afgedwongen**: `node tests/dekking.mjs` meet de
  V8-regeldekking van `app.js`, `db.js`, `maakpdf.js`, `maakzip.js`,
  `pdfworker.js` en `sw.js`
  (Node-dekking voor generator/worker/SW, Chromium-dekking voor app en db —
  WebKit heeft geen coverage-API) en **faalt onder de 100%**. Elke fout- en
  fallbacktak wordt daarvoor met mocks aangeraakt: share-weigeringen,
  workerfouten, quota, geblokkeerde en te nieuwe databanken, camera- en
  EXIF-fallbacks, afgebroken transacties.
- **Playwright op WebKit** (niet Chromium) voor de gedragsflows, iPhone-viewport
  ~393×852; camera met `--use-fake-ui-for-media-stream
  --use-fake-device-for-media-stream` + context-permissie `camera` — die vlaggen
  bestaan enkel in Chromium, dus de cameraflows draaien daar. WebKit ≠ mobile
  Safari. WebKit op Linux bewaart geen Blobs in IndexedDB in een tijdelijk
  profiel: de flows gebruiken een persistent profiel per test.
- **Handmatige checklist op de iPhone 15 Pro per release**: `navigator.share`, het
  gebaarprobleem, cameratoegang, torch, EXIF-oriëntatie van een liggende
  bibliotheekfoto. Niets daarvan is geautomatiseerd testbaar.
- Klikflows: woning → ruimtes → ramen/toestellen/foto's → afronden. Persistentie na
  `page.reload()`. Accordeon- en ruimtebalk-interacties. Na `page.fill` is de tabbalk
  verborgen: eerst blurren.
- **Failsafes**: injecteer `QuotaExceededError` op de `put`; verifieer rode balk,
  blijvende dirty-vlag, en dat "Bewaar PDF nu" een geldige PDF geeft. Verifieer dat
  verwijderen geblokkeerd is zolang `pdfBewaardOp === null`.
- **`maakpdf.js` unit-testen in Node**, zonder browser. Assert AFM-waarden (Helvetica:
  spatie 278, `A` 667, `i` 222; Helvetica-Bold: spatie 278, `A` 722). Assert dat een
  grijswaarde-JPEG `/DeviceGray` geeft en een progressive JPEG een fout.
- **PDF valideren**: `qpdf --check` (streng over xref-offsets, pypdf is dat niet), dan
  `pypdf` voor tekstextractie (adres, tabelwaarden, groepstitels, paginanummers) en
  paginaformaten, dan `pdftoppm` op drie pagina's om te zien dat er beeld staat.
- **`maakzip.js` unit-testen in Node**: CRC-32-ijkwaarde ("123456789" →
  `0xCBF43926`), zip uitpakbaar met `unzip`, `leesZip` als rondreis terug,
  `woningExport` met de nummering van §7.4.
- **Round-trip in de flows**: dossier exporteren, woning verwijderen, zip
  importeren en verifiëren dat gegevens én foto's volledig terug zijn.
- `node --check` op `app.js`, `db.js`, `maakpdf.js`, `maakzip.js`,
  `pdfworker.js`, `sw.js`.
## 12. Release
1. Wijziging eerst in deze spec, of in dezelfde commit.
2. `node --check` + WebKit-flows + unittests + `qpdf --check` groen.
3. Handmatige iPhone-checklist.
4. `VERSIE` in `sw.js` bumpen. Enige plaats.
5. Commit in het Nederlands, push naar `main`.
6. App uit de app-switcher vegen en heropenen om de nieuwe versie te laden.
