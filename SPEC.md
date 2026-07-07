# SPEC — EPC Plaatsbezoek

**Dit bestand is de bron van waarheid.** Het beschrijft exact wat de app moet doen.
Elke functionaliteit hieronder is bewust gekozen. Wijzigingen aan de app beginnen
met een wijziging in dit bestand; code die afwijkt van deze spec is een bug.

## 1. Doel en werkwijze

De app dient **uitsluitend om gegevens te verzamelen** tijdens een EPC-plaatsbezoek
(energiedeskundige type A, Vlaanderen). De workflow is bewust simpel:

1. Nieuwe woning starten, gegevens en foto's verzamelen tijdens het bezoek.
2. Dagen later mag alles nog aangepast of aangevuld worden (data blijft lokaal staan).
3. Op het einde wordt de **PDF bewaard via Afronden** — dat is het blijvende dossier
   (bewijs voor het projectdossier, 10 jaar bewaarplicht bij controle door VEKA).
4. Daarna wordt de woning uit de app **verwijderd**.

Er is **géén backup-, export- of importfunctie** (bewust verwijderd). De PDF is het archief.
Het effectief invoeren in de certificatiesoftware gebeurt later, uitsluitend op basis van de PDF.

### UI-principes

- **Zo weinig mogelijk kliks**; vlot van ruimte naar ruimte kunnen wandelen.
- Elke energiedeskundige moet de app **zonder uitleg** direct begrijpen.
- **Elk onderdeel mag leeg blijven** (een ruimte zonder ramen, geen verwarming, …).
- **Elke verwijderknop vraagt bevestiging** (confirm), ook bij foto's; niets wordt
  ooit zonder "ben je zeker?" verwijderd.
- Afmetingen altijd in **meter met komma-decimalen** (zoals een digitale lasermeter
  toont, bv. `1,335`); m² en m³ rekenen live mee tijdens het typen.
- Mobile-first (iPhone), staand vergrendeld waar de browser dat toelaat.

## 2. Techniek

- **Vanilla HTML/CSS/JS, één pagina, geen dependencies.** Bestanden: `index.html`,
  `app.js`, `style.css`, `sw.js`, `manifest.json`, iconen.
- **PWA, volledig offline** na installatie op het beginscherm (iOS Safari).
- Opslag: **IndexedDB** (`epc-db`, store `woningen`, keyPath `id`); `navigator.storage.persist()`
  wordt gevraagd tegen eviction. **Autosave elke 3 s** en bij `pagehide`/`visibilitychange`;
  rechtsboven staat "opgeslagen HH:MM:SS".
- **Service worker**: cache-naam `epc-vNN` — **bij elke release wordt NN opgehoogd**.
  Update-check bij elke start en bij terugkeer naar de app; nieuwe versie activeert
  meteen (skipWaiting + clients.claim) en de pagina herlaadt automatisch (niet bij
  eerste installatie). De SW beantwoordt `'versie'`-messages met zijn cache-naam en
  `'skip'` met skipWaiting.
- Startscherm toont **"Versie vNN"** (de écht draaiende versie, via SW-message) en een
  knop **"Zoek update"** die een update forceert met eerlijke feedback
  ("Je hebt al de nieuwste versie" / "Update gevonden, app herlaadt zo…").
- Enige externe call: **reverse geocoding** (Nominatim/OpenStreetMap) bij de locatieknop
  naast het adresveld; offline vallen we terug op coördinaten.
- Deploy: **GitHub Pages** via workflow op push naar `main`. Er wordt direct op `main`
  gewerkt; branches `v1`, `v2`, … zijn historische checkpoints (nooit hergebruiken).

### Foto's (resolutie)

- Detailfoto's (afstandhouder, kenplaat, kranen): max **900 px**, JPEG kwaliteit 0.7.
- Dossierfoto's: max **1600 px**, kwaliteit 0.75. Hoofdfoto komt uit het dossier en is
  dus ook 1600 px — scherp genoeg om op de pc via save-as als gevelfoto te hergebruiken.
- Geen esthetische eisen; tekst op kenplaten moet leesbaar zijn.

## 3. Datamodel (woning-record)

```
{
  id, status ('open'|'afgewerkt'), gemaakt, gewijzigd,
  algemeen: { adres, foto (hoofdfoto, dataURL|null), datum, gebouwtype
              ('open'|'halfopen'|'gesloten'|'appartement'), bouwjaar,
              kelder (''|'nee'|'ja'), zolder (''|'geen'|'binnen'|'buiten'), notities },
  ruimtes: [ { naam, vent ('geen'|'natuurlijk'|'mechanisch'|'ander'),
               ventBeschrijving, opm, afm ({b,d,h} in meter | null) } ],
  ramen:   [ { nr, ruimte, element ('raam'|'deur'|'dakraam'|'glasdeur'),
               gevel ('voor'|'achter'|'links'|'rechts'), b, h (meter),
               beglazing ('enkel'|'dubbel'|'hr-dubbel'|'drievoudig'|'paneel'),
               kader ('pvc'|'alu'|'hout'), rolluik (bool), aantal (≥1), foto } ],
  energie: { opwekkers: [ { nr, type ('gas'|'stookolie'|'andere' = centraal;
                            'airco'|'kachel' = ruimtegebonden), ruimte,
                            functie (['radiatoren'|'vloer'|'sww']), beschrijving,
                            foto (kenplaat), fotoKraan } ],
             pv (''|'ja'|'nee'), wp },
  fotodossier: [ { nr, ruimte, foto } ],
  teller, tellerOpwek, tellerDossier
}
```

- `normaliseer()` migreert oude records verliesvrij (oude ventilatielijsten worden
  ruimtes, aircokamer-afmetingen verhuizen naar de ruimte, ontbrekende nrs/tellers
  worden hersteld). Nieuwe velden krijgen altijd een default zodat oude data blijft werken.

## 4. Schermen

### 4.1 Woningenlijst (startscherm)

- Lijst van woningen, **laatst gewijzigd bovenaan**, met hoofdfoto-miniatuur, adres, datum.
- Per woning: statusknop **Open/Af** (toggle) en ×-verwijderknop (met confirm).
- "+ Nieuwe woning", versieregel ("Versie vNN" + "Zoek update"), en een uitklapbare
  uitleg over lokaal bewaren (nooit de app verwijderen zolang er woningen in staan).

### 4.2 Header met ruimtebalk

- Groene header met terugknop, titel (adres) en savestamp.
- Op de tabs **Details** en **Foto's** (en in het camerascherm) staat in de header de
  **ruimtebalk**: één horizontaal scrollbare rij chips
  `Buiten · Living · Keuken · Badkamer · WC · Berging · Slaapkamer 1 · + Ruimte`.
- **"Buiten"** = geen specifieke ruimte (default; gevelfoto's e.d.).
- De gekozen ruimte geldt als label voor **alles wat je daarna toevoegt** (ramen,
  toestellen, dossierfoto's), op elke tab, tot je een andere kiest.
- **"+ Ruimte"** opent sneltoetsen (Slaapkamer, Badkamer, WC, Bureau, Garage, Zolder,
  Kelder, Veranda, "Andere naam…"). Bestaande naam ⇒ **autonummering**
  (Slaapkamer → Slaapkamer 2, 3, …). Nieuwe ruimte is meteen geselecteerd.
- Bij een gekozen ruimte verschijnt eronder de **ventilatieknop**: elke tik schuift
  door `geen → natuurlijk → mechanisch → ander`; bij "ander" wordt om een
  beschrijving gevraagd. Daarnaast een ×-knop die de ruimte verwijdert (confirm;
  gekoppelde items blijven bestaan maar verliezen hun label).

### 4.3 Tab Algemeen (de hele woning)

- Adres (+ locatieknop), datum plaatsbezoek (default vandaag), gebouwtype,
  bouwjaar, **Kelder** (Geen/Ja), **Zolder** (Geen/Binnen BV/Buiten BV).
- **Centrale verwarming**: type Gas/Stookolie/Andere; functies (radiatoren,
  vloerverwarming, sanitair warm water — meerdere mogelijk); beschrijving;
  kenplaatfoto; kranenfoto (alleen zichtbaar als "radiatoren" gekozen is).
  "Voeg verwarming toe" + lijst; **tik op een rij om te wijzigen** (knop wordt
  "Bewaar wijziging", annuleerknop verschijnt).
- **PV-panelen** Ja/Nee + vermogen in Wp.
- Notities (vrije tekst).
- Geen aparte hoofdfoto-knop: de hoofdfoto kies je met de ★ op een dossierfoto.

### 4.4 Tab Details (per gekozen ruimte)

- Bovenaan (alleen bij een echte ruimte, niet bij Buiten): **Afmetingen ruimte (m)**
  breed × diep × hoog met live m³ — één keer per ruimte, hoeveel toestellen er ook
  hangen — en een **opmerkingveld** (bv. "recht achterboven in de hoek", om rare
  indelingen later te kunnen staven).
- Sectie **Ramen & deuren** (inklapbaar, standaard open):
  element (Raam/Deur/Dakraam/Glasdeur), gevel als één regel (Voor/Achter/Links/Rechts),
  afmetingen b × h in meter met live m², **aantal identieke** (− / +-stepper),
  beglazing, kader, rolluik, foto afstandhouder.
  Knoppen: "Voeg toe" en **"Zelfde als vorige"** (herhaalt de laatste invoer, focus op
  breedte). **Tik op een rij in de lijst om te wijzigen** (ruimtebalk springt mee naar
  de ruimte van dat raam); annuleerknop aanwezig.
  **Sortering lijst én PDF: eerst alle deuren (deur + glasdeur), daarna de rest;
  telkens op gevel voor → achter → links → rechts, dan op nr.**
  Totaalregel telt het aantal (incl. aantallen) en de totale m².
- Sectie **Verwarming in deze ruimte** (inklapbaar): alleen **Airco of Kachel**
  (ruimtegebonden toestellen), beschrijving, kenplaatfoto. Meerdere toestellen per
  ruimte mogelijk; het volume komt van de ruimte-afmetingen. Lijst gesorteerd per
  ruimte; tik om te wijzigen. Zonder gekozen ruimte toont de sectie
  "Kies bovenaan een ruimte".

### 4.5 Tab Foto's (fotodossier)

- Minimaal gehouden: **geen categorieën**, het bijschrift is de ruimte (of "Buiten").
- **"Start camera"**: eigen camerascherm (getUserMedia, achtercamera) dat **open
  blijft**: grote sluiterknop, teller, ruimtechips bovenaan om al wandelend van
  ruimte te wisselen, **flitsknop (torch) alléén als het toestel dat via de browser
  toelaat** (iOS meestal niet), "Klaar" sluit af. Camera stopt netjes bij
  achtergrond/pagehide.
- **"Kies foto's"**: meerdere foto's tegelijk uit de bibliotheek (zoals een
  zoekertjessite); ook het vangnet voor donkere ruimtes op iOS (native camera mét flits).
- Raster van miniaturen, **gesorteerd per ruimte (Buiten eerst, dan ruimtevolgorde)**.
  Per foto: **★** = gebruik als hoofdfoto van de woning (confirm; foto blijft ook in
  het dossier), **⇄** = verplaats naar een andere ruimte (keuzepaneel onderaan, zodat
  je de foto niet moet hernemen), **×** = verwijderen (confirm). Tik op de foto zelf
  = lightbox.

### 4.6 Tab Afronden

- **Overzicht per ruimte**: ventilatie, afmetingen en opmerking (natte ruimtes
  keuken/badkamer/wc eerst, daarna alfabetisch; nummerreeksen blijven bij elkaar).
- **"Print one-pager (PDF)"** — zie §5.
- "Woning sluiten" (terug naar de lijst) en "Woning verwijderen" (confirm).

## 5. PDF (one-pager + fotodossier)

De PDF is het volledige, blijvende dossier en bevat **alle** gegevens:

- Kop: hoofdfoto, adres, **datum plaatsbezoek**, gebouwtype, bouwjaar, kelder- en
  zolderstatus.
- Tabel **Ramen & deuren**: #, type, ruimte, gevel, aantal, B (m), H (m), m²
  (aantal meegerekend), beglazing, kader, rolluik; totaalregel. Deuren bovenaan,
  dan gevelvolgorde.
- Tabel **Energie**: alle opwekkers (centraal + per ruimte) met ruimte, functies,
  beschrijving en bij airco/kachel het ruimtevolume. Daarna PV-regel.
- Tabel **Ventilatie**: per ruimte de ventilatie, afmetingen en opmerking.
- Notities.
- **Foto's**: afstandhouders, kenplaten, kranen met bijschrift (#nr, type, gevel/ruimte).
- **Fotodossier op een aparte pagina** (paginabreak): adres + datum + alle
  dossierfoto's in een raster met de ruimte als bijschrift.

Gedrag:

- **Bestandsnaam = het adres** (browser: via `document.title`-truc rond `window.print()`).
- **iOS-app op het beginscherm**: `window.print()` werkt daar niet — de one-pager
  opent dan als zelfstandige HTML-pagina in Safari (blob-URL), zónder knoppen of
  uitleg (opslaan/delen gaat via de deelknop van Safari zelf). De pagina is
  responsief (wit, brede tabellen scrollen zijdelings) en print als nette A4.

## 6. Werkafspraken voor ontwikkeling

- **Test elke wijziging** headless in Chromium
  (`/opt/pw-browsers/chromium-*/chrome-linux/chrome`, Playwright; camera testen met
  `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`): volledige
  klikflows, PDF-inhoud en persistentie na herladen. `node --check` op alle JS.
- **Bump `sw.js` cache-versie** bij elke release, commit in het Nederlands, push naar
  `main`, en verifieer daarna dat `https://miletielenss.github.io/epc/sw.js` de
  nieuwe versie serveert.
- Oude records moeten altijd blijven werken: migraties in `normaliseer()`, nooit
  destructief.
