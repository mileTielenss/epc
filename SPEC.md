# SPEC — EPC Plaatsbezoek

**Dit bestand is de bron van waarheid**, integraal afgeleid uit de code (v41).
Een nieuwe ontwikkelaar (of Claude) moet uit dit document alléén exact dezelfde
app kunnen herbouwen. Wijzigingen aan de app beginnen in dit bestand; code die
afwijkt van deze spec is een bug.

---

## 1. Wat is dit

Een **mobile-first offline webapp** waarmee één energiedeskundige type A
(Vlaanderen) tijdens een EPC-plaatsbezoek alle gegevens en foto's verzamelt.
De workflow is bewust minimaal:

1. Nieuwe woning starten; al wandelend per ruimte gegevens en foto's invoeren.
2. Dagen later mag alles nog aangevuld worden (alles staat lokaal op het toestel).
3. Op het einde: **"Bewaar PDF"** — de app genereert zelf een PDF-bestand, dat is
   het blijvende dossier (bewijs voor het projectdossier, 10 jaar bewaarplicht).
4. Daarna wordt de woning uit de app verwijderd.

Er is **geen backup, export of import**. De PDF is het archief. Het invoeren in
de certificatiesoftware gebeurt later, uitsluitend op basis van de PDF.

**Taal: alles Nederlands** — UI, code-commentaar, commits, deze spec.

### UI-principes

- Zo weinig mogelijk knoppen en kliks; vlot van ruimte naar ruimte wandelen.
- Elke deskundige moet de app zonder uitleg begrijpen.
- Elk onderdeel mag leeg blijven (ruimte zonder ramen, geen verwarming, ...).
- **Elke verwijderactie vraagt bevestiging** via `confirm()` — ook foto's.
- Afmetingen in **meter met komma-decimalen** (zoals een digitale lasermeter,
  bv. `1,335`); m² en m³ rekenen live mee tijdens het typen.
- Staand vergrendeld waar de browser dat toelaat (`screen.orientation.lock`).
- Tijdens het typen (focus op input/textarea) verdwijnt de onderste tabbalk
  (klasse `toets`), zodat hij niet meespringt met het iOS-toetsenbord;
  bij focusout (na 60 ms controle) komt hij terug.

---

## 2. Techstack en bestanden

**Vanilla HTML/CSS/JS. Nul dependencies, geen build-stap, geen framework.**

| Bestand | Rol |
|---|---|
| `index.html` | één pagina: alle views/secties, `<script src="pdf.js">` dan `app.js` |
| `app.js` | alle applicatielogica (~1.100 regels); begint met `const APP_VERSIE = 'epc-vNN'` |
| `pdf.js` | zelfstandige PDF-generator (~420 regels), functie `bouwPdf(S) → Promise<Blob>` |
| `style.css` | alle opmaak; CSS-variabelen in `:root` |
| `sw.js` | service worker; `const CACHE = 'epc-vNN'` (zelfde NN als APP_VERSIE) |
| `manifest.json` | PWA-manifest (naam "EPC Plaatsbezoek", standalone, portrait, thema `#0a6b3d`) |
| `icon-180/192/512.png` | iconen; regenereerbaar met `node tools/make-icons.js` |
| `.github/workflows/deploy.yml` | GitHub Pages deploy bij push naar `main` |
| `SPEC.md`, `CLAUDE.md` | deze spec + werkafspraken voor AI-sessies |

Kleuren (`:root`): accent `#0a6b3d` (donkergroen), accent-donker `#07522e`,
inkt `#101418`, gedempt `#5a6570`, achtergrond `#eef1f3`, kaart `#ffffff`,
lijn `#c9d1d8`, waarschuwing `#b3261e`. Basisfont: systeemfont
(`-apple-system, ...`), `html{font-size:14px}`.

---

## 3. Hosting, deploy en versiebeheer

- **GitHub Pages** op `https://miletielenss.github.io/epc/`, repo `mileTielenss/epc`.
- Workflow: push naar `main` → upload-pages-artifact → deploy-pages
  (aparte build/deploy-jobs, `concurrency: pages` zonder cancel).
- Er wordt **direct op `main`** gewerkt. Branch `v1` is een historisch
  checkpoint — nooit op verderbouwen.
- **Release = beide versies samen bumpen**: `CACHE` in `sw.js` én `APP_VERSIE`
  in `app.js` (zelfde `epc-vNN`-waarde), anders blijft het zelfherstel herladen.
- Na deploy controleren dat `https://miletielenss.github.io/epc/sw.js` de
  nieuwe versie serveert.

---

## 4. Offline, service worker en updates

- **PWA**: op het iPhone-beginscherm gezet werkt de app volledig offline.
- `sw.js` cachet bij install alle assets (`./`, index, css, app.js, pdf.js,
  manifest, iconen) in cache `epc-vNN`, doet `skipWaiting`; bij activate worden
  alle andere caches verwijderd + `clients.claim()`.
- **Fetch-strategie**: cache-first, maar **uitsluitend uit de eigen cache**
  (`caches.open(CACHE).match(...)`, `ignoreSearch: true`) — een nieuwe SW mag
  nooit bestanden van een oude versie serveren. Cache-miss → netwerk; gelukte
  same-origin-responses worden bijgecachet. Offline navigatie valt terug op
  `./index.html` uit de eigen cache.
- **Berichten**: SW beantwoordt `'versie'` met `{versie: CACHE}` en `'skip'`
  met `skipWaiting()`.
- **App-kant** (init): registratie met `updateViaCache:'none'`; `reg.update()`
  bij start en bij elke terugkeer (visibilitychange). Bij `controllerchange`:
  eerst `bewaar()` indien nodig, dan `location.reload()` — behalve bij de
  allereerste installatie.
- **Zelfherstel**: meldt de SW een andere versie dan `APP_VERSIE`, dan draait
  de pagina op verouderde bestanden → eenmalige `location.reload()`
  (sessionStorage-vlag `herlaadpoging` voorkomt lussen; vlag wordt gewist
  zodra versies kloppen).
- **Handmatig**: knop "Zoek update" (in het Info-blok) doet `reg.update()` met
  guard tegen dubbelklikken; feedback via toast ("Je hebt al de nieuwste
  versie" / "Update gevonden, app herlaadt zo…"); een wachtende SW krijgt
  `'skip'`. Het versielabel toont de écht draaiende versie (via SW-message).

---

## 5. Opslag en datamodel

- **IndexedDB** `epc-db`, versie 1, stores: `woningen` (keyPath `id`) en
  `instellingen` (ongebruikt maar aanwezig in het schema).
- `navigator.storage.persist()` wordt bij start gevraagd (tegen eviction).
- **Autosave**: dirty-vlag + interval elke 3 s, plus bij `pagehide` en bij
  `visibilitychange` (verbergen). Savestamp rechtsboven: twee regels
  "opgeslagen" / "HH:MM:SS".
- Data verdwijnt alleen als de gebruiker de app van het beginscherm verwijdert
  of Safari-websitedata wist (staat zo in het Info-blok).

### Woningrecord

```
{
  id: base36-timestamp + '-' + random5,
  status: 'open' | 'afgewerkt',
  gemaakt, gewijzigd: ISO-strings,
  algemeen: { adres, foto (hoofdfoto dataURL|null), datum (YYYY-MM-DD,
              default vandaag), notities },
  ruimtes: [ { naam, vent: 'geen'|'natuurlijk'|'mechanisch'|
               'mechanisch-permanent'|'ander', ventBeschrijving, opm,
               afm: {b,d,h} in meter | null } ],
  ramen: [ { nr, ruimte (naam), element: 'raam'|'deur'|'dakraam',
             gevel: 'voor'|'achter'|'links'|'rechts', b, h (meter),
             beglazing: 'enkel'|'dubbel'|'hr-dubbel'|'drievoudig'|'paneel',
             kader: 'pvc'|'alu'|'hout', rolluik (bool), aantal (>=1),
             foto (dataURL|null) } ],
  energie: {
    opwekkers: [ { nr, type: 'gas'|'stookolie'|'andere' (centraal, ruimte='')
                   | 'airco'|'kachel'|'ruimte-andere' (ruimtegebonden),
                   ruimte, functie: ['radiatoren'|'vloer'|'sww'],
                   beschrijving, foto (kenplaat), fotoKraan } ],
    pvPanelen: [ { orientatie: 'plat'|'voor'|'achter'|'links'|'rechts'|'', wp } ],
    zonneboiler: 'nee'|'ja', zonneboilerM2: string },
  fotodossier: [ { nr, ruimte ('' = Gevels, '__algemeen' = Algemeen, of
                   ruimtenaam), foto } ],
  teller, tellerOpwek, tellerDossier: hoogste uitgereikte nrs
}
```

- Nieuwe woning start met ruimtes **Living, Keuken, Badkamer, WC, Slaapkamer 1**.
- `normaliseer()` (bij elke load) vult ontbrekende velden met defaults,
  valideert enums, herstelt tellers/ontbrekende nrs en groepeert de ruimtes.
  **Geen legacy-migraties** — pas toevoegen als een modelwijziging échte data
  in omloop raakt.
- Bouwjaar, gebouwtype, kelder, zolder worden **bewust niet** ingevoerd:
  dat komt uit documenten of staat op de foto's.

---

## 6. UI-bouwstenen (overal hergebruikt)

- **Roterende knop** (`cycleInit`): volle-breedte knop met label links, vette
  waarde rechts, draai-icoon ⟳; elke tik = volgende optie (cyclisch); lege
  waarde toont gedimde "—". Mini-variant (`.cycle.mini`): drie naast elkaar,
  label boven waarde, icoontje in de hoek.
- **Segmented rij** (`segInit`): directe keuze-knoppen naast elkaar; alleen
  voor element (Raam/Deur/Dakraam) en gevel (Voor/Achter/Links/Rechts) omdat
  je die bij elk raam wisselt.
- **Chips** (`chipsInit`): meerkeuze (alleen de verwarmingsfuncties).
- **Accordeonsecties** (`<details class="sectie">`): kaart met samenvattings-
  balk (▸ die meedraait); per tab is er **maximaal één open** — openen sluit
  de broertjes (toggle-listener).
- **Lijstitems**: kaartjes met 1–3 tekstregels, mini-thumb (40px, tik =
  lightbox), ×-verwijderknop; **tik op de rij = bewerken** (formulier vult
  zich, knop wordt "Bewaar wijziging", annuleerknop verschijnt, rij krijgt
  groene rand `bewerk`, de ruimtebalk springt mee naar de ruimte van het item).
- **Toast**: zwart meldingsblokje onderaan, 1,8 s.
- **Lightbox**: elke `img.thumb` opent fullscreen op tik; tik sluit.
- Verwijder-knoppen bij foto-thumbs: ronde rode `thumbdel`-knop.

---

## 7. Schermen

### 7.1 Woningenlijst (startscherm)

- Titelbalk "EPC Plaatsbezoek". Lijst gesorteerd op **laatst gewijzigd eerst**;
  per rij: hoofdfoto-thumb (indien aanwezig), adres ("Zonder adres"),
  datum, statusknop **Open/Af** (pill; toggle, bewaart meteen) en × (confirm).
  Leeg: gestippelde placeholder "Nog geen woningen...".
- "+ Nieuwe woning" maakt en opent direct een nieuw record.
- Onderaan (naar de schermvoet geduwd via flex + `margin-top:auto`): subtiel
  gecentreerd grijs **"Info"** (details zonder marker/icoon) met daarin:
  hoe alles bewaard wordt, de werkwijze, de waarschuwing (app nooit
  verwijderen zolang er woningen in staan), de cameratip
  (Instellingen ▸ Apps ▸ Safari ▸ Camera → "Vraag"/"Sta toe") en de
  **versieregel** ("Versie vNN" + knop "Zoek update").

### 7.2 Header (editor)

- Groene sticky balk: terugpijl **‹** (alleen het pijltje), titel = adres
  (ellipsis), compacte savestamp in twee regels.
- Op de tabs **Details** en **Foto's**: de **ruimtebalk** — één horizontaal
  scrollbare chip-rij (witte outline-chips, actieve = wit gevuld).
  - Op Details: alleen echte ruimtes + "+ Ruimte". Er is **altijd** een ruimte
    geselecteerd (bij binnenkomen automatisch de eerste).
  - Op Foto's (en in het camerascherm): vooraan twee extra chips die geen
    ruimte zijn: **"Algemeen"** (facturen/documenten; interne waarde
    `'__algemeen'` — nooit tonen) en **"Gevels"** (waarde `''`).
  - **"+ Ruimte"** klapt een keuzepaneel open met sneltoetsen: Slaapkamer,
    Badkamer, WC, Berging, Bureau, Garage, Zolder, Kelder, Veranda,
    "Andere naam…" (prompt). Bestaande naam → **autonummering** ("Slaapkamer"
    → "Slaapkamer 2"). Nieuwe ruimte wordt geselecteerd en de
    **Ventilatie-sectie klapt open**.
  - Ruimtes worden altijd **gegroepeerd op basisnaam** (naam zonder eindcijfer),
    volgorde van eerste voorkomen; binnen een groep numeriek gesorteerd —
    alle slaapkamers staan dus bij elkaar. **Ruimtes verwijderen bestaat niet.**
  - De actieve chip scrollt zichzelf in beeld (`scrollIntoView`).
- De geselecteerde ruimte is het label voor alles wat je daarna toevoegt.

### 7.3 Tab Algemeen — vier accordeonsecties, alleen **Woning** start open

1. **Woning**: adres + 📍-locatieknop (geolocation → Nominatim reverse
   geocoding `accept-language=nl&zoom=18`, straat+nr en gemeente; offline of
   mislukt → coördinaten "lat, lon"; enige externe call van de app);
   datum plaatsbezoek (date-input, default vandaag).
2. **Verwarming** (centraal, `ruimte:''`): cycle Gas/Stookolie/Andere;
   functie-chips Radiatoren/Vloerverwarming/Sanitair warm water (meerdere);
   beschrijving; 📷 Foto kenplaat; 📷 Foto radiatorkranen (rij alleen
   zichtbaar als "radiatoren" aangevinkt; bij bewaren wordt fotoKraan genuld
   als radiatoren niet gekozen is); "Voeg verwarming toe" + lijst (nieuwste
   eerst, tik = bewerken, × = confirm-delete).
3. **Extra installaties**: **Zonnepanelen** — cycle oriëntatie (Plat dak/Voor/
   Achter/Links/Rechts) + Wp-invulveld + ronde "+"-knop; lijstje met ×
   (confirm; geen bewerken — verwijderen en opnieuw). **Zonneboiler** — cycle
   Nee/Ja (default Nee); bij Ja verschijnt veld "Oppervlakte zonnecollector (m²)".
4. **Opmerkingen**: vrije notities (textarea).

### 7.4 Tab Details — per geselecteerde ruimte; drie accordeonsecties

Volgorde: **Ventilatie (start open) → Verwarming in deze ruimte → Ramen & deuren.**

- **Ventilatie**: cycle `geen → natuurlijk → mechanisch → mechanisch permanent
  → ander`; bij "ander" verschijnt een beschrijvingsveld onder de knop
  (met focus), geen popup. Waarde hoort bij de ruimte.
- **Verwarming in deze ruimte**: cycle Airco/Kachel/Andere (`'ruimte-andere'`);
  **Afmetingen ruimte (m)** breed × diep × hoog met live m³ — opgeslagen op de
  ruimte zelf (één keer per ruimte, hoeveel toestellen er ook hangen; leeg
  veld = afm null); beschrijving; 📷 Foto kenplaat; "Voeg toestel toe".
  De lijst toont **alleen de toestellen van de geselecteerde ruimte**
  (met volume uit de ruimte-afm); tik = bewerken (springt mee van ruimte).
- **Ramen & deuren** — compact genoeg om op een iPhone te typen zonder
  scrollen: element-rij en gevel-rij **zonder label**; afmetingenrij
  b × h (placeholders "breedte (m)"/"hoogte (m)") met live m²; regel
  "Aantal identieke" met inline −/1/+ stepper (minimum 1); daarna **drie
  mini-cycles naast elkaar**: Beglazing (Enkel/Dubbel/HR dubbel/Drievoudig/
  Vol paneel), Kader (PVC/Alu/Hout), Rolluik (Nee/Ja); fotoknop
  **"📷 Foto afstandhouder"** die bij element=dakraam automatisch
  **"📷 Foto kenplaatje"** heet; "Voeg toe".
  - Na toevoegen onthoudt het formulier de keuzes; alleen afmetingen, aantal
    en foto worden leeggemaakt (er is bewust géén "zelfde als vorige"-knop).
  - Zonder geldige b én h: toast "Vul breedte en hoogte in (m)".
  - **Lijst + PDF gesorteerd**: eerst alle deuren, dan de rest; telkens op
    gevel voor→achter→links→rechts, dan op nr. Rij toont "#nr Element ·
    Gevel · n×", "b × h m = x m² (totaal)", tags (ruimte · beglazing · kader ·
    rolluik). Totaalregel: aantal elementen (aantallen meegeteld) + totale m².
- Onderaan de tab (buiten de secties): **"Opmerking bij deze ruimte"**
  (vrij tekstveld op de ruimte, bv. "recht achterboven in de hoek").

### 7.5 Tab Foto's (fotodossier)

- Twee knoppen: **"📷 Start camera"** en **"🖼 Kies foto's"** (bestandkiezer
  met `multiple`, elk bestand door de verklein-pijplijn).
- Daaronder een dichtgeklapt infoblok **"📋 Welke foto's zijn minimaal
  vereist? (inspectieprotocol)"**: gevels (elke veilig bereikbare),
  schildelen per hoofdtype, isolatie (type/dikte herkenbaar), beglazing/kaders
  (opschriften leesbaar), verwarming (kenplaat/label/thermostaat/afgifte/
  buitenvoeler), sanitair warm water, koeling, ventilatie, zonne-energie met
  oriëntatie — telkens detail- én overzichtsfoto's; bron VEKA, 10 jaar bewaren.
- **Raster toont alleen de foto's van de geselecteerde chip**; totaalregel
  "N foto's in <label> · M in totaal". Per tegel: **⇄** verplaats naar andere
  ruimte (bottom-sheet met chips Algemeen/Gevels/ruimtes; huidige gemarkeerd),
  **×** verwijderen (confirm), en **alléén op Gevels-foto's een ★**:
  wit = kiesbaar, geel = huidige hoofdfoto; tik + confirm zet
  `algemeen.foto` (foto blijft ook in het dossier). Tik op de foto = lightbox.

### 7.6 Camerascherm (in-app, fullscreen overlay)

- `getUserMedia` achtercamera, ideal 2560×1920; `<video playsinline autoplay muted>`.
- **Dossier-modus** (via "Start camera"): bovenaan de ruimtechips (wisselen
  zonder sluiten), rechtsboven een **flitsknop 🔦 alleen als het toestel
  torch via `getCapabilities()` ondersteunt** (toggle via
  `applyConstraints({advanced:[{torch}]})`; geel als aan); onderaan teller
  ("N foto's"), grote witte sluiterknop, "Klaar". Elke sluitertik: frame →
  JPEG → dossier van de geselecteerde chip.
- **Enkel-modus** (via de losse fotoknoppen: kenplaat, kranen, afstandhouder,
  toestel): geen chips, knop heet "Annuleer"; één sluitertik → foto op zijn
  plek en camera meteen dicht.
- **Fallbacks zonder cameratoegang**: enkel-modus → verborgen
  `<input type="file" accept="image/*" capture="environment">`; dossier-modus
  → toast met foutnaam + instellingentip en de bibliotheekkiezer opent.
- Camera stopt netjes (tracks stoppen) bij "Klaar"/"Annuleer", bij
  visibilitychange (met save) en pagehide.

### 7.7 Tab Afronden

- **Controlelijstje** (informatief, nooit blokkerend; vers berekend bij het
  openen van de tab): ✅/❌ voor (1) elke ruimte minstens één foto — bij rood
  de namen van de ruimtes zonder, (2) verwarming ingevuld (≥1 opwekker of
  toestel), (3) hoofdfoto gekozen (ster op een gevelfoto).
- **"💾 Bewaar PDF"**, "Woning sluiten", "Woning verwijderen" (rood, confirm).

---

## 8. Foto-pijplijn en resoluties

Alle foto's worden via canvas verkleind naar JPEG-dataURLs (opslag in het
woningrecord zelf). Scherp mag, zolang de bestanden klein blijven:

| Soort | max langste zijde | JPEG-kwaliteit |
|---|---|---|
| Detailfoto's (afstandhouder, kenplaat, kranen) | 1200 px | 0,7 |
| Dossierfoto's (ruimtes, gevels) | 2000 px | 0,7 |
| **Algemeen-foto's (facturen/documenten)** | **2600 px** | **0,75** |

De hoofdfoto is een dossierfoto (gekozen via ★).

---

## 9. Het PDF-bestand (`pdf.js`)

**De app schrijft zelf een volledig PDF-document** — geen print-dialoog, geen
Safari-omweg, geen library.

### Generator (technisch)

- PDF 1.4; objecten + xref-tabel met correcte byte-offsets; alles latin-1.
- Tekst: base-14 fonts **Helvetica** (F1) en **Helvetica-Bold** (F2) met
  **WinAnsiEncoding**; tekens >255 → "?", met mappings ’→', –→0x96, €→0x80;
  `(`, `)`, `\` ge-escaped. Tekstbreedte/afbreking gemeten via een canvas-
  context met hetzelfde font (woordgrenzen-wrap).
- Foto's: JPEG-bytes rechtstreeks als Image-XObject met **DCTDecode**
  (DeviceRGB/8bit); **identieke dataURLs worden gededupliceerd** (één object,
  meermaals getekend). Natuurlijke afmetingen via een `Image`-load.
- Pagina's: A4 staand 595,28×841,89 pt of liggend (omgewisseld); marge 40 pt;
  cursor loopt van boven naar onder (y wordt omgerekend naar PDF-coördinaten);
  automatische paginabreuk zodra inhoud niet meer past.

### Indeling

1. **Kop**: klein grijs "EPC Plaatsbezoek", adres (vet, 15pt, gewrapt),
   "Datum plaatsbezoek: ..."; hoofdfoto rechtsboven (130 pt breed, max 100 pt).
2. **RAMEN & DEUREN** (sectiekop: hoofdletters + lijn): tabel
   #, Type, Ruimte, Gevel, Aant., B (m), H (m), m² (aantal meegerekend),
   Beglazing, Kader, Rolluik — 7,5 pt, celranden, tekstwrap per cel,
   getallen rechts uitgelijnd; totaalregel vet. Daaronder de raamfoto's:
   **4 per rij**, cel 82 pt hoog, contain + gecentreerd, grijs bijschrift
   6,5 pt "Element gevel – ruimte, afstandhouder/kenplaatje" (zonder nummers).
3. **ENERGIE**: tabel #, Opwekker, Ruimte, Doet, Beschrijving (bij
   airco/kachel met "ruimte b × d × h m = x m³"); daaronder kenplaat-/kranen-
   foto's (zelfde raster, bijschrift "Type – ruimte, kenplaat/radiatorkranen");
   dan regel **Zonnepanelen** ("Plat dak 4200 Wp - Voor 2000 Wp" of "-") en
   — alleen bij ja — **Zonneboiler** ("ja, 4,6 m2").
4. **VENTILATIE**: tabel Ruimte, Ventilatie (+"(beschrijving)" bij ander),
   Afmetingen, Opmerking — natte ruimtes (keuken/badkamer/wc) eerst, rest
   alfabetisch-numeriek.
5. **NOTITIES** (alleen indien ingevuld), gewone alinea's.
6. **FOTODOSSIER** vanaf een nieuwe pagina: koptekst + "adres - plaatsbezoek
   datum - N foto's". Per groep een titel in hoofdletters; volgorde **Gevels,
   dan de ruimtes (ruimtevolgorde), Algemeen laatst**. Gewone groepen:
   raster **4 per rij**, cel 95 pt, geen bijschriften; een groepstitel komt
   nooit alleen onderaan (titel + eerste rij verhuizen samen).
   **Algemeen (facturen): eigen liggende pagina's, 2 foto's per pagina,
   paginavullend** (contain).
7. **Voetregel op elke pagina**: "adres - pagina X/Y", 7 pt grijs, gecentreerd.

### Bewaren

Knop "Bewaar PDF": toast "PDF maken…" → `bouwPdf(S)` → `File`
**`<slug(adres)>.pdf`** (fallback `epc.pdf`) → `navigator.share({files})`
(iPhone: deelmenu → Bewaar in Bestanden; AbortError = stil annuleren) →
zonder share-ondersteuning: download via tijdelijke `<a download>`.
Fout → toast "PDF maken mislukt (naam)".

---

## 10. Bewuste keuzes en iOS-realiteit

- Geen bouwjaar/gebouwtype/kelder/zolder-invoer (documenten/foto's).
- Geen backup/export/import; geen ruimtes verwijderen; geen bewerken van
  PV-installaties (verwijderen + opnieuw toevoegen).
- Torch werkt in iOS-Safari meestal niet → knop verschijnt alleen bij echte
  ondersteuning; donkere ruimtes: "Kies foto's" → native camera mét flits.
- Camerapermissie kan door iOS geweigerd blijven → fallbacks + tip in Info.
- `screen.orientation.lock` faalt stil waar niet ondersteund.
- Externe netwerktoegang: uitsluitend Nominatim bij de locatieknop.

---

## 11. Testen

- **Playwright** headless in de meegeleverde Chromium
  (`/opt/pw-browsers/chromium-*/chrome-linux/chrome`), iPhone-viewport
  (~393×852), camera met
  `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`
  (+ context-permissie `camera`).
- Dek per wijziging: volledige klikflows (woning → ruimtes → ramen/toestellen/
  foto's → afronden), persistentie na `page.reload()`, en de accordeon/
  ruimtebalk-interacties. Let op: na `page.fill` op een input is de tabbalk
  verborgen (toetsenbord-gedrag) — eerst blurren.
- **PDF valideren met pypdf** (Python): paginaformaten (staand + liggend),
  tekstextractie (adres, tabelwaarden, groepstitels, paginanummers) en
  JPEG-integriteit/decodeerbaarheid van de ingebedde beelden.
- `node --check` op `app.js`, `pdf.js`, `sw.js` vóór elke commit.

---

## 12. Release-procedure

1. Wijziging eerst in deze spec (of dezelfde commit).
2. `node --check` + Playwright-flows + pypdf-validatie groen.
3. `sw.js` CACHE én `app.js` APP_VERSIE samen bumpen naar `epc-vN+1`.
4. Commit in het Nederlands, push naar `main`.
5. Wachten op de Pages-deploy en verifiëren dat de live `sw.js` de nieuwe
   versie toont; in de app: Info ▸ "Zoek update".
