# SoraFlux 1.4.1

A bug-fix release. The defects below were found by clicking through the installed 1.4.0 on Windows. The fixes are tested on Linux (unit tests, tests with real ffmpeg, a layout test in Chromium); they have not yet been re-checked in the installed app on Windows.

## English

Fixed:
- "Reduce to X MB" and Simple mode "For sending" no longer make a file bigger. A file that already fits is left alone ("This file already fits (3.1 MB)"); otherwise the video bitrate never goes above the source and the size shown before converting matches the result much more closely. "Fits in an e-mail" is only shown when it is true.
- A "from–to" range set for one file no longer trims the next conversion. It is cleared when the file list changes or another quick action is picked, and it is shown on the collapsed "Advanced" header while active.
- Dropping an unsupported file (or a video on the Images tab) now shows a message with the reason instead of doing nothing.
- A video without audio with an audio format selected shows the right reason ("This file has no audio…") next to the file, and the same rule applies whether the format was picked before or after dropping.
- Download errors are short Polish/English sentences (e.g. "Can't connect to the server. Check the address and your internet connection."), without broken Polish letters; the raw yt-dlp text is under "Technical details".
- "Check" on the Download tab no longer leaves the result of the previous link on screen.
- The Images tab shows only the image formats under the drop area.
- Theme cards are announced as toggle buttons (pressed / not pressed), and the selected one is marked with a check, not only by color.
- "Cut a clip" without re-encoding: if the result is more than 1 s longer or shorter than asked (keyframes), the job ends as "Done with a warning" with the real length. New "Accurate (re-encode)" option for a frame-accurate cut. The help text no longer promises "a fraction of a second".
- At the smallest window size (860×600) the bar with "Save to / Result / Convert" fits in one row and no longer covers the page.

## Polski

Naprawione:
- „Zmniejsz do X MB” i „Do wysłania” w trybie Prostym już nie powiększają pliku. Plik, który się mieści, zostaje bez zmian („Ten plik już się mieści (3,1 MB)”); w pozostałych bitrate obrazu nie przekracza źródła, a rozmiar pokazany przed konwersją dużo lepiej zgadza się z wynikiem. „Zmieści się w mailu” pojawia się tylko wtedy, gdy to prawda.
- „Fragment od–do” ustawiony dla jednego pliku nie przycina już następnej konwersji. Kasuje się przy zmianie listy plików i przy innej szybkiej akcji, a gdy jest aktywny, widać go na zwiniętym „Zaawansowane”.
- Upuszczenie nieobsługiwanego pliku (albo filmu na zakładkę Obrazy) pokazuje komunikat z powodem zamiast nic nie robić.
- Film bez dźwięku z wybranym formatem audio pokazuje właściwy powód („Ten plik nie ma dźwięku…”) przy pliku, a reguła działa tak samo, gdy format wybrano przed i po upuszczeniu.
- Błędy pobierania to krótkie zdania (np. „Nie mogę połączyć się z serwerem. Sprawdź adres i internet.”), bez zepsutych polskich liter; surowy tekst yt-dlp jest w „Szczegóły techniczne”.
- „Sprawdź” na zakładce Pobierz nie zostawia już na ekranie wyniku poprzedniego linku.
- Zakładka Obrazy pokazuje pod strefą upuszczania tylko formaty obrazów.
- Kafle motywów czytnik ekranu ogłasza jako przyciski (wciśnięty / niewciśnięty), a wybrany ma znacznik ✓, nie tylko kolor.
- „Wytnij fragment” bez ponownego kodowania: gdy wynik trwa ponad 1 s dłużej albo krócej niż ustawiono (klatki kluczowe), zadanie kończy się „Gotowe z ostrzeżeniem” z prawdziwą długością. Nowa opcja „Dokładnie (ponowne kodowanie)” do cięcia co do klatki. Pomoc nie obiecuje już „ułamka sekundy”.
- W najmniejszym oknie (860×600) pasek „Zapisz do / Wynik / Konwertuj” mieści się w jednym rzędzie i nie zasłania strony.
