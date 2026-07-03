# EPC Plaatsbezoek

Mobile-first offline PWA voor EPC plaatsbezoeken. Eén pagina, vanilla HTML/CSS/JS, geen dependencies.

## Gebruik op iPhone

1. Host de map op een https-server (bv. GitHub Pages) of open lokaal via `python -m http.server`.
2. Open de URL in Safari.
3. Deel-knop, "Zet op beginscherm". De app werkt daarna volledig offline.

## Tabs

- **Algemeen**: adres, datum, gebouwtype, bouwjaar, notities.
- **Ramen**: snelle invoer per element met gevelkompas, afmetingen (komma-decimalen, lasermeter), beglazing, kader, rolluik en foto van de afstandhouder. Knop "Zelfde als vorige" herhaalt de laatste invoer met nieuwe afmetingen.
- **Energie**: opwekking (multi-select, met detailpanelen voor ketel, warmtepomp en airco-binnenunits), afgifte, sanitair warm water, PV.
- **Ventilatie**: systeem (geen/A/B/C/D) en per ruimte de voorziening.
- **Export**: samenvatting, one-pager naar PDF via print, JSON export/import (inclusief foto's).

## Data

Alles zit in één state-object, elke 3 seconden en bij het verlaten van de pagina bewaard in localStorage. Foto's worden verkleind tot max 900px JPEG kwaliteit 0.7. "Nieuwe woning starten" wist alles; exporteer eerst de JSON als je de opname wil bijhouden.

## Iconen opnieuw genereren

```
node tools/make-icons.js
```
