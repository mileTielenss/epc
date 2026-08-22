# SPEC — EPC Plaatsbezoek
Bron van waarheid. Code die afwijkt is een bug. Wijzigingen beginnen hier.
Geen versienummers of regelaantallen in dit bestand.
## 1. Doel
Mobile-first offline PWA voor één energiedeskundige type A (Vlaanderen), op één
iPhone. Verzamelt tijdens het plaatsbezoek gegevens en foto's per ruimte.
Twee soorten dossiers: een **woning** en de **gemene delen** van een
appartementsgebouw (EPC GD) — zelfde app, zelfde flow, met kleine verschillen
per soort (§7.1, §7.3, §7.4, §7.7).
- Nieuwe woning starten, al wandelend invullen. Dagen later aanvullen kan.
- Op het einde "Bewaar dossier": een **zip** met de PDF (het eigenlijke dossier,
  10 jaar bewaarplicht), de hoofdfoto als losse `hoofdfoto.jpg`, alle foto's als
  jpeg in `fotos/`, en een `woning.json` met alle gegevens — voor latere
  automatisaties (de json bevat geen beeldbytes, wel verwijzingen naar `fotos/`).
- Diezelfde zip kan via "Importeer dossier" op de woningenlijst integraal terug
  ingeladen worden — ook jaren later (§9.4).
- Na oplevering wordt de woning verwijderd. Bij een actueel bewaard dossier
  volstaat een bevestiging; anders geldt een typ-slot (§6).
- Invoer in de VEKA-software gebeurt manueel of via latere automatisatie op
  basis van `woning.json`; de PDF blijft het leesbare dossier.
- Eén gebruiker: geen accounts, geen hulpteksten. Eén optionele instelling: de
  NAS-upload (§7.8); leeg = de app werkt precies zoals zonder.
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
- Install: cachet alle assets in cache `VERSIE`, elk opgehaald met `?v=VERSIE` en
  `cache:'no-store'` (atomisch en CDN-proof, §9.5); opgeslagen onder de kale url.
  **Geen automatische `skipWaiting()`** — enkel op verzoek, zie hieronder.
- Activate: verwijdert alle andere caches, dan `clients.claim()`.
- Fetch: **vreemde oorsprong (NAS, Nominatim) raakt de SW niet aan** — die
  gaan rechtstreeks naar het netwerk, zodat de échte browserfout (certificaat,
  CORS) zichtbaar blijft in plaats van een algemene fout uit deze handler.
  Voor de eigen oorsprong: cache-first, **uitsluitend uit de eigen cache**
  (`caches.open(VERSIE).match(req, {ignoreSearch:true})`). Miss → netwerk, gelukte
  same-origin-responses bijcachen. Offline navigatie → `./index.html` uit eigen cache.
  Urls die `sw.js?` bevatten gaan rechtstreeks naar het netwerk (versiecheck, §9.5).
- `message`-handler: het bericht `'skipWaiting'` (van de knop "Nu bijwerken", §9.5)
  roept `self.skipWaiting()` aan; al de rest wordt genegeerd.
- App-kant: `register(..., {updateViaCache:'none'})`, `reg.update()` bij start en bij
  visibilitychange.
- Zonder "Nu bijwerken" draait de nieuwe versie zodra de app uit de app-switcher
  geveegd en heropend wordt. Geen `controllerchange`-reload: een reload middenin
  een camerasessie is dataverlies.
- `VERSIE` wordt doorgegeven aan de generator en komt in `/Producer` van de PDF.
  `sw.js` staat daarvoor mee in de asset-cache: de app fetcht `./sw.js` (die uit
  de eigen cache komt en dus bij de draaiende versie hoort) en leest de constante
  eruit. SW-updates gebeuren buiten de fetch-handler om, dus dit blokkeert niets.
## 5. Datamodel
IndexedDB `epc-db`, versie 4. `onupgradeneeded` maakt de stores aan; een databank
van **vóór v3** wordt daarbij **leeggemaakt** (clean start — records in dat oude
formaat zijn onbruikbaar en zouden anders onverwijderbaar blijven omdat
verwijderen een geslaagde PDF vereist). Vanaf v3 blijven de gegevens bij elke
upgrade staan: v3 → v4 voegt enkel de `extra`-store toe.
| Store | keyPath | Index | Inhoud |
|---|---|---|---|
| `woningen` | `id` | — | woningrecord, **zonder beeldbytes** |
| `fotos` | `id` | `woningId` | `{id, woningId, blob, breedte, hoogte, groep, volgorde, gemaakt}` |
| `extra` | `id` | `woningId` | `{id, woningId, naam, blob, gemaakt}` — bestanden uit `extra/` (§7.3) |
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
  soort: 'woning' | 'gemene-delen',   // gekozen bij aanmaak, daarna vast (§7.1)
  nummer: geheel getal | null, // dossiernummer (§7.1): null tot het eerste
                               // "Bewaar dossier"; app-zijde, niet in pdf/json
  gemaakt, gewijzigd,          // ISO
  pdfBewaardOp: ISO | null,    // enige statusbron; samen met `gewijzigd` bepaalt
                               // hij of het dossier nog actueel is (§6)
  nasBewaardOp: ISO | null,    // wanneer de zip op de NAS belandde (§7.8);
                               // ouder dan `gewijzigd` = de NAS loopt achter
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
             privatief (bool),  // enkel bij gemene delen (§7.4): raam van een
                                // privatief appartement — alleen oppervlakte
                                // telt; beglazing=null, kader=null, rolluik=false
             fotoId | null } ],
  energie: {
    opwekkers: [ { id,
                   type: 'gas'|'stookolie'|'andere'         // centraal, ruimteId=null
                       | 'airco'|'kachel'|'ruimte-andere',  // ruimtegebonden
                   ruimteId | null,
                   functie: ['radiatoren'|'vloer'|'sww'],
                   beschrijving,
                   fotoIds: [fotoId, ...],   // kenplaatfoto's, 0..n (§7.3)
                   fotoKraanId } ],
    pvPanelen: [ { id, orientatie: 'plat'|'voor'|'achter'|'links'|'rechts'|'', wp } ],
    zonneboiler: 'nee'|'ja', zonneboilerM2,
    verlichting: [ { id,               // enkel zinvol bij gemene delen (§7.3)
                     type: 'led'|'tl'|'spaarlamp'|'halogeen'|'gloeilamp'|'andere',
                     aantal (>=1), watt } ]   // watt = vermogen per lamp, string
  }
}
```
Nieuwe woning start met Living, Keuken, Badkamer, WC, Slaapkamer 1 en Hal.
Nieuwe gemene delen starten met enkel **Hal** (ruimtes toevoegen blijft kunnen:
traphal, kelder, stookplaats, …).
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
- **Actueel of gewijzigd**: `pdfBewaardOp` blijft de enige opgeslagen status,
  maar "klaar" is een **afgeleide**: een dossier is actueel zolang
  `gewijzigd <= pdfBewaardOp`. Bij een geslaagde export worden beide
  tijdstempels in dezelfde write gelijkgezet, dus élke latere wijziging maakt
  het dossier meteen weer "Gewijzigd" — het groene vinkje verdwijnt dan (§7.1)
  en op Afronden staat "Dossier bewaard op … — nadien gewijzigd, bewaar
  opnieuw" in het rood. Geen extra veld.
- **Verwijderen**: kan **altijd**, ook zonder bewaard dossier. Bij een
  **actueel** dossier dat (indien een NAS ingesteld is) ook op de NAS staat:
  `confirm()` met datum en uur. Is er **niets bewaard, zitten er wijzigingen
  buiten de export, of ontbreekt de NAS-kopie**:
  extra slot tegen ongelukken — een `prompt()` waarin letterlijk **VERWIJDER**
  getypt moet worden (hoofdletterongevoelig, gespaties getrimd); iets anders →
  toast "Niet verwijderd", annuleren → niets. De prompt zegt welke van de twee
  redenen geldt. Wist woning + alle `fotos` én
  `extra`-bestanden met die `woningId` in één transactie.
- `pdfBewaardOp` wordt enkel gezet nadat `share()` of de download **resolved** heeft.
  `AbortError` zet niets.
## 7. Schermen
### 7.1 Woningenlijst
- Titelbalk "EPC Plaatsbezoek". Gesorteerd op laatst gewijzigd.
- Per rij: hoofdfoto-thumb, **`<nummer>. <adres>`** ("Zonder adres") — bij
  gemene delen **`<nummer>. GD <adres>`** (zelfde nummering, enkel het
  GD-voorvoegsel) —, datum, statuspill met drie standen (**geen knop**): grijs
  **"Open"** (nooit bewaard), groen **"PDF ✓"** (bewaard én actueel), rood
  omrand **"Gewijzigd"** (bewaard, maar nadien aangepast — zie §6).
- Twee aanmaakknoppen: **"+ Nieuwe woning"** en **"+ Gemene delen"** (zelfde
  flow en dezelfde nummerteller; `soort` ligt daarna vast).
- Verwijderen kan niet vanuit de lijst, enkel op de tab Afronden.
- "+ Nieuwe woning" maakt en opent een record.
- Daaronder "Importeer dossier": kies een eerder bewaarde dossier-zip en de
  woning wordt integraal teruggeladen (§9.4).
- Geen Info-blok, geen updateknop. Wel een **discrete versieregel** onderaan
  (klein, grijs, gecentreerd): "Versie epc-vN", aangevuld met "— laatste versie"
  of "— update beschikbaar" zodra de versiecheck (§9.5) een antwoord heeft;
  zonder check (offline) blijft alleen het versienummer staan.
- **Dossiernummer (per woning, app-zijde).** Het `nummer` wordt **pas toegekend
  bij de eerste bewaarpoging** ("Bewaar dossier", §9.3) — zo volgt de nummering
  de volgorde van afgewerkte dossiers, niet van aangemaakte. Tot dan is het
  `null` en toont lijst/titel gewoon het adres zonder prefix. Een **import**
  krijgt het nummer wél meteen (dat dossier wás al bewaard). De bron is een
  globale teller (`localStorage['epc-volgindex']`), die bij elke toekenning met
  1 ophoogt. Verwijderen raakt de teller niet: nummers worden nooit
  hergebruikt. Het nummer verschijnt in het overzicht en als prefix van de
  zip-bestandsnaam (§9.3); het staat **niet** in de pdf of `woning.json`, zodat
  de zip-inhoud nummeronafhankelijk en reproduceerbaar blijft. Mislukt de
  bewaarpoging na de toekenning, dan behoudt het dossier zijn nummer voor de
  volgende poging.
- **Verstopt: nummer corrigeren.** Klopt de teller ooit niet, dan corrigeer je het
  nummer met een **lange druk** (± 0,8 s) op de **woningnaam in de lijst**:
  `prompt()` "Dossiernummer van deze woning:" met het huidige nummer voorin. Een
  geheel getal > 0 wordt het nieuwe `nummer` en zet de globale teller op
  nummer+1 (zodat de volgende woning verder telt); anders toast "Ongeldig
  nummer". Bij een dossier zonder nummer staat de tellerstand als voorstel in
  de prompt. De klik die op het loslaten volgt opent de woning **niet**. Mislukt
  het bewaren → toast "Nummer aanpassen mislukt".
### 7.2 Header (editor)
- Groene sticky balk: terugpijl `‹`, titel `<nummer>. <adres>` — bij gemene
  delen `<nummer>. GD <adres>` — (ellipsis),
  save-bolletje. Rode balk daarboven. De titel is geen knop; het nummer pas je
  aan via de lijst (§7.1).
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
### 7.3 Tab Algemeen — vijf accordeons, alleen **Woning** open
1. **Woning**: adres + 📍 (geolocation → Nominatim reverse geocoding,
   `accept-language=nl&zoom=18`; mislukt → "lat, lon"). Enige externe call, alleen op
   een tik. Datum plaatsbezoek (date-input, default vandaag).
2. **Verwarming** (centraal, `ruimteId: null`): cycle Gas/Stookolie/Andere; chips
   Radiatoren/Vloerverwarming/Sanitair warm water (meerkeuze); beschrijving;
   📷 Foto kenplaat — **meerdere foto's toegelaten**: elke nieuwe foto komt erbij
   (`fotoIds`), de miniaturen staan naast de knop en elke foto heeft een eigen ×
   met de gewone undo-toast van 6 s; 📷 Foto radiatorkranen (één foto; rij enkel
   zichtbaar bij "radiatoren"; bij bewaren wordt `fotoKraanId` genuld en de blob
   gewist als radiatoren weg is);
   "Voeg verwarming toe" + lijst (nieuwste eerst, alle kenplaatminiaturen
   zichtbaar, tik = bewerken, × = confirm).
3. **Extra installaties**: Zonnepanelen (cycle Plat dak/Voor/Achter/Links/Rechts +
   Wp-veld + ronde "+", lijst met ×, geen bewerken). Zonneboiler (cycle Nee/Ja,
   default Nee; bij Ja veld "Oppervlakte zonnecollector (m²)").
4. **Opmerkingen**: textarea.
5. **Extra bestanden**: hint dat deze bestanden meereizen in `extra/` van de
   dossier-zip; lijst (naam + grootte, oudste eerst) met per rij een × dat na
   `confirm()` verwijdert; **"+ Bestand toevoegen"** opent de bestandskiezer
   (`multiple`, elk bestandstype — zo kies je ook een scan die je met de
   Bestanden/Notities-scanner van iOS maakte). Bestandsnamen worden ontdaan van
   tekens die een zip-pad breken; een dubbele naam krijgt " (2)", " (3)", …
   De bestanden staan in de `extra`-store (§5), los van `woning.json`.
6. **Verlichting** — accordeon **enkel zichtbaar bij gemene delen** (voor het
   hele gebouw, niet per ruimte): cycle lamptype (Led / TL / Spaarlamp /
   Halogeen / Gloeilamp / Andere), veld "aantal", veld "vermogen per lamp (W)"
   (optioneel), knop "Voeg verlichting toe". Lijst met regels
   "n × Type · x W per lamp"; **tik = bewerken** (regel komt in het formulier,
   knop wordt "Bewaar wijziging", met "Annuleer wijziging"), × = `confirm()`.
   Totaalregel "N lichtpunten · X W totaal" (aantal × watt gesommeerd, regels
   zonder watt tellen niet mee in het vermogen). Opgeslagen in
   `energie.verlichting`.
### 7.4 Tab Details — per geselecteerde ruimte, drie accordeons
Volgorde: **Ventilatie (open) → Verwarming in deze ruimte → Ramen & deuren.**
- **Ventilatie**: cycle `geen → natuurlijk → mechanisch → mechanisch permanent →
  ander`. Bij "ander" een beschrijvingsveld onder de knop, met focus, geen popup.
- **Verwarming in deze ruimte**: cycle Airco/Kachel/Andere (`ruimte-andere`);
  **Afmetingen ruimte (m)** b × d × h met live m³, opgeslagen op de ruimte (één keer
  per ruimte; leeg = `afm: null`); beschrijving; 📷 Foto kenplaat (één foto; het
  record gebruikt hetzelfde `fotoIds`-veld met 0 of 1 foto); "Voeg toestel toe".
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
  - **Privatief (enkel bij gemene delen)**: extra cycle "Deel: Gemeen/Privatief"
    in het formulier. Privatief = een raam/deur van een privatief appartement
    (inspectieprotocol: telt enkel mee als oppervlakte-aftrek van de gevel) —
    beglazing-, kader- en rolluik-knoppen verdwijnen; enkel element, gevel,
    b × h en aantal, plus de foto-optie. Opgeslagen met `privatief: true`,
    `beglazing/kader = null`, `rolluik = false`. In de lijst draagt de rij de
    tag "privatief". Sorteervolgorde: privatieve elementen komen ná alle
    gemene (§7.4-sortering krijgt privatief als eerste sleutel).
- **Sorteervolgorde** (één functie, gebruikt door lijst, PDF en nummering):
  type deur → raam → dakraam; binnen elk type gevel voor → achter → links →
  rechts; dan beglazing enkel → dubbel → HR dubbel → drievoudig → vol paneel;
  dan kader pvc → alu → hout; ten slotte aanmaakvolgorde. Identieke ramen
  (zelfde gevel, glas en kader) staan zo altijd naast elkaar. `#nr` =
  1-gebaseerde index in die volgorde.
- De lijst toont **álle elementen van de woning, nieuwste bovenaan**
  (aanmaakvolgorde, laatst ingegeven eerst): zo is het laatst ingegeven raam
  altijd rij 1 en corrigeer je een vergissing meteen. Het `#nr` blijft het
  huisbrede volgnummer uit de sorteervolgorde (matcht de PDF, die gegroepeerd
  blijft).
- Rij toont "#nr Element · Gevel · n× · Ruimte", "b × h m = x m² (totaal)",
  tags (privatief · beglazing · kader · rolluik). Totaalregel: alle elementen
  en m² van de woning (aantallen meegeteld).
- **Bij het bewerken** verschijnt een extra cycle **"Ruimte"** die door de echte
  ruimtes draait: zo verzet je een verkeerd geplaatst element (bv. van Hal naar
  Slaapkamer). De ruimtebalk springt niet meer mee bij het bewerken en blijft
  bepalen waar een níeuw element belandt; de Ruimte-cycle is verborgen buiten
  het bewerken.
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
- **Altijd de ultragroothoek (0,5×)** als het toestel er een heeft: na de eerste
  toestemming zijn de apparaatlabels leesbaar; de achterste ultragroothoek wordt
  herkend aan "ultra" in het label (Engels "Ultra Wide" én Nederlands
  "ultragroothoek") en de stream wordt heropend met dat `deviceId`. Geen
  ultragroothoek gevonden (ouder toestel, desktop, testomgeving) of de lens
  weigert → de standaard achtercamera blijft stil staan als fallback. Geldt voor
  dossier- én enkel-modus (zelfde `startCamera`).
- **Flits mét ultragroothoek**: de 0,5×-lens heeft zelf geen torch; de flitsknop
  verschijnt als de actieve lens **of de hoofdlens** torch meldt (dat laatste
  wordt gepeild vóór de lenswissel). Flits aan terwijl 0,5× actief is → de
  camera wisselt naar de hoofdlens zolang de flits brandt; flits uit → terug
  naar 0,5×. Mislukt er iets → flits uit, toast "Flits niet beschikbaar op dit
  toestel".
- **Heel het beeld is de sluiter**: er is geen witte sluiterknop; elke tik op de
  overlay neemt een foto (frame → JPEG), behálve op de echte knoppen — Klaar/
  Annuleer, de flitsknop en de ruimtechips doen gewoon hun werk. Onderaan staat
  als hint "Tik eender waar voor een foto" (klikt niet, `pointer-events:none`).
  Bij een foto in dossier-modus knippert het beeld even (opacity-dip 140 ms) als
  bevestiging.
- **Dossier-modus** ("Start camera"): ruimtechips bovenaan (wisselen zonder sluiten),
  flitsknop 🔦 rechtsboven **enkel als een lens torch meldt** (zie de flits-bullet
  hierboven; toggle via `applyConstraints({advanced:[{torch}]})`, geel als aan);
  onderaan teller "N foto's", de hint en "Klaar". Elke tik: foto in de actieve groep.
- **Enkel-modus** (kenplaat, kranen, afstandhouder, toestel): geen chips, knop
  "Annuleer", één tik → foto op zijn plek, camera dicht.
- **Fallbacks**: enkel-modus → verborgen `<input type="file" accept="image/*"
  capture="environment">`; dossier-modus → toast met foutnaam, bibliotheekkiezer opent.
- Tracks stoppen bij Klaar/Annuleer, visibilitychange (met save) en pagehide.
### 7.7 Tab Afronden
- **Controlelijstje** (informatief, nooit blokkerend, vers berekend bij openen).
  Bij een **woning**: ✅/❌ voor (1) elke ruimte minstens één foto (bij ❌ de
  namen), (2) verwarming ingevuld (≥1 opwekker of toestel), (3) hoofdfoto
  gekozen. Bij **gemene delen** (niets is verplicht in het protocol, dus enkel
  praktische geheugensteuntjes): (1) ramen & deuren ingegeven (≥1 gemeen
  element), (2) privatieve ramen ingegeven (≥1 privatief element — de
  oppervlakte-aftrek van de gevels), (3) verlichting ingevuld (≥1 regel),
  (4) hoofdfoto gekozen.
- **"💾 Bewaar dossier"** met voortgangsbalk uit de worker.
- Grijze regel "Dossier bewaard op <datum en uur>" indien `pdfBewaardOp`; is er
  nadien nog gewijzigd, dan staat er rood " — nadien gewijzigd, bewaar opnieuw"
  achter (§6).
- "Woning sluiten" (navigeert terug, wijzigt niets).
- "Woning verwijderen" (rood, altijd actief, gedrag volgens §6).
### 7.8 Instellingen: NAS-upload (optioneel, per toestel)
Onderaan de woningenlijst staat één **discreet tandwiel** (⚙, gecentreerd,
grijs) — verder niets. Het opent het **instellingenpaneel**, een overlay die
van onderen over de lijst schuift met "Sluiten" rechtsboven; een tik naast het
paneel sluit het ook. Dat is de enige plek met instellingen, zodat ze niet in
de dagelijkse flow staan.
Bovenaan het paneel staat één schakelaar **"Upload via WebDAV"** (Uit/Aan,
`aan` in de instellingen). **Uit** (de standaard) toont enkel de regel "Uit:
dossiers gaan via het deelmenu van iOS" — verder niets. **Aan** klapt de velden
open: **Server** (mét poort als de NAS die gebruikt, bv.
`https://192.168.0.200:5006`), **Gebruikersnaam**, **Wachtwoord**, **Map op de
NAS** (met een 📁-knop, zie hieronder) en de knop **"Verbinding testen"**, met
één korte uitleg erboven. Elke toetsaanslag bewaart in
`localStorage['epc-nas']` (per toestel; het wachtwoord staat er in leesbare
vorm, net als de dossierteller — bewuste keuze voor één gebruiker op één
iPhone). De upload gebeurt enkel als de schakelaar aan staat **én** server en
gebruikersnaam ingevuld zijn.
- **Map kiezen i.p.v. tikken**: de 📁-knop bladert met **`PROPFIND` Depth 1**
  door de NAS. De lijst toont enkel mappen (`DAV:collection`), met bovenaan
  "⬆ Een map omhoog" zodra je dieper zit; een tik gaat de map in. **"Kies deze
  map"** legt het huidige pad vast, **"Annuleer"** sluit de bladeraar. Paden
  worden altijd relatief aan de server-url bewaard (een basispad in die url,
  bv. `/dav`, wordt er afgehaald). Mislukt het bladeren → toast "Bladeren
  mislukt (reden)". Het veld blijft ook gewoon met de hand invulbaar.
- **Uit = de gewone flow.** Staat de schakelaar uit (of ontbreekt server of
  gebruikersnaam), dan verandert er niets: "Bewaar dossier" gaat naar de
  deelkaart zoals altijd (§9.3).
- **Ingesteld**: de zip gaat met **WebDAV `PUT`** naar
  `<server>/<map>/<zipnaam>` met Basic-auth (UTF-8-veilig ge-encodeerd), elk
  padstuk apart url-ge-encodeerd. Antwoordt de server **409** (bovenliggende map
  bestaat niet), dan maakt de app de map met **`MKCOL`** aan en probeert
  opnieuw. Gelukt → `pdfBewaardOp` wordt gezet en toast "Dossier op de NAS
  bewaard".
- **Mislukt de upload** (netwerk/CORS/certificaat → "geen verbinding", 401/403 →
  "aanmelding geweigerd", 404 → "map niet gevonden", 405 → "WebDAV staat uit",
  507 → "NAS vol", anders "status N"), dan toast de app de reden en **valt terug
  op de deelkaart**. Een dossier gaat dus nooit verloren door een NAS die niet
  antwoordt.
- **Nooit stilzwijgend mislukken.** Een mislukte upload is niet alleen een
  toast (die verdwijnt achter de deelkaart), maar een **blijvende stand**:
  - `nasBewaardOp` wordt enkel gezet ná een geslaagde upload, in dezelfde write
    als `pdfBewaardOp`;
  - de **statuspill** in de lijst toont rood **"Niet op NAS"** zolang een
    bewaard dossier niet (of niet meer) op de NAS staat — die stand overleeft
    het sluiten van de app;
  - op **Afronden** staat rood **"NIET OP DE NAS — reden"** (of "GEWIJZIGD
    SINDS DE NAS-KOPIE") met daaronder de knop **"Opnieuw naar de NAS
    sturen"**, die de zip vers bouwt en enkel naar de NAS stuurt (geen
    terugval); staat alles goed, dan staat er grijs "Op de NAS gezet op …";
  - **verwijderen** vraagt dan het typ-slot van §6 in plaats van een gewone
    bevestiging.
- **Enkel https**: de app draait op een https-oorsprong, dus een `http://`-NAS
  wordt door de browser geblokkeerd (gemengde inhoud). De app weigert zo'n url
  meteen met "Server moet met https:// beginnen", vóór er iets geprobeerd wordt.
- **Diagnose bij "geen verbinding"**: die fout kan drie dingen betekenen, dus
  doet de app een **no-cors-probe** (`GET` op de server) om ze te scheiden.
  Slaagt die → "NAS antwoordt, maar blokkeert de app (CORS)"; faalt die →
  "NAS niet bereikbaar — zit je op wifi of VPN? (anders: ip, poort of certificaat)". De **ruwe browsertekst**
  hangt er tussen rechte haken achter (vaak het enige echte spoor), de toast
  blijft dan 6 s staan, en de uitslag van "Verbinding testen" blijft in het
  paneel staan tot de volgende test. Onder "Verbinding testen"
  staat één hint met de manuele controle (server openen in Safari) en de exacte
  CORS-eisen.
- **Meldingen boven alles**: de toast heeft een hogere `z-index` dan het
  instellingenpaneel, de camera en de lightbox — anders verdwijnt bv. het
  resultaat van "Verbinding testen" onzichtbaar achter de overlay.
- **Time-outs**: elke NAS-oproep heeft een harde limiet (upload 120 s, de rest
  15 s) via `AbortController`. Een verkeerd ip of een dichte poort geeft dus
  "geen antwoord (time-out)" in plaats van een app die blijft hangen.
- **"Verbinding testen"** schrijft echt: `PUT` van `epc-verbindingstest.txt`
  (met dezelfde `MKCOL`-stap) en daarna `DELETE`. Zo test hij aanmelding, CORS
  én schrijfrecht in één keer. Toast "Verbinding ok — schrijven lukt" of "Geen
  verbinding (reden)".
- **Randvoorwaarden aan de NAS-kant** (buiten de app om): de NAS moet CORS
  toelaten voor `https://miletielenss.github.io` met de methodes `PUT`, `MKCOL`,
  `DELETE` en `PROPFIND`, de headers `Authorization` en `Depth`, en
  `OPTIONS`-preflights beantwoorden;
  en het https-certificaat van de NAS moet op de iPhone vertrouwd zijn. Zonder
  die twee blokkeert de browser de upload en toont de app "geen verbinding".
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
1. **Kop**: klein grijs "EPC Plaatsbezoek" — bij gemene delen "EPC Plaatsbezoek
   — gemene delen" —, adres (vet 15 pt, gewrapt), "Datum plaatsbezoek: …".
   Hoofdfoto rechtsboven, 130 pt breed, max 100 pt hoog.
2. **RAMEN & DEUREN** (hoofdletters + lijn): **één tabel per type**, in de
   volgorde Deuren → Ramen → Dakramen (vet subkopje 9 pt boven elke tabel);
   een tabel verschijnt enkel als dat type voorkomt. Kolommen #, Ruimte, Gevel,
   Aant., m², Beglazing, Kader, Rolluik, B (m), H (m) — de Type-kolom is weg
   (het subkopje zegt het al) en de Deuren-tabel heeft géén beglazingskolom
   (een deur heeft enkel een profiel). De **m² is de oppervlakte van één
   exemplaar** (zo gaat hij rechtstreeks de VEKA-software in, met Aant.
   ernaast); B en H staan achteraan enkel als naslag. Elke tabel eindigt met een
   eigen **totaalregel** die wél aantal × m² optelt; bij meer dan één type volgt
   daaronder "Alle elementen samen: N stuks · X m²". De nummering (`#`) loopt
   door over de tabellen en matcht de app (§7.4). 7,5 pt, celranden, wrap per
   cel, getallen rechts, totaalregel vet.
   **Privatieve elementen** (gemene delen, §7.4) staan ná de gemene tabellen in
   één eigen tabel **"Privatieve vensters (enkel oppervlakte)"** met kolommen
   #, Type, Gevel, Aant., m², B (m), H (m) en een totaalregel; daaronder één
   regel per gevel "Privatief <gevel>: X m²" (aantal × m² per gevel — het
   aftrekgetal voor de VEKA-invoer). Ze tellen niet mee in "Alle elementen
   samen".
   Alle maten in de PDF staan met exact twee cijfers na de komma ("1,00");
   de UI toont meters zonder afkapping (1,335). Sortering en nummering exact als
   §7.4. Daaronder de raamfoto's: 4 per rij, cel 82 pt, contain, gecentreerd, grijs
   bijschrift 6,5 pt "Element gevel – ruimte, afstandhouder/kenplaatje".
3. **ENERGIE**: tabel #, Opwekker, Ruimte, Doet, Beschrijving (bij airco/kachel met
   "ruimte b × d × h m = x m³"). Daaronder kenplaat- en kranenfoto's, zelfde raster,
   bijschrift "Type – ruimte, kenplaat/radiatorkranen". Daarna, als er
   verlichting genoteerd is (gemene delen): tabel **Verlichting** met kolommen
   #, Lamptype, Aantal, W per lamp, Totaal W en een vette totaalregel
   "N lichtpunten · X W" (regels zonder wattage tellen niet mee in het
   vermogen). Dan **Zonnepanelen**
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
   - `extra/` — **altijd aanwezig** (ook leeg): de vaste plek voor bijlagen. De
     bestanden uit de `extra`-store (§7.3) staan er als `extra/<naam>`, en wat
     je er zelf bijlegt vóór het herzippen komt bij een import gewoon mee terug
     (§9.4). De inhoud staat los van `woning.json`.
3. **`<adres>`** = het ingevulde adres met tekens die een bestandsnaam breken
   (`/ \ : * ? " < > |`) vervangen door spaties, meervoudige spaties
   samengevouwen (fallback "EPC plaatsbezoek"); spaties, komma's en koppeltekens
   blijven behouden. **De zip zelf** heet `"<nummer>. <adres>.zip"` (§7.1), bv.
   `"24. Pelgrimlaan 15, Hasselt.zip"`; bij gemene delen
   `"<nummer>. GD <adres>.zip"` — zelfde nummering met het GD-voorvoegsel,
   zodat woningen en gemene delen in dezelfde map samen sorteren. Nummer en
   voorvoegsel staan enkel op de buitenverpakking. `File` met die naam →
   `navigator.share({files})`.
3b. **NAS ingesteld (§7.8)**: de zip gaat eerst via WebDAV naar de NAS; gelukt →
   `pdfBewaardOp` gezet, klaar. Mislukt → toast met de reden en verder met de
   deelkaart hieronder.
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
- **De opwekkerfoto's staan enkel op de opwekker** (`kenplaatFotos` — een
  lijst, want een kenplaat kan uit meerdere plaatjes bestaan — en `kranenFoto`),
  niet nog eens in een ruimte.
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
  soort?: "gemene-delen",        // ontbreekt bij een gewone woning
  ruimtes: [
    { naam: "Gevels", fotos: ["fotos/0001.jpg", …] },
    { naam, ventilatie?, ventilatieBeschrijving?, opmerking?,
      afmetingen?: { breedteM, diepteM, hoogteM },
      elementen?: [ { type, gevel, breedteM, hoogteM, aantal, beglazing?, kader, rolluik, foto? }
                    | { type, gevel, breedteM, hoogteM, aantal, privatief: true, foto? } ],
      toestellen?: [ { type, beschrijving?, kenplaatFotos? } ],
      fotos?: [ … ] },
    { naam: "Algemeen", fotos: [ … ] }
  ],
  energie?: {
    opwekkers?: [ { type, functies?, beschrijving?, kenplaatFotos?, kranenFoto? } ],
    zonnepanelen?: [ { orientatie?, wp } ],
    zonneboiler?: { collectorM2? },
    verlichting?: [ { type, aantal, wattPerLamp? } ]   // wattPerLamp als getal
  }
}
```
### 9.4 Importeren
- "Importeer dossier" op de woningenlijst opent een bestandskiezer (.zip).
- `maakzip.js` leest de zip via de **central directory** en aanvaardt store- én
  deflate-leden (deflate via `DecompressionStream('deflate-raw')`). Een dossier
  dat je uitpakt, aanvult met extra bestanden en opnieuw zipt (Finder, Windows,
  zip-cli — die comprimeren en gebruiken data descriptors) importeert dus
  gewoon: map-leden worden overgeslagen en bestanden waar de import niets mee
  doet, blijven onaangeroerd liggen. Andere compressiemethodes → duidelijke
  fout. `woning.json` wordt gecontroleerd op
  `formaat: 'epc-plaatsbezoek-dossier'`.
- **Finder-tolerant**: macOS zipt de map zelf mee (`Map/woning.json`) en voegt
  `__MACOSX/`, `._x`-bestanden en `.DS_Store` toe. De import negeert die
  metadata, zoekt `woning.json` óók onder een prefix (kortste pad wint) en
  rekent alle paden (`fotos/…`, `hoofdfoto.jpg`, `extra/…`) vanaf diezelfde map.
- `soort`, `privatief` en `verlichting` komen bij een import integraal terug;
  een privatief element wordt heropgebouwd met `beglazing/kader = null` en
  `rolluik = false`.
- **`extra/` reist mee**: alles onder `extra/` (ook in submappen) wordt bij de
  import integraal opgeslagen in de `extra`-store van de nieuwe woning en komt
  bij de volgende export weer in `extra/` terecht — de backup-lus
  (unzip → aanvullen → herzip → later importeren) verliest dus niets.
- Er wordt een **nieuwe** woning aangemaakt (nieuwe ids, `pdfBewaardOp: null`, het
  volgende vrije dossiernummer volgens §7.1):
  de geneste structuur wordt teruggevouwen — "Gevels"/"Algemeen" worden weer
  fotogroepen, de andere ruimtes echte ruimtes, hun `elementen` worden ramen,
  hun `toestellen` en de centrale `opwekkers` worden energie-opwekkers, foto's
  uit `fotos/` komen terug in hun groep en de `hoofdfoto` wordt hersteld. Elk
  fotobestand wordt maar één keer geschreven (dedupe op pad); dimensies uit de
  JPEG-header. Daarna opent de woning; `normaliseer()` vangt rommel in een
  bewerkte json op zoals altijd.
- Eén leesuitzondering: een oudere zip met een enkelvoudige `kenplaatFoto` wordt
  aanvaard als `kenplaatFotos` met één foto — zo blijven eerder geëxporteerde
  dossiers importeerbaar zonder fotoverlies.
- Mislukt het (geen zip, verkeerd formaat, onleesbaar lid) → toast
  "Importeren mislukt (reden)", er wordt niets half aangemaakt.
### 9.5 Updatemelding ("Nieuwe versie beschikbaar")
- **Kern**: de draaiende app kent zijn eigen versie — `swVersie`, gelezen uit de
  **gecachete** `sw.js` — en vergelijkt die met een **verse netwerk-fetch** van
  `sw.js`. Er is dus géén apart `version.json` of tweede versieconstante:
  `VERSIE` in `sw.js` blijft de enige (zie Werkwijze), en de check kan nooit uit
  de pas lopen met de cache-naam.
- **Ongecachet ophalen**: de fetch gebruikt een cache-buster (`sw.js?t=<nu>`) én
  `cache: 'no-store'`. De service worker laat elke url die `sw.js?` bevat
  **bewust ongemoeid** (vroege `return` in de fetch-handler) — anders zou de
  check door `ignoreSearch: true` altijd de oude, gecachete versie teruglezen.
- **Wanneer**: bij het opstarten (zodra `swVersie` gelezen is), elke 5 minuten,
  en telkens de app weer zichtbaar wordt (`visibilitychange` — op iOS staan
  timers stil in de achtergrond). Zonder controlerende service worker geen
  check (verse installatie is per definitie de nieuwste); offline faalt de
  check stil.
- **Melding**: verschilt de netwerkversie, dan verschijnt in de topbar de balk
  `#updatebalk` (accentkleur, opbouw als de foutbalk): "Nieuwe versie
  beschikbaar" + knop **"Nu bijwerken"**. Elke uitkomst van de check voedt ook
  de versieregel op de woningenlijst (§7.1: "— laatste versie" of "— update
  beschikbaar").
- **Atomische installatie**: de SW haalt bij de install élk asset op met
  `?v=VERSIE` en `cache: 'no-store'` — een per release unieke url, dus
  gegarandeerd vers voorbij de http-cache én de CDN-cache van GitHub Pages
  (die tot 10 min oude bestanden kan geven). Opgeslagen onder de kale url.
  Eén niet-ok antwoord breekt de hele install af. Zo bestaat een **halve
  update** (oude `app.js` naast een nieuwe `sw.js`) niet meer.
- **"Nu bijwerken"**: toast "Bijwerken…", dan `registration.update()` — de
  nieuwe SW installeert eerst alles vers; daarna stuurt de pagina
  `skipWaiting`, en zodra de nieuwe SW **activated** is herlaadt de pagina,
  bediend uit de nieuwe cache. Vindt `update()` (nog) geen nieuwe SW (CDN nog
  niet bijgewerkt) → toast "De update is nog niet overal beschikbaar — probeer
  zo opnieuw". Mislukt de installatie (`redundant`) → toast "Bijwerken
  mislukt". IndexedDB (woningen, foto's) en localStorage (dossierteller)
  blijven onaangeroerd.
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
`npm run nas` staat daarnaast (niet in de vaste release-set, want hij opent
poorten): een **echte https-WebDAV-server** met een zelfondertekend certificaat
waar de echte app tegenaan praat. Hij bewijst twee dingen tegelijk — met een
**niet-vertrouwd** certificaat blokkeert de browser vóór het netwerk (de server
ziet niets, de app meldt "niet bereikbaar"), en met een **vertrouwd**
certificaat loopt de volledige upload (`OPTIONS`, `PUT` met Basic-auth,
`DELETE`) wél door. Zo blijft aantoonbaar dat een mislukte NAS-upload een
certificaat- of CORS-kwestie is en geen fout in de app.
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
