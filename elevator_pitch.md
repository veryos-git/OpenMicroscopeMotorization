 
Ich hoffe, ihr konntet die Sommerferien geniessen und seid gut in den August gestartet. 
 
Nun steht der Start eurer Diplomarbeiten an. Dafür brauchen die Prüfungskommission und die Schwerpunktverantwortlichen einen ersten Überblick über euer Projekt. Anders als ursprünglich geplant gibt es keine Elevator-Pitch-Meetings, sondern einen Screencast mit zwei weiteren Abgaben. Insgesamt sind es also drei Dinge, nämlich eine kurze Präsentation, ein Screencast dazu und ein einseitiges Dokument mit den wichtigsten Punkten eures Projekts.
 
Erstellt also zuerst eine kurze Präsentation, z.B. in PowerPoint, mit folgenden Punkten.
Ausgangslage, grafisch aufgezeigt (ca. 1 Min.)
Problem und Bedürfnis als IST und SOLL (ca. 1 Min.)
Ziel eures Projekts und die drei bis vier technischen Schritte, die dafür nötig sind (ca. 1.5 Min.)
Komplexität eurer Aufgabe und euer weiteres Vorgehen (ca. 1.5 Min.)
Diese Präsentation sprecht ihr selbst ein und zeichnet sie als Screencast auf. Denkt daran, dass das Zielpublikum euer Projekt nicht kennt. Ziel ist, dass es euer Projekt versteht und einordnen kann. Nach dem Anschauen muss klar sein, worum es geht, welches Problem ihr löst und warum die Aufgabe anspruchsvoll ist. Ergänzend fasst ihr das Ganze auf einer A4-Seite schriftlich zusammen.
 
Beim Format gilt Folgendes.
Elevator-Pitch, maximal 5 Minuten!!!
Schriftdeutsch
Eigene Stimme, keine KI-Stimme und kein Text-Overlay statt Sprache
Folien durchgehend im Video sichtbar
Abgegeben wird in der Teams-Aufgabe, die ich gleich im Anschluss hier erstelle.
Die Präsentation als PDF
Der Screencast als Video, bei zu grosser Datei stattdessen ein OneDrive-Link
Die Zusammenfassung als PDF, maximal eine Seite
Deadline ist Sonntag, der 16.08.2026, 23.59 Uhr. Danach schauen sich die Kommission und die Schwerpunktverantwortlichen die Screencasts an und stellen euch allenfalls Rückfragen. Über die weiteren Schritte informiere ich euch Anfang KW34.
 
Bei Fragen dürft ihr euch gerne bei mir melden.


---
notizen 

ausganslage, ich habe mikroskop mit hardware das den objektträger auf x y und z bewegen kann, dies kann ich via software kontrollieren. 

es gibt mächtige object detection ki modelle wie yolo die ge fine tuned werden können aber dafür benötigt man viele trainingsdaten


problem : man benötigt testdaten
ist: es gibt labeling software bei jenen muss man jedoch jedes bild einzeln durchgehen und labeln
ausserdem kann man kein echtzeitbild vom mikroskop durchgehen und muss zuerst ein mikroskop video erstellen das dann zu bilder konvertieren und die bilder einzeln durchgehen. 
soll: eine software die in echtzeit das mikroskop bild zeigt und mit der man einfach die testdaten - labeling erstellen kann. 

3 technische schritte
hardware haben , bereits vorhanden , 3d printed xzy teile + stepper motoren + esp32 + usb webcam

software bauen, esp32 flashen so dass es gesteuert werden kann via websocket
client js html als software gui frontend , backend mit denojs und benötigten executables (python etc. )
eine art von datenspeicher (sql + image / vdieo files)

ausblick : testdaten verwenden um ki zu trainineren , diese dann in der software anwenden (zb in echtzeit objekte verfolgen zb baertierchen, oder eine 'map' vom objektträger bauen (imagestitching + object detection) und merken wo gewisse objekte sind dass man auf dem ganzen gescannten objektträger navigieren kann)

komplexität : hoch , viele verschiedene programmiersprachen , grafik kentnisse nötig, 3d gedruckte und mikroelektronik hardware involviert


