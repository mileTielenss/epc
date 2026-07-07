# EPC Plaatsbezoek

Mobile-first offline PWA voor EPC plaatsbezoeken. Eén pagina, vanilla HTML/CSS/JS, geen dependencies.

## Gebruik op iPhone

1. Host de map op een https-server (bv. GitHub Pages) of open lokaal via `python -m http.server`.
2. Open de URL in Safari.
3. Deel-knop, "Zet op beginscherm". De app werkt daarna volledig offline.

## Woningen

Het startscherm toont alle woningen. Tik op een woning om ze te openen, op de statusknop om ze op Af of Open te zetten, op de kruisknop om ze te verwijderen. "Woning sluiten" of de terugknop bovenaan brengt je terug naar de lijst; alles is dan al bewaard.

## Tabs

- **Algemeen**: adres (met locatieknop: GPS plus OpenStreetMap, de enige externe call in de app), hoofdfoto van de woning (komt op de one-pager en in de woningenlijst), datum, gebouwtype, bouwjaar, notities.
- **Ramen**: snelle invoer per element met gevelkompas, afmetingen in cm (komma-decimalen), aantal identieke ramen (stepper), beglazing, kader, rolluik en foto van de afstandhouder. Knop "Zelfde als vorige" herhaalt de laatste invoer met nieuwe afmetingen. Tik op een element in de lijst om het opnieuw te openen en te wijzigen. De lijst en de one-pager staan gesorteerd: eerst voor, dan achter, links en rechts.
- **Energie**: opwekkers toevoegen (gas, stookolie, airco, andere) met wat ze doen (radiatoren, vloerverwarming, sanitair warm water), beschrijving en kenplaatfoto. Bij airco ook kamerafmetingen in cm voor het volume. Daarnaast PV. Tik op een opwekker in de lijst om ze te wijzigen of uit te breiden.
- **Ventilatie**: kies geen/natuurlijk/mechanisch en tik daarna de ruimtes aan; tik op een ruimte in de lijst om te wisselen. "Andere ruimte" vraagt om een eigen naam. De lijst staat gesorteerd: eerst de natte ruimtes (keuken, badkamer, wc), daarna de rest alfabetisch (kamers met dezelfde naam blijven bij elkaar).
- **Afronden**: one-pager naar PDF via print (bevat alle gegevens, ook de datum plaatsbezoek, en krijgt het adres als bestandsnaam), woning sluiten of verwijderen. In de op iOS geïnstalleerde app opent de one-pager in Safari, waar Delen → Afdrukken → Bewaar als PDF wel werkt.

## Data en backups

Elke woning is een eigen record in IndexedDB, elke 3 seconden en bij het verlaten van de pagina bewaard. Detailfoto's worden verkleind tot max 900px JPEG kwaliteit 0.7; de hoofdfoto tot max 1600px kwaliteit 0.8, zodat je ze op de pc via save-as als volwaardige gevelfoto kan hergebruiken. De JSON is leesbaar en bevat alles, ook de foto's (base64).

Manieren om data uit de app te halen:

1. **Backupmap (desktop Chrome/Edge)**: kies één keer een map via "Kies backupmap". Daarna schrijft elke save automatisch een leesbare structuur per woning: `<adres>-<id>/woning.json` plus `fotos/raam-1.jpg` enz. Incrementeel, dus ook met honderden woningen snel. "Bewaar alles" schrijft alles opnieuw, "Zet alles terug" leest de hele map terug in de app.
2. **Bewaar alles in Bestanden (iPhone)**: één zip met een leesbare `woningen.json` en een `fotos/`-map met echte jpg's per woning, via het deelmenu naar de Files-app. Doe dit regelmatig, want iOS laat de browser niet stil naar bestanden schrijven. Het startscherm toont de laatste exportdatum.

Importeren kan met "Importeer backup" (meerdere bestanden tegelijk, zip of json); ook oude formaten (één woning of alles-json) worden herkend. Bestaande woningen met dezelfde id worden overschreven. De zip mag uitgepakt en opnieuw ingepakt zijn (deflate wordt gelezen), zolang `woningen.json` en de fotopaden kloppen.

## Iconen opnieuw genereren

```
node tools/make-icons.js
```
