ich habe noch rechechiert und nachgeforscht, was es alles für arten gibt wie kraft von einem rotor in eine lineare bewegung übertragen werdne kann. 


was gibt es alles für mechanische antriebe wo man die rotation von einer motorwelle direkt auf eine lineare schiene übertragen will. 

zb spindel?
gummiriemen?

bitte mache eine liste mit deutschem namen und englischem namen und einer knackigen stichwortartigen beschreibung

Zusammenstellung mechanischer Getriebe für Rotations-Translations-Umwandlung.
Zusammenstellung mechanischer Getriebe für Rotations-Translations-Umwandlung.
Hier die gängigen mechanischen Antriebe, die eine Drehbewegung in eine Linearbewegung umsetzen:

Gewindetriebe (Spindel)

Deutsch	Englisch	Kurzbeschreibung
Trapezgewindespindel	Lead screw (trapezoidal / ACME screw)	Gleitreibung, günstig, oft selbsthemmend, mässiger Wirkungsgrad (ca. 30–50 %), Verschleiss
Kugelgewindetrieb (KGT)	Ball screw	Kugeln rollen statt gleiten, hoher Wirkungsgrad (über 90 %), präzise, spielfrei möglich, nicht selbsthemmend
Planetenrollengewindetrieb	Planetary roller screw	Rollen statt Kugeln, sehr hohe Lasten, lange Lebensdauer, teuer
Spindelhubgetriebe	Screw jack	Schnecke und Spindel im Gehäuse, für hohe Hubkräfte, langsam, meist selbsthemmend
Zugmitteltriebe (Riemen, Kette, Seil)

Deutsch	Englisch	Kurzbeschreibung
Zahnriemenantrieb	Timing belt drive (toothed belt)	Schlupffrei, schnell, lange Wege, leicht, günstig; etwas elastisch, daher weniger steif
Omega-Antrieb	Omega drive	Riemen fest gespannt, Motor fährt mit dem Schlitten mit, Riemen läuft in Ω-Form um das Ritzel
Flachriemen	Flat belt	Reibschlüssig, Schlupf möglich, für Positionierung ungeeignet
Kettentrieb	Chain drive	Robust, hohe Kräfte, Polygoneffekt (ungleichförmig), laut, Schmierung nötig
Seilzug / Seiltrieb	Cable drive / wire rope drive (capstan drive)	Sehr leicht, spielfrei, lange Wege, Seildehnung beachten
Schubkette / Zahnkette	Push-pull chain / zip chain	Kette versteift sich beim Ausfahren und kann auch schieben, platzsparend aufgerollt
Formschlüssige Verzahnung

Deutsch	Englisch	Kurzbeschreibung
Zahnstange und Ritzel	Rack and pinion	Beliebig lange Wege durch Stückeln, steif, hohe Kräfte, Zahnflankenspiel
Rollenritzel mit Zahnstange	Roller pinion system	Rollen greifen in die Zahnstange, nahezu spielfrei, hohe Präzision
Reibschluss

Deutsch	Englisch	Kurzbeschreibung
Reibradantrieb	Friction drive	Rad presst auf Schiene oder Stange, einfach, leise, Schlupf
Rollringgetriebe	Rolling ring drive (z. B. Uhing)	Schräg angestellte Wälzringe auf einer glatten Welle, kein Gewinde, Überlastschutz durch Durchrutschen
Koppel- und Kurvengetriebe (meist hin und her)

Deutsch	Englisch	Kurzbeschreibung
Schubkurbel / Kurbeltrieb	Slider-crank mechanism	Kurbel plus Pleuel, oszillierend, fester Hub, ungleichförmige Geschwindigkeit
Kreuzschleife	Scotch yoke	Sinusförmige Hubbewegung, kompakt, fester Hub
Kurvenscheibe / Nocken	Cam and follower	Bewegungsprofil frei gestaltbar, kurzer Hub
Kurventrommel / Walzenkurve	Barrel cam / cylindrical cam	Nut auf einem Zylinder, Hub entlang der Achse, gut für Taktbewegungen
Zu deinem “Gummiriemen”: Für Linearachsen ist praktisch immer der Zahnriemen gemeint, meist aus PU oder Gummi mit Stahl- oder Glasfasercord. Ein glatter Riemen würde rutschen.

Als Faustregel zur Auswahl: Präzision und Kraft sprechen für den Kugelgewindetrieb, Geschwindigkeit und lange Wege für Zahnriemen oder Zahnstange, ein kleines Budget mit Selbsthemmung für die Trapezspindel.

ich moechte nun eine selbst entwickelte loesung fuer den 28byj48 stepper motor machen. ich moechte ein friction drive. welche materialien kann ich verwenden?

Designing a friction drive for a small geared stepper motor.
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

