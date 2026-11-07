# Stick App

Verwandelt Fotos in **Kreuzstich-Vorlagen** mit echten **DMC-Garnen**. Läuft als installierbare Web-App (PWA) auf Android und iPhone, auch offline.

## Funktionen

- Foto aus der Galerie oder direkt von der Kamera, Ausschnitt per Finger wählen
- Breite (20–250 Stiche), Anzahl Farben (2–40), Stoff (Aida 11/14/16/18 ct) mit Live-Vorschau und fertiger Größe in cm
- Automatische Farbwahl: k-means im CIELAB-Farbraum, Abbildung auf 454 DMC-Garne per CIEDE2000
- Optional: Hintergrund weglassen, Einzelstiche entfernen, Farbverläufe mischen (Dithering)
- Vorlage mit Zoom (Pinch/Mausrad), Ansichten Farbe / Symbole / beides, 10er-Gitter, Lineal, Mittelmarkierung
- Farben bearbeiten: ersetzen (Suche nach Nummer/Name, ähnlichste zuerst), zusammenführen, entfernen, „nicht sticken“, Garn hinzufügen
- Stift und Radierer für einzelne Stiche, Rückgängig/Wiederholen
- Export: PDF (Deckblatt, Garnliste mit Strangbedarf, A4-Musterseiten, farbig oder schwarzweiß) und PNG; am Handy über „Teilen“
- Speicherung auf dem Gerät (offline) und optional in **Supabase** (Abgleich zwischen Geräten, Anmeldung mit E-Mail + Passwort)

## Ordner

| Pfad | Inhalt |
|---|---|
| `index.html`, `css/app.css` | Oberfläche |
| `js/app.js` | Steuerung (Bildschirme, Bearbeiten, Speichern, Export, Konto) |
| `js/color.js`, `js/threads.js` | Farbmathematik (Lab, CIEDE2000), DMC-Garne, Strangbedarf |
| `js/quantize.js`, `js/pattern.js`, `js/worker.js` | Berechnung des Musters (im Hintergrund-Thread) |
| `js/render.js`, `js/crop.js`, `js/palette-editor.js` | Musteransicht, Ausschnitt, Garnliste/-dialog |
| `js/storage.js`, `js/sync.js`, `js/config.js` | Lokale Datenbank, Supabase-Abgleich, Zugangsdaten |
| `js/export.js` | PDF/PNG |
| `data/dmc.js` | DMC-Farbtabelle (erzeugt mit `tools/build-dmc.ps1`) |
| `vendor/` | jsPDF 2.5.2, supabase-js 2.45.4 (lokal, damit alles offline geht) |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA (Offline, Installation, Icons) |
| `supabase/schema.sql` | Datenbank-Einrichtung für Supabase |
| `tests/test.html` | Unit-Tests (im Browser öffnen) |
| `tools/` | Lokaler Server, Icon- und DMC-Generator |

## Lokal starten (am PC)

```bash
powershell -ExecutionPolicy Bypass -File tools/serve.ps1
```

Dann im Browser `http://localhost:8080` öffnen. Tests: `http://localhost:8080/tests/test.html`.
Mit `http://localhost:8080/?nosw` startet die App ohne Service Worker (praktisch beim Entwickeln).

## Supabase einrichten (Cloud-Speicher)

Die Stick App kann in einem **bestehenden** Supabase-Projekt mitlaufen (z. B. wenn im Free-Plan schon zwei Projekte aktiv sind).
Alle ihre Namen beginnen mit `stick_` bzw. `stick-`, bestehende Tabellen werden nicht angefasst. Die Login-Einstellungen
des Projekts (Registrierung an/aus usw.) müssen **nicht** geändert werden: Zugriff hat nur, wer auf der Gästeliste steht.

1. **Datenbank anlegen:** Supabase-Dashboard → *SQL Editor* → Inhalt von `supabase/schema.sql` einfügen → *Run*.
   Das legt an: Tabelle `stick_projects`, privaten Bucket `stick-images`, Gästeliste `stick_allowed_users` und die Zugriffsregeln.
   Jede Person sieht nur ihre eigenen Muster.
Anmeldung in der App: **E-Mail + Passwort**. Es werden keine Mails verschickt (die Mail-Vorlagen sind bei neuen Free-Projekten ohnehin gesperrt).

2. **Person anlegen:** *Authentication → Users → Add user → Create new user*: E-Mail und Passwort eintragen, **Auto Confirm User** anhaken.
3. **Person freischalten (Gästeliste):** im SQL Editor (E-Mail klein schreiben):
   ```sql
   insert into public.stick_allowed_users (email, note) values ('deine@email.de', 'ich');
   ```
   Beides ist nötig: ein Login-Konto (Schritt 2) **und** der Eintrag auf der Gästeliste. Entfernen: `delete from public.stick_allowed_users where email = '…';`
4. **Zugangsdaten eintragen:** *Project Settings → API* (bzw. *API Keys*) → **Project URL** und den **anon/publishable key** in `js/config.js` eintragen.
   Den `service_role`/secret Key **niemals** in die App schreiben.
5. **Passwort vergessen:** Angemeldete Personen können ihr Passwort im Konto-Dialog selbst ändern. Ist es vergessen, setzt du es im SQL Editor neu:
   ```sql
   update auth.users set encrypted_password = extensions.crypt('NeuesPasswort123', extensions.gen_salt('bf'))
   where email = 'person@email.de';
   ```
6. Hinweis Free-Plan: Projekte werden nach einer Woche ohne Aktivität pausiert. Die App funktioniert dann weiter lokal; nach *Restore* im Dashboard wird wieder abgeglichen.

Ohne Einträge in `js/config.js` funktioniert die App komplett lokal, der Anmelde-Knopf ist dann ausgeblendet.

## Veröffentlichen und aufs Handy installieren

Damit sich die App installieren lässt, muss sie über **HTTPS** erreichbar sein. Zwei einfache Wege:

- **Netlify Drop:** <https://app.netlify.com/drop> öffnen und den ganzen Projektordner hineinziehen. Danach bekommst du eine `https://…netlify.app`-Adresse.
- **GitHub Pages:** Ordner in ein GitHub-Repository hochladen → *Settings → Pages → Deploy from branch*.

Nach jeder neuen Version in `sw.js` die Zeile `VERSION = 'stickapp-v1'` hochzählen (z. B. `v2`), damit die Handys die neuen Dateien laden.

**Installieren:**
- **Android (Chrome):** Adresse öffnen → Menü ⋮ → *App installieren* bzw. *Zum Startbildschirm hinzufügen*.
- **iPhone (Safari):** Adresse öffnen → Teilen-Symbol → *Zum Home-Bildschirm*.

## Hinweise

- DMC-Farbwerte stammen aus einem öffentlichen Datensatz ([adrianj/CrossStitchCreator](https://github.com/adrianj/CrossStitchCreator)) mit den Korrekturen aus [sharlagelfand/dmc](https://github.com/sharlagelfand/dmc). Bildschirmfarben sind immer nur ungefähr.
- Strangbedarf: Schätzung mit ca. 1800 ganzen Kreuzstichen pro 8-m-Strang bei 14 ct und 2 Fäden.
- Zahl der Farben: Liegen zwei berechnete Farben beim selben DMC-Garn, werden sie zusammengelegt. Deshalb kann das Muster etwas weniger Farben haben als eingestellt.
