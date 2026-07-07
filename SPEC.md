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
  `app.js`, `pdf.js` (PDF-generator), `style.css`, `sw.js`, `manifest.json`, iconen.
- **PWA, volledig offline** na installatie op het beginscherm (iOS Safari).
- Opslag: **IndexedDB** (`epc-db`, store `woningen`, keyPath `id`); `navigator.storage.persist()`
  wordt gevraagd tegen eviction. **Autosave elke 3 s** en bij `pagehide`/`visibilitychange`;
  rechtsboven staat "opgeslagen HH:MM:SS".
- **Service worker**: cache-naam `epc-vNN` én dezelfde waarde als `APP_VERSIE` in
  `app.js` — **bij elke release worden beide samen opgehoogd**. De fetch-handler
  leest **uitsluitend uit zijn eigen cache** (nooit uit oude caches), zodat een
  nieuwe SW nooit oude bestanden kan serveren. Update-check bij elke start en bij
  terugkeer naar de app; nieuwe versie activeert meteen (skipWaiting +
  clients.claim) en de pagina herlaadt automatisch (niet bij eerste installatie).
  **Zelfherstel**: meldt de SW een andere versie dan `APP_VERSIE`, dan draait de
  pagina op verouderde bestanden en herlaadt ze zichzelf één keer automatisch
  (sessionStorage-vlag tegen herlaadlussen). De SW beantwoordt `'versie'`-messages
  met zijn cache-naam en `'skip'` met skipWaiting.
- Startscherm toont **"Versie vNN"** (de écht draaiende versie, via SW-message) en een
  knop **"Zoek update"** die een update forceert met eerlijke feedback
  ("Je hebt al de nieuwste versie" / "Update gevonden, app herlaadt zo…").
- Enige externe call: **reverse geocoding** (Nominatim/OpenStreetMap) bij de locatieknop
  naast het adresveld; offline vallen we terug op coördinaten.
- Deploy: **GitHub Pages** via workflow op push naar `main`. Er wordt direct op `main`
  gewerkt; branch `v1` is het historische checkpoint van de eerste stabiele
  eindversie (nooit op verder bouwen).

### Foto's (resolutie)

Alle foto's mogen scherp zijn zolang de bestanden klein blijven:

- Detailfoto's (afstandhouder, kenplaat, kranen): max **1200 px**, JPEG kwaliteit 0.7.
- Dossierfoto's: max **2000 px**, kwaliteit 0.7. Hoofdfoto komt uit het dossier.
- **Algemeen-foto's (facturen/documenten): max 2600 px, kwaliteit 0.75** — tekst
  moet leesbaar blijven. De camera vraagt daarvoor een hogere streamresolutie.
- Geen esthetische eisen; tekst op kenplaten en facturen moet leesbaar zijn.

## 3. Datamodel (woning-record)

```
{
  id, status ('open'|'afgewerkt'), gemaakt, gewijzigd,
  algemeen: { adres, foto (hoofdfoto, dataURL|null), datum, notities },
              // bouwjaar, gebouwtype, kelder en zolder worden NIET in de app
              // ingegeven: dat komt uit documenten of staat op de foto's
  ruimtes: [ { naam, vent ('geen'|'natuurlijk'|'mechanisch'|'mechanisch-permanent'|'ander'),
               ventBeschrijving, opm, afm ({b,d,h} in meter | null) } ],
  ramen:   [ { nr, ruimte, element ('raam'|'deur'|'dakraam'),
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

- `normaliseer()` vult ontbrekende velden aan met defaults en herstelt tellers/nrs.
  **Er is geen legacy-migratiecode**: er bestaan geen woningen van oudere
  modelversies meer. Wijzigt het datamodel in de toekomst, voeg dan pas migratie
  toe als er op dat moment echte data in omloop is.

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
- Alleen in de **foto-context** (Foto's-tab en camerascherm) staan vooraan twee
  extra chips die geen ruimte zijn: **"Algemeen"** (eerst; losse algemene foto's
  zoals facturen/documenten, intern '__algemeen') en **"Gevels"** (gevel- en
  dakfoto's). Ze verschijnen zo ook als titel in de PDF; overal in de UI heten ze
  "Algemeen"/"Gevels" (nooit de interne sentinel tonen). Op de Foto's-tab is de
  **ventilatieregel verborgen** — ventilatie vul je op Details in.
- De gekozen ruimte geldt als label voor **alles wat je daarna toevoegt** (ramen,
  toestellen, dossierfoto's), tot je een andere kiest.
- **"+ Ruimte"** opent sneltoetsen (Slaapkamer, Badkamer, WC, Berging, Bureau, Garage,
  Zolder, Kelder, Veranda, "Andere naam…"). Bestaande naam ⇒ **autonummering**
  (Slaapkamer → Slaapkamer 2, 3, …). Nieuwe ruimte is meteen geselecteerd.
  Ruimtes verwijderen bestaat niet.
- Ruimtes staan altijd **gegroepeerd op basisnaam** (alle wc's samen, slaapkamers
  achter elkaar, …), op volgorde van eerste voorkomen; binnen een groep oplopend
  genummerd. Een nieuwe "Badkamer 2" komt dus naast "Badkamer" te staan.
- De header bevat **alleen de chips** — ventilatie en ruimtebeheer zitten op de
  Details-tab zelf (zie 4.4).

### 4.3 Tab Algemeen (de hele woning)

Vier duidelijk afgebakende, inklapbare secties die als **accordeon** werken: er is
er altijd **maximaal één open** (een sectie openen sluit de andere). **Woning staat
open** bij het binnenkomen (daar begin je: adres en datum):

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

- Sectie **Ventilatie** (tussen Ramen en Verwarming): roterende knop
  `geen → natuurlijk → mechanisch → mechanisch permanent → ander`; bij "ander"
  verschijnt een beschrijvingsveld onder de knop (geen popup).
- Onderaan de tab: een **opmerkingveld** per ruimte (bv. "recht achterboven in de
  hoek"). **Ruimtes verwijderen kan niet** (bewust: nooit nodig; een ongebruikte
  ruimte staat gewoon leeg).
De **drie secties** staan in deze volgorde: **Ventilatie → Verwarming in deze
ruimte → Ramen & deuren**, en werken als **accordeon** (één tegelijk open; een raam
of toestel bewerken opent vanzelf de juiste sectie). **Ventilatie staat open** bij
het binnenkomen en opent ook automatisch na het toevoegen van een nieuwe ruimte.

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

- **Controlelijstje** (informatief, nooit blokkerend) met groene vinkjes of rode
  kruisjes, telkens vers berekend bij het openen van de tab:
  1. elke ruimte minstens één foto (bij rood: welke ruimtes niet),
  2. verwarming ingevuld (minstens één opwekker of ruimtetoestel),
  3. hoofdfoto gekozen (ster op een gevelfoto).
- **"Bewaar PDF"** — genereert en deelt het PDF-dossier, zie §5.
- "Woning sluiten" (terug naar de lijst) en "Woning verwijderen" (confirm).

## 5. PDF (het dossier)

De app genereert **zelf een echt PDF-bestand** (vanilla JS in `pdf.js`, geen
dependencies; Helvetica base-14 met WinAnsi, foto's als JPEG/DCTDecode). Er is
géén print- of Safari-omweg meer: op **Afronden** staat één knop **"Bewaar PDF"**
die het bestand `"<adres>.pdf"` maakt en het deelt via het deelmenu
(`navigator.share` met een File; zonder deelmenu — desktop — wordt het gewoon
gedownload). **Enkel PDF**: er valt niets anders te bewaren.

Inhoud en volgorde:

- Kop: adres (vet), datum plaatsbezoek; hoofdfoto rechtsboven.
- Tabel **Ramen & deuren**: #, type, ruimte, gevel, aantal, B (m), H (m), m²
  (aantal meegerekend), beglazing, kader, rolluik; totaalregel. Deuren bovenaan,
  dan gevelvolgorde. Direct onder de tabel de bijhorende foto's
  (afstandhouder/kenplaatje) met type, gevel en ruimte als bijschrift — zonder nummers.
- Tabel **Energie**: alle opwekkers (centraal + per ruimte) met ruimte, functies,
  beschrijving en bij airco/kachel het ruimtevolume. Daaronder de kenplaat- en
  kranenfoto's met type en ruimte in het bijschrift, dan een regel **Zonnepanelen**
  (oriëntatie + Wp per installatie) en — alleen bij ja — **Zonneboiler** met m².
- Tabel **Ventilatie**: per ruimte de ventilatie, afmetingen en opmerking
  (natte ruimtes eerst).
- **Notities** (indien ingevuld).
- **Fotodossier** vanaf een nieuwe pagina: per groep een titel (Gevels, dan de
  ruimtes, **Algemeen laatst**) met de foto's in een compact raster van **4 per
  rij**, zonder bijschriften. Een groepstitel blijft nooit alleen onderaan een
  pagina achter: past de eerste fotorij er niet meer bij, dan verhuist de hele
  groep naar de volgende pagina. De **Algemeen-foto's (facturen) staan op eigen liggende A4-pagina's,
  2 per pagina**, paginavullend zodat ze leesbaar zijn.
- Elke pagina onderaan: adres · paginanummer.

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
