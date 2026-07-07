# EPC Plaatsbezoek

Mobile-first offline PWA voor EPC plaatsbezoeken. Eén pagina, vanilla HTML/CSS/JS, geen dependencies.

## Gebruik op iPhone

1. Host de map op een https-server (bv. GitHub Pages) of open lokaal via `python -m http.server`.
2. Open de URL in Safari.
3. Deel-knop, "Zet op beginscherm". De app werkt daarna volledig offline.

## Woningen

Het startscherm toont alle woningen. Tik op een woning om ze te openen, op de statusknop om ze op Af of Open te zetten, op de kruisknop om ze te verwijderen. "Woning sluiten" of de terugknop bovenaan brengt je terug naar de lijst; alles is dan al bewaard.

## Opbouw

- **Ruimtebalk in de header** (op Details en Foto's, ook in het camerascherm): kies in welke ruimte je staat; alles wat je toevoegt krijgt die ruimte als label. "Buiten" is de standaard (gevelfoto's e.d.). Elke woning start met Living, Keuken, Badkamer, WC, Berging en Slaapkamer 1; "+ Ruimte" opent sneltoetsen met autonummering (Slaapkamer → Slaapkamer 2...), × verwijdert de gekozen ruimte (items verliezen enkel hun label). Per ruimte cycle je de ventilatie met één knop: geen → natuurlijk → mechanisch → ander (met eigen beschrijving).
- **Algemeen**: adres (met locatieknop: GPS plus OpenStreetMap, de enige externe call in de app), datum, gebouwtype, bouwjaar, kelder (geen/ja), zolder (geen/binnen BV/buiten BV), centrale verwarming (gas/stookolie/andere met functies, beschrijving, kenplaat- en kranenfoto), PV-panelen (Wp) en notities. De hoofdfoto van de woning kies je met de ster op een dossierfoto.
- **Details** (per gekozen ruimte): afmetingen van de ruimte in meter (één keer per ruimte, m³ live) en een opmerkingveld (bv. "recht achterboven in de hoek"). Daarna twee inklapbare secties: **Ramen & deuren** (element, gevel op één regel, afmetingen in meter met komma zoals de digitale meter, aantal identieke, beglazing, kader, rolluik, foto afstandhouder; "Zelfde als vorige"; tik op een rij om te wijzigen; deuren staan bovenaan, daarna alles op gevel voor/achter/links/rechts) en **Verwarming in deze ruimte** (airco of kachel, beschrijving, kenplaatfoto; meerdere toestellen per ruimte, afmetingen komen van de ruimte zelf).
- **Foto's**: fotodossier voor het projectdossier (10 jaar bewaarplicht). "Start camera" opent een eigen camerascherm dat open blijft: tik de sluiter zo vaak je wil, wissel bovenaan van ruimte, daarna "Klaar". Flitsknop verschijnt als het toestel torch via de browser toelaat (iOS meestal niet: gebruik daar "Kies foto's" met de native camera). Per foto: ★ = hoofdfoto, ⇄ = verplaats naar andere ruimte, × = verwijderen (met bevestiging). Het bijschrift in de PDF is de ruimte (of Buiten).
- **Afronden**: overzicht per ruimte (ventilatie, afmetingen, opmerking), one-pager naar PDF via print (bevat alle gegevens, ook de datum plaatsbezoek, en krijgt het adres als bestandsnaam), woning sluiten of verwijderen. In de op iOS geïnstalleerde app opent de one-pager in Safari, waar Delen → Afdrukken → Bewaar als PDF wel werkt.

## Data

Elke woning is een eigen record in IndexedDB, elke 3 seconden en bij het verlaten van de pagina bewaard, volledig lokaal op het toestel (persistente opslag wordt aangevraagd tegen eviction). De werkwijze is bewust simpel: gegevens verzamelen tijdens het plaatsbezoek, dagen later eventueel nog aanvullen, op het einde de PDF bewaren via Afronden, en daarna de woning verwijderen. Er is geen backup- of exportfunctie; de PDF is het blijvende dossier. Detailfoto's worden verkleind tot max 900px JPEG kwaliteit 0.7; de hoofdfoto en dossierfoto's tot max 1600px, zodat je ze op de pc via save-as als volwaardige gevelfoto kan hergebruiken.

Let op: de data verdwijnt als je de app van het beginscherm verwijdert of Safari-websitedata wist.

## Iconen opnieuw genereren

```
node tools/make-icons.js
```
