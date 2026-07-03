# EPC Plaatsbezoek

Mobile-first offline PWA voor EPC plaatsbezoeken. Eén pagina, vanilla HTML/CSS/JS, geen dependencies.

## Gebruik op iPhone

1. Host de map op een https-server (bv. GitHub Pages) of open lokaal via `python -m http.server`.
2. Open de URL in Safari.
3. Deel-knop, "Zet op beginscherm". De app werkt daarna volledig offline.

## Woningen

Het startscherm toont alle woningen. Tik op een woning om ze te openen, op de statusknop om ze op Af of Open te zetten, op de kruisknop om ze te verwijderen. "Woning sluiten" of de terugknop bovenaan brengt je terug naar de lijst; alles is dan al bewaard.

## Tabs

- **Algemeen**: adres, datum, gebouwtype, bouwjaar, notities.
- **Ramen**: snelle invoer per element met gevelkompas, afmetingen (komma-decimalen, lasermeter), beglazing, kader, rolluik en foto van de afstandhouder. Knop "Zelfde als vorige" herhaalt de laatste invoer met nieuwe afmetingen.
- **Energie**: opwekking (multi-select, met detailpanelen voor ketel, warmtepomp en airco-binnenunits), afgifte, sanitair warm water, PV.
- **Ventilatie**: systeem (geen/A/B/C/D) en per ruimte de voorziening.
- **Export**: samenvatting, one-pager naar PDF via print, JSON export van de woning, woning sluiten of verwijderen.

## Data en backups

Elke woning is een eigen record in IndexedDB, elke 3 seconden en bij het verlaten van de pagina bewaard. Foto's worden verkleind tot max 900px JPEG kwaliteit 0.7. De JSON is leesbaar en bevat alles, ook de foto's (base64).

Drie manieren om data uit de app te halen:

1. **Backupmap (desktop Chrome/Edge)**: kies één keer een map via "Kies backupmap" op het startscherm. Daarna schrijft elke save automatisch `epc-<adres>-<id>.json` per woning naar die map. Gaat de app ooit stuk, dan staan de bestanden er nog.
2. **Exporteer alle woningen**: één JSON-bestand met alles, werkt overal, ook op iPhone (komt in de Files app terecht). Doe dit regelmatig op iOS, want daar kan de browser niet stil naar bestanden schrijven.
3. **Exporteer deze woning**: één JSON per woning vanuit de Export-tab.

Importeren kan met beide formaten (één woning of alles-bestand); bestaande woningen met dezelfde id worden overschreven.

## Iconen opnieuw genereren

```
node tools/make-icons.js
```
