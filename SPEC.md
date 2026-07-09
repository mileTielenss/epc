# SPEC — EPC Plaatsbezoek
Bron van waarheid. Code die afwijkt is een bug. Wijzigingen beginnen hier.
Geen versienummers of regelaantallen in dit bestand.
## 1. Doel
Mobile-first offline PWA voor één energiedeskundige type A (Vlaanderen), op één
iPhone. Verzamelt tijdens het plaatsbezoek gegevens en foto's per ruimte.
- Nieuwe woning starten, al wandelend invullen. Dagen later aanvullen kan.
- Op het einde "Bewaar PDF". Die PDF is het dossier (10 jaar bewaarplicht).
- Na oplevering wordt de woning verwijderd. Verwijderen kan pas ná een geslaagde PDF.
- Geen backup, export of import. Geen JSON in de PDF: invoer in de VEKA-software
  gebeurt manueel, door een mens, op basis van de PDF.
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
| `maakpdf.js` | PDF-generator, `bouwPdf(woning, fotos) → Blob` (was `pdf.js`) |
| `pdfworker.js` | `new Worker`, importeert `maakpdf.js`, postMessage voortgang |
| `style.css` | opmaak, CSS-variabelen in `:root` |
| `sw.js` | service worker, **enige** versieconstante `const VERSIE = 'epc-vNN'` |
| `manifest.json` | "EPC Plaatsbezoek", standalone, portrait, `#0a6b3d` |
| `icon-180/192/512.png` | `node tools/make-icons.js` |
| `.github/workflows/deploy.yml` | Pages-deploy bij push naar `main` |
`maakpdf.js` importeert niets. Input: woningobject +
`Map<fotoId, {bytes:Uint8Array, breedte, hoogte, groep, volgorde}>` (groep en
volgorde omdat het woningrecord geen fotolijst heeft, §5). Los testbaar in Node.
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
             beglazing: 'enkel'|'dubbel'|'hr-dubbel'|'drievoudig'|'paneel',
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
Nieuwe woning start met Living, Keuken, Badkamer, WC, Slaapkamer 1.
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
- De rode balk bevat één knop: **"Bewaar PDF nu"** (noodklep, werkt op het geheugen).
- `QuotaExceededError` → "Opslag vol — bewaar de PDF en verwijder een afgewerkte woning".
- **Foto's**: verklein → `put` in `fotos` → pas dán `fotoId` in het woningrecord en
  tegel tonen. Faalt de `put`: "Foto niet bewaard", geen dode verwijzing.
- **Opslag**: bij start `navigator.storage.persist()` in een `try`, tegen eviction.
  Geen opslagbanner: quotaproblemen melden zich via de rode balk zodra een write
  echt faalt (`QuotaExceededError`).
- **DB open faalt**: niets wissen. Rode balk + read-only geheugenmodus waarin enkel
  "Bewaar PDF" nog werkt.
- **Verwijderen**: uitgeschakeld zolang `pdfBewaardOp === null` (knop toont "Bewaar
  eerst de PDF"). Anders confirm met datum en uur. Wist woning + alle `fotos` met die
  `woningId` in één transactie.
- `pdfBewaardOp` wordt enkel gezet nadat `share()` of de download **resolved** heeft.
  `AbortError` zet niets.
## 7. Schermen
### 7.1 Woningenlijst
- Titelbalk "EPC Plaatsbezoek". Gesorteerd op laatst gewijzigd.
- Per rij: hoofdfoto-thumb, adres ("Zonder adres"), datum, statuspill afgeleid uit
  `pdfBewaardOp` (grijs "Open" / groen "PDF ✓", **geen knop**).
- Verwijderen kan niet vanuit de lijst, enkel op de tab Afronden.
- "+ Nieuwe woning" maakt en opent een record.
- Geen Info-blok, geen versielabel, geen updateknop.
### 7.2 Header (editor)
- Groene sticky balk: terugpijl `‹`, adres (ellipsis), save-bolletje. Rode balk
  daarboven.
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
  Drievoudig/Vol paneel), Kader (PVC/Alu/Hout), Rolluik (Nee/Ja);
  **"📷 Foto afstandhouder"**, bij element=dakraam automatisch **"📷 Foto kenplaatje"**;
  "Voeg toe".
  - Na toevoegen blijven de keuzes staan; afmetingen, aantal en foto worden geleegd.
  - Zonder geldige b én h: toast "Vul breedte en hoogte in (m)".
  - Een dakraam behoudt gevel voor/achter/links/rechts. "Vol paneel" blijft een
    beglazingswaarde: het wordt in de VEKA-software als raam ingevoerd.
- **Sorteervolgorde** (één functie, gebruikt door lijst, PDF en nummering): eerst alle
  deuren, dan de rest; binnen elk blok gevel voor → achter → links → rechts; dan
  aanmaakvolgorde. `#nr` = 1-gebaseerde index in die volgorde.
- Rij toont "#nr Element · Gevel · n×", "b × h m = x m² (totaal)", tags (ruimte ·
  beglazing · kader · rolluik). Totaalregel: aantal elementen (aantallen meegeteld) +
  totale m².
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
- **"💾 Bewaar PDF"** met voortgangsbalk uit de worker.
- Grijze regel "PDF bewaard op <datum en uur>" indien `pdfBewaardOp`.
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
   B (m), H (m), m² (aantal meegerekend), Beglazing, Kader, Rolluik. 7,5 pt, celranden,
   wrap per cel, getallen rechts, totaalregel vet. Sortering en nummering exact als
   §7.4. Daaronder de raamfoto's: 4 per rij, cel 82 pt, contain, gecentreerd, grijs
   bijschrift 6,5 pt "Element gevel – ruimte, afstandhouder/kenplaatje".
3. **ENERGIE**: tabel #, Opwekker, Ruimte, Doet, Beschrijving (bij airco/kachel met
   "ruimte b × d × h m = x m³"). Daaronder kenplaat- en kranenfoto's, zelfde raster,
   bijschrift "Type – ruimte, kenplaat/radiatorkranen". Dan **Zonnepanelen**
   ("Plat dak 4200 Wp · Voor 2000 Wp" of "—") en, alleen bij ja, **Zonneboiler**
   ("ja, 4,6 m²").
4. **VENTILATIE**: tabel Ruimte, Ventilatie (+ "(beschrijving)" bij ander),
   Afmetingen, Opmerking. Natte ruimtes (keuken, badkamer, wc) eerst, rest
   alfabetisch-numeriek.
5. **NOTITIES**: alleen indien ingevuld.
6. **FOTODOSSIER**, nieuwe pagina: koptekst + "adres · plaatsbezoek datum · N foto's".
   Groepstitel in hoofdletters. Volgorde: Gevels, dan de ruimtes in ruimtevolgorde,
   Algemeen laatst. Gewone groepen: 4 per rij, cel 95 pt, geen bijschriften; een
   groepstitel staat nooit alleen onderaan (titel + eerste rij verhuizen samen).
   **Algemeen: eigen liggende pagina's, 2 foto's per pagina, paginavullend** (contain).
7. **Voetregel** op elke pagina: "adres · pagina X/Y", 7 pt grijs, gecentreerd.
### 9.3 Bewaren
1. Toast "PDF maken…", worker start, voortgangsbalk.
2. Blobs uit `fotos` → `arrayBuffer()` → `bouwPdf(woning, fotos)`.
3. `File` met naam `<slug(adres)>.pdf` (fallback `epc.pdf`) → `navigator.share({files})`.
4. **`NotAllowedError`** (iOS eist een user gesture, de bouw zit ertussen): de Blob
   blijft in het geheugen, op de plaats van de knop verschijnt **"Deel PDF"** die
   `share()` rechtstreeks vanuit een tik aanroept.
5. Geen share-ondersteuning → download via tijdelijke `<a download>`.
6. Resolve → `pdfBewaardOp = now`, meteen bewaren. `AbortError` → toast "Niet bewaard".
   Andere fout → toast "PDF maken mislukt (naam)".
7. Blob > 150 MB → eerst confirm "Grote PDF, delen kan mislukken".
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
- **Playwright op WebKit** (niet Chromium), iPhone-viewport ~393×852, camera met
  `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` +
  context-permissie `camera`. WebKit ≠ mobile Safari.
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
- `node --check` op `app.js`, `db.js`, `maakpdf.js`, `pdfworker.js`, `sw.js`.
## 12. Release
1. Wijziging eerst in deze spec, of in dezelfde commit.
2. `node --check` + WebKit-flows + unittests + `qpdf --check` groen.
3. Handmatige iPhone-checklist.
4. `VERSIE` in `sw.js` bumpen. Enige plaats.
5. Commit in het Nederlands, push naar `main`.
6. App uit de app-switcher vegen en heropenen om de nieuwe versie te laden.
