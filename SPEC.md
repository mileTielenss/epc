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

- **Zo weinig mogelijk kliks en knoppen**; vlot van ruimte naar ruimte kunnen wandelen.
  Keuzes met een vaste optielijst zijn **roterende knoppen** (label links, waarde
  rechts, draai-icoon ⟳): elke tik schuift naar de volgende optie; een lege waarde
  toont een gedimde "—". Alleen element (raam/deur/dakraam) en gevel blijven
  directe knoppenrijen omdat je die constant wisselt. Meerkeuze (functies van de
  verwarming) blijft chips.
- Elke energiedeskundige moet de app **zonder uitleg** direct begrijpen.
- **Elk onderdeel mag leeg blijven** (een ruimte zonder ramen, geen verwarming, …).
- **Elke verwijderknop vraagt bevestiging** (confirm), ook bij foto's; niets wordt
  ooit zonder "ben je zeker?" verwijderd.
- Afmetingen altijd in **meter met komma-decimalen** (zoals een digitale lasermeter
  toont, bv. `1,335`); m² en m³ rekenen live mee tijdens het typen.
- Mobile-first (iPhone), staand vergrendeld waar de browser dat toelaat.
- Tijdens het typen (toetsenbord open) verdwijnt de onderste tabbalk, zodat hij
  niet meespringt met het toetsenbord.

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
  algemeen: { adres, foto (hoofdfoto, dataURL|null), datum, notities },
              // bouwjaar, gebouwtype, kelder en zolder worden NIET in de app
              // ingegeven: dat komt uit documenten of staat op de foto's
  ruimtes: [ { naam, vent ('geen'|'natuurlijk'|'mechanisch'|'mechanisch-permanent'|'ander'),
               ventBeschrijving, opm, afm ({b,d,h} in meter | null) } ],
  ramen:   [ { nr, ruimte, element ('raam'|'deur'|'dakraam'; legacy 'glasdeur'
               wordt bij bewerken een 'deur'),
               gevel ('voor'|'achter'|'links'|'rechts'), b, h (meter),
               beglazing ('enkel'|'dubbel'|'hr-dubbel'|'drievoudig'|'paneel'),
               kader ('pvc'|'alu'|'hout'), rolluik (bool), aantal (≥1), foto } ],
  energie: { opwekkers: [ { nr, type ('gas'|'stookolie'|'andere' = centraal;
                            'airco'|'kachel' = ruimtegebonden), ruimte,
                            functie (['radiatoren'|'vloer'|'sww']), beschrijving,
                            foto (kenplaat), fotoKraan } ],
             pvPanelen: [ { orientatie ('plat'|'voor'|'achter'|'links'|'rechts'|''), wp } ],
             zonneboiler ('nee'|'ja'), zonneboilerM2 (m² collector, string) },
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
- "+ Nieuwe woning" en een uitklapbaar **"Info"**-blok (standaard dicht, **onderaan
  het scherm geduwd**, als subtiele gecentreerde grijze tekst "Info" zonder icoon of
  pijltje) met daarin: hoe alles bewaard wordt (nooit de app verwijderen
  zolang er woningen in staan), een tip over cameratoegang (Instellingen ▸ Apps ▸
  Safari ▸ Camera), de versieregel ("Versie vNN" + knop "Zoek update") en korte
  uitleg over de werkwijze. Versie en update zijn dus verstopt tot je ze nodig hebt.

### 4.2 Header met ruimtebalk

- Groene header met terugknop (enkel het pijltje "‹", zodat de titel ruimte krijgt),
  titel (adres) en een compacte savestamp in twee regels boven elkaar
  ("opgeslagen" / "HH:MM:SS"). Het adres moet leesbaar blijven.
- Op de tabs **Details** en **Foto's** (en in het camerascherm) staat in de header de
  **ruimtebalk**: één horizontaal scrollbare rij chips
  `Living · Keuken · Badkamer · WC · Slaapkamer 1 · + Ruimte` (geen Berging:
  niet elk huis heeft er een — die staat bij de sneltoetsen).
- Ruimtes zijn altijd ruimtes **binnen het beschermd volume**. Ramen en
  verwarmingstoestellen horen dus altijd bij een echte ruimte; op de Details-tab is
  er **geen "Buiten"-optie** en is altijd een ruimte geselecteerd (bij het openen
  automatisch de eerste).
- Alleen in de **foto-context** (Foto's-tab en camerascherm) staat vooraan een extra
  chip **"Gevels"** (bewust geen "ruimte"-naam): gevel- en dakfoto's horen bij geen
  enkele ruimte binnen het beschermd volume. "Gevels" is daar ook het bijschrift
  in de PDF.
- De gekozen ruimte geldt als label voor **alles wat je daarna toevoegt** (ramen,
  toestellen, dossierfoto's), tot je een andere kiest.
- **"+ Ruimte"** opent sneltoetsen (Slaapkamer, Badkamer, WC, Berging, Bureau, Garage,
  Zolder, Kelder, Veranda, "Andere naam…"). Bestaande naam ⇒ **autonummering**
  (Slaapkamer → Slaapkamer 2, 3, …). Nieuwe ruimte is meteen geselecteerd.
- Ruimtes staan altijd **gegroepeerd op basisnaam** (alle wc's samen, slaapkamers
  achter elkaar, …), op volgorde van eerste voorkomen; binnen een groep oplopend
  genummerd. Een nieuwe "Badkamer 2" komt dus naast "Badkamer" te staan.
- Bij een gekozen ruimte verschijnt eronder de **ventilatieknop**: elke tik schuift
  door `geen → natuurlijk → mechanisch → mechanisch permanent → ander`; bij
  "ander" verschijnt een **tekstveld onder de knop** (geen popup) voor de
  beschrijving. Daarnaast een ×-knop die de ruimte verwijdert (confirm;
  gekoppelde items blijven bestaan maar verliezen hun label).

### 4.3 Tab Algemeen (de hele woning)

Vier duidelijk afgebakende, inklapbare secties. **Woning staat open** (daar begin
je: adres en datum), de rest is **standaard dichtgeklapt**:

1. **Woning**: alleen adres (+ locatieknop) en datum plaatsbezoek (default vandaag).
   **Geen bouwjaar, gebouwtype, kelder of zolder**: dat komt uit de documenten of
   is op de foto's te zien.
2. **Verwarming** (centraal): roterende knop Gas/Stookolie/Andere; functiechips
   (radiatoren, vloerverwarming, sanitair warm water); beschrijving; kenplaatfoto;
   kranenfoto (alleen bij "radiatoren"). "Voeg verwarming toe" + lijst; tik op een
   rij om te wijzigen.
3. **Extra installaties**: **Zonnepanelen** — meerdere installaties, elk met een
   roterende oriëntatieknop (Plat dak/Voor/Achter/Links/Rechts) en een eigen
   vermogen in Wp; +-knop voegt toe, lijst met ×-verwijderen (confirm).
   **Zonneboiler** — roterende knop Nee/Ja (default Nee, geen lege stand); bij "Ja"
   verschijnt een veld voor de oppervlakte van de collector in m².
4. **Opmerkingen**: vrije notities.

De hoofdfoto van de woning kies je met de ★ op een dossierfoto.

### 4.4 Tab Details (per gekozen ruimte)

- Onderaan de tab: een **opmerkingveld** per ruimte (bv. "recht achterboven in de
  hoek", om rare indelingen later te kunnen staven).
- Sectie **Ramen & deuren** (inklapbaar, standaard open), **compact genoeg om op
  een iPhone te typen zonder te scrollen**: element (Raam/Deur/Dakraam) en gevel
  (Voor/Achter/Links/Rechts) als rijen zonder label, afmetingen b × h in meter met
  live m², een **aantal-regel** (label + − / +-stepper op één rij), en beglazing,
  kader en rolluik als **drie mini-roterende knoppen naast elkaar op één rij**.
  Daaronder de fotoknop **"Foto afstandhouder"** (heet bij een dakraam automatisch
  **"Foto kenplaatje"**) en "Voeg toe". Geen "Zelfde als vorige"-knop: het formulier
  onthoudt de laatste keuzes vanzelf (enkel afmetingen, aantal en foto worden
  leeggemaakt).
  **Tik op een rij in de lijst om te wijzigen** (ruimtebalk springt mee naar
  de ruimte van dat raam); annuleerknop aanwezig.
  **Sortering lijst én PDF: eerst alle deuren (deur + glasdeur), daarna de rest;
  telkens op gevel voor → achter → links → rechts, dan op nr.**
  Totaalregel telt het aantal (incl. aantallen) en de totale m².
- Sectie **Verwarming in deze ruimte** (inklapbaar, standaard dicht): roterende
  knop **Airco/Kachel/Andere** (type 'ruimte-andere' in het model; het
  beschrijvingsveld is daar het tekstvak), daaronder de **afmetingen van de ruimte** (b × d × h in
  meter, live m³) — die staan hier omdat ze enkel nodig zijn bij een airco of
  kachel, en je ze maar één keer per ruimte ingeeft, hoeveel toestellen er ook
  hangen — plus beschrijving en kenplaatfoto. Meerdere toestellen per ruimte
  mogelijk; het volume komt van de ruimte-afmetingen. De lijst toont **alleen de
  toestellen van de geselecteerde ruimte**; tik om te wijzigen. Zonder gekozen ruimte toont de sectie "Kies bovenaan een
  ruimte".

### 4.5 Tab Foto's (fotodossier)

- Minimaal gehouden: **geen categorieën**, het bijschrift is de ruimte (of "Gevels").
- Een **uitklapbaar infoblok** (standaard dichtgeklapt) somt de minimaal vereiste
  foto's uit het inspectieprotocol op: gevels (elke veilig bereikbare),
  schildelen per hoofdtype, isolatie (type/dikte herkenbaar), beglazing/kaders
  (opschriften leesbaar), verwarming (kenplaat, label, thermostaat, afgifte,
  buitenvoeler), sanitair warm water, koeling, ventilatie, zonne-energie met
  oriëntatie — telkens detail- én overzichtsfoto's.
- **"Start camera"**: eigen camerascherm (getUserMedia, achtercamera) dat **open
  blijft**: grote sluiterknop, teller, ruimtechips bovenaan om al wandelend van
  ruimte te wisselen, **flitsknop (torch) alléén als het toestel dat via de browser
  toelaat** (iOS meestal niet), "Klaar" sluit af. Camera stopt netjes bij
  achtergrond/pagehide.
- **"Kies foto's"**: meerdere foto's tegelijk uit de bibliotheek (zoals een
  zoekertjessite); ook het vangnet voor donkere ruimtes op iOS (native camera mét flits).
- **Losse fotoknoppen elders in de app** (kenplaat, kranen, afstandhouder/kenplaatje)
  openen dezelfde interne camera in **enkel-modus**: zonder ruimtechips, met
  "Annuleer"; één tik op de sluiter en de camera sluit meteen met de foto op zijn
  plek. Lukt de camera niet (geen toestemming), dan valt het terug op de
  camerakiezer van het toestel zelf. Faalt de **dossier-camera**, dan opent
  automatisch de bibliotheekkiezer en meldt een toast de foutnaam plus de
  iOS-instellingstip.
- Het raster toont **alleen de foto's van de geselecteerde ruimte** (of van
  "Gevels"); de totaalregel vermeldt ook het totale aantal.
  Per foto: **⇄** = verplaats naar een andere ruimte (keuzepaneel onderaan, zodat
  je de foto niet moet hernemen), **×** = verwijderen (confirm). Alleen bij
  **Gevels-foto's** staat een **★** om die foto als hoofdfoto van de woning te
  kiezen (confirm; foto blijft ook in het dossier): de ster is **wit** op kiesbare
  foto's en **geel** op de huidige hoofdfoto. Tik op de foto zelf = lightbox.

### 4.6 Tab Afronden

Bewust minimaal, géén ventilatie-overzicht (de PDF bevat die tabel al):

- **"Print one-pager (PDF)"** — zie §5.
- "Woning sluiten" (terug naar de lijst) en "Woning verwijderen" (confirm).

## 5. PDF (one-pager + fotodossier)

De PDF is het volledige, blijvende dossier en bevat **alle** gegevens:

- Kop: hoofdfoto, adres, **datum plaatsbezoek**.
- Tabel **Ramen & deuren**: #, type, ruimte, gevel, aantal, B (m), H (m), m²
  (aantal meegerekend), beglazing, kader, rolluik; totaalregel. Deuren bovenaan,
  dan gevelvolgorde. **Direct onder de tabel** staan de bijhorende foto's
  (afstandhouder/kenplaatje) met als bijschrift type, gevel en **ruimte** —
  zonder nummers.
- Tabel **Energie**: alle opwekkers (centraal + per ruimte) met ruimte, functies,
  beschrijving en bij airco/kachel het ruimtevolume. **Direct onder de tabel**
  staan de bijhorende kenplaat- en kranenfoto's met type en **ruimte** in het
  bijschrift — zonder nummers. Daarna een regel **Zonnepanelen** (elke installatie
  met oriëntatie en Wp) en — **alleen als er een zonneboiler is** — een regel
  **Zonneboiler** met m² collector.
- Tabel **Ventilatie**: per ruimte de ventilatie, afmetingen en opmerking.
- Notities.
- **Fotodossier op een aparte pagina** (paginabreak): adres + datum + alle
  dossierfoto's in een raster met enkel de ruimte als bijschrift (geen nummers).

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
