ich moechte nun eine selbst entwickelte loesung fuer den 28byj48 stepper motor machen. ich moechte ein friction drive. welche materialien kann ich verwenden?

Designing a friction drive for a small geared stepper motor.

Ein Friction Drive passt gut zum 28BYJ-48, weil er langsam ist und wenig Drehmoment hat (ca. 30–35 mNm). Damit fällt die Materialwahl recht klar aus: Es braucht viel Haftung bei wenig Anpresskraft.

Grundprinzip: Antriebsrad weich, Gegenfläche hart. Weich auf weich walkt, verschleisst und rutscht unvorhersehbar. Hart auf hart braucht zu viel Anpresskraft für diesen kleinen Motor.

Antriebsrad (auf der Motorwelle)

Material	Haftung	Kommentar
O-Ring (NBR) auf gedruckter Nabe	gut	Günstigste und einfachste Lösung, Ring in eine Nut legen, austauschbar
Polyurethan (PU), Shore 70–90A	gut	Verschleissfest, wenig Walkverlust, bildet kaum Standplatten, ideal für Dauerbetrieb
Silikon (gegossen oder Schlauch)	sehr gut	Sehr griffig, aber weich und reisst leichter, kann Standplatten bilden
TPU gedruckt (z. B. 85–95A)	mittel	Direkt druckbar, Rad und Nabe aus einem Teil, griffiger mit Querrillen
Gummischlauch über Nabe gezogen	gut	Bastellösung, z. B. Ventil- oder Aquarienschlauch
Gerändeltes Messing oder Alu	mittel	Nur gegen eine weichere Gegenfläche, z. B. Holz oder Kunststoff, sonst hoher Verschleiss

Gegenfläche (Schiene oder Stange)

Material	Kommentar
Aluprofil oder Alu-Flachstab, matt	Sehr gut, leicht anschleifen (Körnung 240–400) erhöht den Grip
Stahlwelle (Silberstahl, Linearwelle)	Präzise, aber sehr glatt, Gummi greift weniger, besser leicht mattieren
Acrylglas	Gut, eben, gleichmässig
Holzleiste (Buche, Multiplex)	Überraschend gut griffig, aber feuchteempfindlich
PLA/PETG gedruckt	Funktioniert, Schichtlinien quer zur Laufrichtung vermeiden, sonst ruckelt es

Grobe Auslegung für den 28BYJ-48

Bei Raddurchmesser 20 mm ergeben sich ca. 3 N Vorschubkraft (theoretisch, ohne Verluste).
Nötige Anpresskraft ungefähr Vorschubkraft geteilt durch Reibwert, also bei Gummi auf Alu (µ ≈ 0,6–0,9) etwa 4–6 N.
Geschwindigkeit bei ca. 15 U/min: etwa 15 mm/s. Ein grösseres Rad ist schneller, schwächer.

Praxistipps

Anpresskraft federnd aufbringen (Druckfeder, Gummiband oder Blattfeder), nicht starr. Das gleicht Toleranzen aus.
Gegenüber eine Andruckrolle setzen (Kugellager, z. B. 623 oder 624), damit die Welle nicht seitlich belastet wird. Die Motorwelle des 28BYJ-48 ist dafür nicht gebaut.
Die Welle hat 5 mm mit zwei Abflachungen. Die Nabe passend als Doppel-D drucken, dann rutscht sie nicht.
Flächen sauber und fettfrei halten, schon ein Fingerabdruck reduziert die Haftung spürbar.
Bei Stillstand unter Vorspannung bilden weiche Räder Standplatten. PU ist da am unempfindlichsten.
Ein Friction Drive kann Schritte verlieren, wenn er rutscht. Ein Endschalter zum Referenzieren (Homing) lohnt sich, wenn die Position stimmen muss.

Meine Empfehlung als Start: ein NBR-O-Ring auf einer gedruckten Nabe, dazu eine angeschliffene Aluleiste und eine Kugellager-Andruckrolle mit Feder. Das ist billig, schnell gebaut und lässt sich leicht anpassen.

was wäre wenn ich für die gegenfläche schiene auch gummi verwende_

Untersuchung der Effekte von Gummi auf Gummi bei Reibung.

Das funktioniert grundsätzlich, bringt aber eher Nachteile als Vorteile.

Was besser wird

Sehr hohe Haftung, Reibwerte über 1 sind möglich, man braucht also wenig Anpresskraft.
Leise und dämpfend.
Gleicht Unebenheiten in der Schiene gut aus.

Was schlechter wird

Rollwiderstand: Beide Partner verformen sich, das kostet ständig Energie (Walkarbeit). Beim schwachen 28BYJ-48 frisst das einen spürbaren Teil des Drehmoments.
Ungenauigkeit: Die Kontaktzone wird breit und unbestimmt, der wirksame Radius schwankt. Der Weg pro Umdrehung ist dann nicht mehr konstant, die Position driftet.
Stick-Slip: Gummi auf Gummi neigt zum Ruckeln, besonders bei langsamen Bewegungen, und der 28BYJ-48 ist langsam.
Verschleiss und Abrieb: Beide Flächen verschleissen, es entstehen Krümel und klebrige Stellen.
Kleben: Manche Gummimischungen haften im Stillstand regelrecht aneinander, vor allem Silikon auf Silikon.

Die interessantere Variante: umgekehrt
Es muss nur ein Partner weich sein, und das darf auch die Schiene sein:

Hartes Rad + Gummi auf der Schiene, z. B. ein gerändeltes oder sandgestrahltes Alu- oder Messingrad auf einem aufgeklebten Gummi- oder PU-Streifen.
Vorteil: Der Raddurchmesser bleibt exakt, also wird der Weg pro Schritt genauer. Der Verschleiss verteilt sich auf die ganze Schienenlänge statt auf den kleinen Radumfang.
Nachteil: Der Streifen muss vollflächig und spannungsfrei verklebt sein, sonst dehnt er sich und wandert. Gut geeignet sind selbstklebende Gummi- oder PU-Bänder auf einem Aluprofil.

Fazit: Gummi auf Gummi nur, wenn es auf Präzision nicht ankommt und die Last sehr klein ist. Sonst lieber eine Seite hart lassen, und wenn du Gummi auf der Schiene willst, dann mit einem harten, aufgerauten Antriebsrad.

Figuring out the right bearing preload setting.

Dann ist NBR auf Alu mehr als ausreichend, da musst du dir keine Sorgen machen.

Bei fast keiner Last musst du nur die Reibung der eigenen Führung überwinden, also des Schlittens auf seiner Schiene, plus ein bisschen Beschleunigung. Das sind eher Bruchteile eines Newtons.

Das heisst für dich:

Anpresskraft eher klein halten, etwa 1–2 N reichen vermutlich. Lieber leicht anfangen und erst erhöhen, wenn es rutscht.
Wenig Anpresskraft hat nur Vorteile: weniger Verschleiss, kaum Standplatten im O-Ring, weniger Belastung für die Motorwelle und mehr Drehmoment-Reserve.
Eine weiche Feder oder ein Gummiband genügt, unter Umständen sogar das Eigengewicht, falls der Motor oben auf der Schiene sitzt.
Die Führung des Schlittens leichtgängig machen, das ist jetzt der grösste Widerstand im System.

Mit so wenig Last kannst du den 28BYJ-48 auch etwas schneller laufen lassen, ohne dass er Schritte verliert. Und das Mattieren der Alu-Leiste ist dann eher Feintuning als Pflicht.

wieso wäre alu auf der schiene besser als auch eine gummierung auf der schiene?

Comparing aluminum and rubber rail coatings for wheel traction.

Weil du die zusätzliche Haftung von Gummi gar nicht brauchst, die Nachteile aber trotzdem bekommst.

Mit O-Ringen auf dem Rad wäre Gummi auf der Schiene ja Gummi auf Gummi. Im Vergleich zu Alu heisst das:

Präzision: Alu ist hart und formstabil, der O-Ring rollt auf einer definierten Fläche ab. Bei Gummi auf Gummi geben beide nach, der wirksame Abrollradius schwankt, und der Weg pro Schritt wird ungenauer.
Ruckeln (Stick-Slip): Gummi auf Gummi neigt bei langsamen Bewegungen zum Haften und Losreissen. Der 28BYJ-48 ist langsam, das würdest du merken.
Rollwiderstand: Zwei weiche Partner walken mehr. Bei deiner kleinen Last ist das zwar nicht dramatisch, aber unnötig.
Kleben im Stillstand: Gummi kann bei längerem Stillstand an Gummi anhaften, das gibt dann einen kleinen Ruck beim Anfahren.
Verschleiss und Schmutz: Abrieb auf beiden Seiten, und weiche Flächen sammeln Staub, was den Grip verändert. Alu bleibt sauber und lässt sich einfach abwischen.
Haltbarkeit: Gummi auf der Schiene altert, wird hart oder löst sich an den Klebestellen. Alu bleibt einfach so, wie es ist.

Kurz gesagt: Die Haftung von Gummi auf Gummi wäre höher, aber bei deiner Last reicht NBR auf Alu schon locker. Die harte Schiene gibt dir dafür Genauigkeit, gleichmässigen Lauf und Langlebigkeit.