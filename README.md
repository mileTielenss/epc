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
- **Ramen**: snelle invoer per element met gevelkompas, afmetingen in cm (komma-decimalen), beglazing, kader, rolluik en foto van de afstandhouder. Knop "Zelfde als vorige" herhaalt de laatste invoer met nieuwe afmetingen.
- **Energie**: opwekkers toevoegen (gas, stookolie, airco, andere) met wat ze doen (radiatoren, vloerverwarming, sanitair warm water), beschrijving en kenplaatfoto. Bij airco ook kamerafmetingen in cm voor het volume. Daarnaast PV.
- **Ventilatie**: kies geen/natuurlijk/mechanisch en tik daarna de ruimtes aan; tik op een ruimte in de lijst om te wisselen.
- **Afronden**: one-pager naar PDF via print, woning sluiten of verwijderen.

## Data en backups

Elke woning is een eigen record in IndexedDB, elke 3 seconden en bij het verlaten van de pagina bewaard. Foto's worden verkleind tot max 900px JPEG kwaliteit 0.7. De JSON is leesbaar en bevat alles, ook de foto's (base64).

Manieren om data uit de app te halen:

1. **Backupmap (desktop Chrome/Edge)**: kies één keer een map via "Kies backupmap". Daarna schrijft elke save automatisch een leesbare structuur per woning: `<adres>-<id>/woning.json` plus `fotos/raam-1.jpg` enz. Incrementeel, dus ook met honderden woningen snel. "Bewaar alles" schrijft alles opnieuw, "Zet alles terug" leest de hele map terug in de app.
2. **Bewaar alles in Bestanden (iPhone)**: één zip met een leesbare `woningen.json` en een `fotos/`-map met echte jpg's per woning, via het deelmenu naar de Files-app. Doe dit regelmatig, want iOS laat de browser niet stil naar bestanden schrijven. Het startscherm toont de laatste exportdatum.

Importeren kan met "Importeer backup" (meerdere bestanden tegelijk, zip of json); ook oude formaten (één woning of alles-json) worden herkend. Bestaande woningen met dezelfde id worden overschreven. De zip mag uitgepakt en opnieuw ingepakt zijn (deflate wordt gelezen), zolang `woningen.json` en de fotopaden kloppen.

## Iconen opnieuw genereren

```
node tools/make-icons.js
```
