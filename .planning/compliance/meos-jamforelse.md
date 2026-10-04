# MeOS jämfört med fartOLa mot SOFT:s regelverk

**Datum:** 2026-10-05

**MeOS-version:** 5.0, build 1851, "U3", daterad 2026-09-12 (`meosversion.cpp`: `getMajorVersion()` = 5.0, `getMeosBuild()` = 174 + Rev 1677, `getBuildType()` = U3). Källkod i `/home/jonas/src/meos/code`. Alla MeOS-sökvägar nedan är relativa till den katalogen.

**Regelverk:** Regelverk för orientering, version 20260701_2 (SOFT, gäller från 2026-07-01). Samma version som `soft-regelverk-2026.md`.

**fartOLa:** statuskolumnen är kopierad ordagrant från `soft-regelverk-2026.md` (75 rader, samma ID:n och ordning). Belägg för reglerna finns där och upprepas inte här. I avsnitt 4 är fartOLa-sökvägar utan prefix relativa till `apps/edge/src/`. Övriga börjar med `apps/` eller `packages/`, samma konvention som i matrisen.

## 1. Hur dokumentet ska läsas

- Varje rad i avsnitt 2 har en MeOS-status:
  - `UPPFYLLER`: koden har funktionen, och MeOS:s standardinställning ger inte ett resultat som strider mot regeln. Om funktionen måste slås på (en "MeOS-funktion" eller en kryssruta per klass) står det i anmärkningen.
  - `DELVIS`: bara en del av raden täcks, eller standardinställningen ger tyst ett regelstridigt resultat tills arrangören ändrar den.
  - `UPPFYLLER INTE`: ingen kod hittades. Anmärkningen nämner vad som söktes.
  - `EJ TILLÄMPLIG`: görs utanför tävlingsprogrammet (Eventor, SOFT).
- Belägg anges som `fil:rad` (från `grep -n` i källträdet), namnet på datafältet (`oDataContainer`-namnet, t.ex. `IgnoreStart`) och det svenska gränssnittsordet från `swedish.lng` eller koden.
- MeOS är GPL. Koden beskrivs här och citeras inte.
- MeOS:s standardinställningar som påverkar flera rader:
  - `IgnoreStart` ("Ej startstämpling") är 0 per klass, så startstämpeln flyttar den lottade starttiden (`oClass.cpp:2787-2789`, `oRunner.cpp:1226-1227`, `oRunner.cpp:1331-1344`).
  - Standardlottningen är "Lottning (MeOS)" (`TabClass.cpp:493`, `DefaultDrawMethod`). SOFT-metoden heter i gränssnittet "Äldre SOFT-lottning" (`swedish.lng:1560`).
  - `MaxTime` är 0 både för tävlingen och för klasser. Status Maxtid kan alltså inte uppstå förrän värdet sätts (`oRunner.cpp:1608-1616`).
  - Tidstillägg kräver MeOS-funktionen "TA" (`MeOSFeatures.cpp:47`, `TabRunner.cpp:3448`).
  - `AllowQuickEntry` ("Direktanmälan") är förkryssad för klasser som skapas i klassformuläret (`TabClass.cpp:3672`), men 0 för importerade klasser.
  - Vakanser lottas blandat med övriga (`VacantPosition::Mixed`, `oEventDraw.cpp:1715`).
  - `SubSeconds` ("Tiondelar") är av (`oEvent.cpp:196`, `oEvent.cpp:6917-6919`).

## 2. Per regel

### Kapitel 3. Allmänna villkor för tävlingar

| ID | fartOLa-status | MeOS | MeOS-belägg | Anmärkning |
|---|---|---|---|---|
| TR 3.2.1 | DELVIS | UPPFYLLER | Klasstyper individuell, patrull och stafett: `oClass.h:136-141` (`ClassType`), `oClass.cpp:1718-1725` (`getClassType`). Etapper: `NumStages` "Antal etapper" (`oEvent.cpp:192`), `PreEvent`/`PostEvent` (`oEvent.cpp:168-169`), "Totalresultat" (`swedish.lng:1999`), listan `EStdIndMultiResultListAll` (`oListInfo.cpp:4427`). | Etapper är separata tävlingar som länkas, och tidigare resultat förs över (`InputResult` "Tidigare resultat", `oEvent.cpp:279`). |
| TR 3.4.2 | DELVIS | DELVIS | Fält `ClassType` "Klasstyp" (`oEvent.cpp:325`), `ClassMetaType {ctElite, ctNormal, ctYouth, ctTraining, ctExercise, ctOpen}` (`oClass.h:144`), `interpretClassType` (`oClass.cpp:2867`). Fördefinierade typer: Elit, Vuxen, Ungdom, Motion, Öppen, Träning (`oClass.cpp:2965-2971`). | Fritext som gissas från klassnamnet (`oClass.cpp:2925-2950`). Typen styr bara standardavgift (`oClass.cpp:3263-3277`), inga regler. Inskolning saknas som typ. |
| TR 3.4.4, TR 3.7.10, TR 3.7.12 | SAKNAS | DELVIS | `BirthYear` per löpare (`oEvent.cpp:248`), `LowAge` "Undre ålder" och `HighAge` "Övre ålder" per klass (`oEvent.cpp:320-321`). `findBestClass` hoppar över klasser där ålder eller kön inte passar (`oClass.cpp:676-681`). | Åldern används för att föreslå klass och för reducerad avgift (`YouthAge`, `SeniorAge`, `oEvent.cpp:140-141`). Ingen spärr eller varning vid anmälan i fel åldersklass, och ingen lägsta ålder för SM. |
| TR 3.4.8, TR 4.14.1 (utan tidtagning) | DELVIS | UPPFYLLER | Per löpare: flaggan `FlagNoTiming` och status `StatusNoTiming` "Utan tidtagning" (`oRunner.cpp:3117-3120`, `oRunner.cpp:1668-1674`), som importeras från IOF EntryList (`iof30interface.cpp:2290`). Per klass: `NoTiming` "Ej tidtagning" (`oEvent.cpp:336`). IOF-exporten utelämnar tid och placering (`iof30interface.cpp:3573-3574`, `iof30interface.cpp:3598`). | Valet per deltagare finns, vilket fartOLa saknar (bara per klass). Texten "Deltagit" saknas däremot: skärmen visar "Utan tidtagning" och utskriften "Godkänd" (`oEvent.cpp:5693-5697`). Det räknas under benämningarna, TR 4.21.3 och TA till TR 7.8.2 (statusrader). |
| TR 3.4.11, TR 4.20.7 (patrull), TR 4.20.9 (patrull) | SAKNAS | UPPFYLLER | Patrull som lag med parallell sträcka (`oTeamEvent.cpp:826-835`). Lagtiden är den längsta av medlemmarnas tider (`oTeam.cpp:528-535`, `LTParallel`). Listtyper "Patrull, 1 SI-pinne" och "Patrull, 2 SI-pinnar" (`swedish.lng:1287-1288`). | Använd varianten med två brickor. "1 SI-pinne" låter patrullen dela bricka, vilket strider mot att alla ska bära bricka. |
| TR 3.6.3–3.6.5, TR 3.7.9, TA till TR 7.8.3 (DM) | SAKNAS | DELVIS | Distrikt per klubb: `District` (`oEvent.cpp:218`), importeras från IOF (`iof30interface.cpp:2720`). Rapporten "Anmälda per distrikt" med kolumnen Startande (`oReport.cpp:201`, `oReport.cpp:289-300`). Symbolen `DistrictId` i resultatmoduler (`generalresult.cpp:1266`). | Inget mästerskapsbegrepp och ingen gräns för antal startande. Mästerskapstecken går bara att räkna fram med en egen resultatmodul. Sökt: "Mästerskap", "Championship", "Medal". |
| TR 3.7.1 | EJ TILLÄMPLIG | EJ TILLÄMPLIG | Ingen kontroll i MeOS. | Sköts i Eventor. |

### Kapitel 4. Tekniska regler för tävling

| ID | fartOLa-status | MeOS | MeOS-belägg | Anmärkning |
|---|---|---|---|---|
| TR 4.12.4, TR 4.12.6 | SAKNAS | DELVIS | Brickhyra `CardFee` "Brickhyra" för tävlingen och per löpare (`oEvent.cpp:136`, `oEvent.cpp:244`). Den sätts bara när löparen har hyrbricka (`oRunner.cpp:2866-2880`). Klassavgifter `ClassFee`, `HighClassFee` "Sen avgift", reducerade varianter (`oEvent.cpp:348-353`). Höjning `LateEntryFactor` "Avgiftshöjning (procent)" (`oEvent.cpp:148`). | Egen bricka debiteras inte. Efteranmälningstillägget är en procentsats för hela tävlingen, utan tak per klasstyp och utan undantag för öppna ungdomsklasser. Arrangören måste sätta "Sen avgift" per klass för hand. |
| TR 4.14.1 (via Eventor) | UPPFYLLD | UPPFYLLER | Knappen "Hämta efteranmälningar" (`TabCompetition.cpp:1106`), `IOF30Interface::readEntryList` (`iof30interface.cpp:1064`). "Hämta (efter)anmälningar från Eventor" (`swedish.lng:688`). | Kräver klubbens API-nyckel för Eventor. |
| TR 4.14.1 (en klass) | DELVIS | DELVIS | `oEvent::checkCardUsed` (`oEvent.cpp:6441`) stoppar en bricka som redan används. "Bricka %d används redan av %s och kan inte tilldelas" (`swedish.lng:232`). | Samma person utan bricka eller med en annan bricka kan anmälas i två klasser, alltså samma lucka som i fartOLa. Sökt: "Dubblett", "Duplicate", "redan anmäld". |
| TR 4.14.1 (direktanmälan) | DELVIS | DELVIS | Kryssruta per klass `AllowQuickEntry` "Direktanmälan" (`TabClass.cpp:4166`, `oClass.cpp:1316`). Klasser som skapas i klassformuläret får den förkryssad (`TabClass.cpp:3664`); importerade klasser får 0 (heltalsfältens startvärde, `oDataContainer.cpp:205`). Anmälningsläget i SI-fliken visar klasserna med bocken (`TabSI.cpp:3669`). | Spärren mot elitklass är en manuell bock som inte hänger ihop med klasstyp. Nya klasser får bocken förkryssad, även elitklasser. Importerade klasser saknar den, även öppna klasser. Löparfliken tillåter dessutom alla klasser. (Tidigare hänvisning till `oEvent.cpp:6141` gällde avgifter, inte klassfiltret.) |
| TR 4.14.3, TR 4.18.18–4.18.21, TR 4.20.9 (lag/omstart), TR 7.5.10 med TA, TA till TR 7.8.2 (stafett), TR 8.2.10, TR 10.4.5–10.4.6 | SAKNAS | DELVIS | Nummerlappar `Bib` för löpare, lag och klass (`oEvent.cpp:249`, `oEvent.cpp:362`, `oEvent.cpp:392`), `oEvent::addBib` (`oEvent.cpp:4975`). Omstart och repdragning per sträcka (`oClass.cpp:289-350`): "Omstart", "Omstartstid", "Repdragningstid" (`swedish.lng:1239-1243`, `swedish.lng:1395`). Listan "Lagändringblankett" (`TabList.cpp:2963`). Stafettresultat per sträcka och lag (`oListInfo.cpp:4334-4352`). | Nästan hela stafettmodellen finns. "En sträcka per person" spärras inte, men rapporten "Löpare som förekommer i mer än ett lag" (`oReport.cpp:734`) visar dem. Placering vid omstart har inte verifierats. |
| TR 4.14.4 | UPPFYLLD | UPPFYLLER | Inget särskilt samtyckesfält (`oEvent.cpp:240-285`), och regeln kräver inget. | Samtycket uppstår genom anmälan (TR 4.14.4); en kryssruta eller ett sparat samtycke krävs inte. fartOLa:s krav på bekräftat samtycke vid direktanmälan är egen policy. |
| TR 4.16.1 (startlistor) | DELVIS | UPPFYLLER | Knappen "Publicera startlista" till Eventor (`TabCompetition.cpp:1108`). Utskrivbar startlista "Startlista" via listsystemet (`oListInfo.cpp:4788-4802`). |  |
| TR 4.16.3, TR 4.22.1 | SAKNAS | UPPFYLLER INTE | Maxtid finns som värde (`oEvent.cpp:165`, `oEvent.cpp:356`), men inget räknar ut sista start plus maxtid. | Sökt: "Stängning", "Målstängning", `getMaximumRunnerTime` i kombination med sista start. |
| TR 4.18.9 med TA (sen start) | UPPFYLLD | DELVIS | Startstämpeln ersätter den lottade starttiden (`oRunner.cpp:1331-1344`, `tUseStartPunch` är true som standard enligt `oRunner.cpp:295`). Klassinställningen `IgnoreStart` "Ej startstämpling" (`oEvent.cpp:340-341`, `oClass.cpp:2787-2789`) stänger av det när löparen har starttid (`oRunner.cpp:1226-1227`). Ny starttid skrivs i fältet "Starttid:" (`TabRunner.cpp:3445`). | **Standardinställningen strider mot regeln i klasser med lottade starttider:** startstämpeln ersätter den lottade starttiden (`tUseStartPunch`, `oRunner.cpp:295`; `oRunner.cpp:1331-1344`), så en löpare som är sen av eget fel tidtas från stämpeln. Kryssrutan "Ej startstämpling" (`IgnoreStart`, `oClass.cpp:55`, `oRunner.cpp:1226-1227`) ger det regelrätta beteendet och måste sättas per klass. Startstämpling som startmetod är i sig tillåten (TR 4.18.16). Ingen varning för sen start. |
| TA till TR 4.18.9 (ny starttid noteras) | DELVIS | UPPFYLLER | Starttid skrivs för hand per löpare i fältet "Starttid:" (`TabRunner.cpp:3445`, sparas på `TabRunner.cpp:680`, `oRunner.cpp:1331`). Kommentar per deltagare: knappen "Kommentar >>" (`TabRunner.cpp:3532`). | Den faktiska starten kan noteras i en kommentar utan att den officiella starttiden ändras. Att meddela tävlingsledningen är arrangörens rutin. (Tidigare anmärkning om saknad samlad panel gällde inte vad anvisningen kräver.) |
| TR 4.18.10 | UPPFYLLD | UPPFYLLER | SI-lägen "Registrera hyrbrickor", "Tilldela hyrbrickor" och "Avstämning hyrbrickor" (`TabSI.cpp:81-83`). Kryssrutan "Hyrbricka" i anmälan (`TabSI.cpp:3729`). "Vänligen återlämna hyrbrickan" vid avläsning (`TabSI.cpp:3386`). Rapporten "Hyrbricksrapport" (`oListInfo.cpp:4846`). Fältet `Phone` "Telefon" (`oEvent.cpp:267`). | Kontaktuppgift krävs inte för hyrbricka. Avstämningen görs lokalt på en dator och ändrar inte tävlingen (`swedish.lng:2364`). |
| TR 4.18.14 (tjuvstart) | SAKNAS | UPPFYLLER | `TimeAdjust` "Tidsjustering" per löpare (`oEvent.cpp:271`), inmatningen "Tidstillägg:" (`TabRunner.cpp:3455`). Tillägget ingår i löptiden (`oRunner.cpp:823`). Diskning görs med status "Disk." (`oEvent.cpp:5342`). | Fältet syns först när MeOS-funktionen "TA" är på (`TabRunner.cpp:3448`). Tjuvstart upptäcks inte automatiskt, och minuten läggs på för hand. |
| TR 4.18.16 | UPPFYLLD | UPPFYLLER | Standardbeteendet: startstämpeln sätter starttiden (`oRunner.cpp:1331-1344`). Per klass: `IgnoreStart` (`TabClass.cpp:4177`) och `FreeStart` "Fri starttid" (`oEvent.cpp:337`). | Valet görs per klass. |
| TR 4.20.6 (målstämpling) | UPPFYLLD | UPPFYLLER | Måltiden tas från målstämpeln (`oRunner.cpp:1641-1646`). Utan målstämpel blir statusen minst `StatusDNF` med texten "Måltid saknas." (`oRunner.cpp:1647-1650`). |  |
| TR 4.20.6 (tid vid mållinjen) | SAKNAS | UPPFYLLER | Inmatningen "Måltid:" i löparfliken (`TabRunner.cpp:3446`, sparas med `setFinishTimeS` på `TabRunner.cpp:681-682`). Stämplar, även målstämpeln, redigeras och sparas i stämpellistan (`TabRunner.cpp:3552`, `TabRunner.cpp:3246`). | Fältet "Måltid:" går bara att ändra när brickan saknar målstämpel (`canSetFinish`, `TabRunner.cpp:3888`), men en befintlig målstämpel kan ändras i stämpellistan och kortet bedöms om. |
| TR 4.20.7 | UPPFYLLD | DELVIS | Tider lagras i tiondelar (`timeconstants.hpp`, `timeUnitsPerSecond = 10`). Tiondelar läses från SI bara med `SubSeconds` "Tiondelar" på (`oEvent.cpp:196`, kryssrutan "Aktivera stöd för tiondels sekunder" på `TabCompetition.cpp:2605`). Formatering `formatTime` (`meos_util.cpp:678-695`). | Villkorligt, inte ett fel i standardinställningen: tiondelar är av som standard (`SportIdent.h:161`), så SI-tider blir hela sekunder. Med tiondelar påslagna (`SportIdent.cpp:1927`) placeras löparna på den oavrundade tiden (`oEventResult.cpp:369`), och visningen klipper av i stället för att avrunda (`meos_util.cpp:687`). |
| TR 4.20.8 (individuell start) | UPPFYLLD | UPPFYLLER | `calculatePlace` (`oEventResult.cpp:64-100`): lika resultat ger samma placering, och nästa placering hoppar över. | Lika lagrade tider delar placering. Med tiondelar påslagna jämförs oavrundade tider (se TR 4.20.7). |
| TR 4.20.8 (gemensam start/jaktstart) | SAKNAS | UPPFYLLER INTE | Listan "Målgångsordning" (`swedish.lng:546`) och sortering på måltid (`oRunner.cpp:2301`, `oRunner.cpp:4108`). Placeringen räknas ur tiden (`oEventResult.cpp:369`). | Ingen av dem ger en domarordning för löpare med samma registrerade sekund, och placeringskolumnen går inte att redigera. |
| TR 4.20.9 (maxtid) | UPPFYLLD | UPPFYLLER | Löptid över `MaxTime` ger `StatusMAX` (`oRunner.cpp:1608-1616`), och bara OK blir Maxtid (`oRunner.cpp:1653-1654`). Felstämpling går alltså före. "Maxtid" (`oEvent.cpp:5343`). | Uppfyllt när maxtiden är inmatad. Utan satt maxtid (standard 0) blir ingen löpare Maxtid, så arrangören måste mata in den publicerade maxtiden. |
| TR 4.20.10 | DELVIS | DELVIS | Löptiden är måltid minus starttid plus `TimeAdjust` (`oRunner.cpp:819-823`). Avdrag av sträcktid sker bara med uttryckligen valda kontrollstatusar ("Utan tidtagning", "Försvunnen", `oRunner.cpp:1789`, `oRunner.cpp:1799`) eller positiv `MinTime` "Minsta sträcktid" (`oRunner.cpp:1826`). | Standard följer regeln. De valfria inställningarna drar av sträcktid och strider då mot regeln, samma slags avvikelse som fartOLa:s `leg_voided`. Ingen av dem är på som standard. |
| TR 4.21.1 | UPPFYLLD | DELVIS | En maxtid för tävlingen: `MaxTime` "Gräns för maxtid" (`oEvent.cpp:165`, tävlingsformuläret `TabCompetition.cpp:4335-4339`). Klasser med 0 ärver den (`oClass.cpp:3304-3306`). | Regeln kräver en maxtid fastställd i förväg, inte att 2× eller 4× räknas ut automatiskt. Kvar: utan inmatat värde finns ingen maxtid, och en klass kan få ett eget värde som avviker från tävlingens (fartOLa låter tävlingens värde gälla över klassens). |
| TR 4.21.2 | UPPFYLLD | UPPFYLLER INTE | `setMaximalTime` (`oEvent.cpp:4935-4938`) sätter värdet utan villkor. | Sökt: "MaxTime" med "lock"/"Lock". |
| TR 4.21.3 | DELVIS | DELVIS | Utskrivbara resultatlistor genom listsystemet (`oListInfo.cpp:4864`, `EStdResultList`), med utskrift och PDF (`printer.cpp`, `pdfwriter.cpp`). | Listan på arenan finns. Standardutskriften skriver "Godkänd" för deltagare utan tidtagning (inte "Deltagit") och "Felst.", "Utg." och "Disk." (`oListInfo.cpp:1680`, `oListInfo.cpp:4889`, `oEvent.cpp:5662`, `oEvent.cpp:5693`). |
| TR 4.21.4, TR 7.8.3 | UPPFYLLD | UPPFYLLER | Knappen "Publicera resultat" (`TabCompetition.cpp:1113`): "Publicera resultat och sträcktider på Eventor och WinSplits online" (`swedish.lng:1330`). |  |
| TR 4.22.1 (alla i mål) | DELVIS | UPPFYLLER | Listan "Kvar-i-skogen" (`oListInfo.cpp:4469`, knapp på `TabList.cpp:2927`), `generateInForestList` (`oListInfo.cpp:4585-4586`). | Listan visar också löpare som inte startat. Flera datorer ser samma lista om de kör mot samma MySQL-databas (inte verifierat i detalj). |
| TR 4.23.1 | SAKNAS | UPPFYLLER | Klassfältet `Status` med "Struken med återbetalning" och "Struken utan återbetalning" (`oClass.cpp:3970-3974`, `oClass.h:151`). Ogiltig klass får ingen placering (`oEventResult.cpp:80-84`). IOF-exporten skriver `Invalidated` och `InvalidatedNoFee` (`iof30interface.cpp:3471-3474`). | Gränssnittet säger "Struken" och inte "Ogiltig", men effekten i resultat och export motsvarar regeln. |
| TR 4.23.3 | SAKNAS | UPPFYLLER | Banans inställning "Använd sista kontrollen som mål" (`LastAsFinish`, gränssnittet `TabCourse.cpp:1081`, `TabCourse.cpp:271`, `TabCourse.cpp:317`): den sista kvarvarande kontrollen blir målstämpel och ger måltiden (`oCourse.cpp:1022`, `oRunner.cpp:1634`). | Stryks de sista kontrollerna ur banan räknas tiden till den sista som är kvar. Arrangören avgör om den strukna delen är högst ca 1/10. |

### Kapitel 6. Särskilt om banläggning

| ID | fartOLa-status | MeOS | MeOS-belägg | Anmärkning |
|---|---|---|---|---|
| TA till TR 6.5.1, TR 7.5.3 (första stycket) | SAKNAS | UPPFYLLER | Varningarna "Samma bana och starttid i X" och "Samma bana på angränsande starttid: X" (`oEventDraw.cpp:1351`, `oEventDraw.cpp:1367`). Lottningen över klasser undviker samma förstakontroll (`oEventDraw.cpp:3172-3229`, `allowSameFirstControl`). | Kryssrutan "Tillåt samma bana inom basintervall" är förkryssad som standard (`TabClass.cpp:1773`, `DrawInterlace` = 1). Det är saxning, som TR 7.5.5 förbjuder för rankingklasser. |
| TA till TR 6.8.2 | SAKNAS | UPPFYLLER INTE | `oControl.cpp:296` kontrollerar bara att koden ligger mellan 1 och 1023. | Sökt: "< 31", "förväxl", "confus". |

### Kapitel 7. Särskilt om tävlingsadministration

| ID | fartOLa-status | MeOS | MeOS-belägg | Anmärkning |
|---|---|---|---|---|
| TR 7.1.2 | SAKNAS | EJ TILLÄMPLIG | Inget i koden (sökt: "SOFT", "Svenska Orienteringsförbundet"). | Godkännandet är administrativt och kontrolleras mot SOFT:s lista, inte i koden. fartOLa-matrisen förutsätter att MeOS eller OLA är huvudsystem. |
| TR 7.3.2 | DELVIS | UPPFYLLER | Vakanser lottas in som löpare med klubben "Vakant" (`oEventDraw.cpp:604-629`, "Andel vakanser:" på `TabClass.cpp:1763`, "Vakansplacering" i `swedish.lng:2096`). En vakans kan tas av en efteranmäld: "Vakanser / klassbyte" (`swedish.lng:2093`). | Vakanserna läggs in efter en andel för alla klasser. Att det sker i elitklasser är arrangörens val. |
| TR 7.3.3 med TA | DELVIS | DELVIS | Klassbyte per löpare i löparfliken. "Vakanser / klassbyte" (`swedish.lng:2093`). | Ingen funktion som hittar klasser med färre än fyra anmälda. Sökt: "färre än", "få anmälda". |
| TR 7.3.6, TR 7.3.7 med TA | SAKNAS | DELVIS | `Rank` "Ranking" per löpare (`oEvent.cpp:250`). Seedning på Resultat, Tid, Ranking eller Poäng (`oClass.cpp:4729-4737`). Klassdelning med "Dela efter ranking" och "Jämna klasser (ranking)" (`oClass.cpp:2231-2241`, knappen "Dela klassen..." på `TabClass.cpp:4603`). | Inget filter för Sverigelistan och ingen gallring. Rankingen måste läsas in. |
| TR 7.3.8 | SAKNAS | DELVIS | "Dela klubbvis" (`oClass.cpp:2233`) och "Jämna klasser" (`oClass.cpp:2238`). | Jämn storlek och samma förening i samma klass är två olika metoder och går inte att kombinera. |
| TR 7.3.9 | EJ TILLÄMPLIG | EJ TILLÄMPLIG | – | Klasserna läggs upp i Eventor. |
| TR 7.4.1 (intervallstart, gemensam start) | UPPFYLLD | UPPFYLLER | Lottningsmetoderna i `TabClass.cpp:5087-5091`, bland annat "Gemensam start" (`DrawMethod::Simultaneous`). "Startintervall (min):" (`TabClass.cpp:4956`). |  |
| TR 7.4.1 (fri intervallstart, jaktstart, omvänd jaktstart) | SAKNAS | DELVIS | "Jaktstart" och "Omvänd jaktstart" (`TabClass.cpp:5093-5094`, visas för etapptävlingar). Bokning av starttid: klassfältet `RequestStart` "Boka starttid" (`oEvent.cpp:338`) och SI-läget "Boka starttid" (`TabSI.cpp:86`). | Metoderna finns, men förbudet mot jaktstart i inskolning och D/H10–12 upprätthålls inte. Sökt: "inskolning", "10-12". |
| TR 7.4.2, TR 7.4.3 | DELVIS | DELVIS | Starttyp per sträcka (`oClass.h:40-47`, `StartTypes`), `FreeStart` "Fri starttid" per klass (`oEvent.cpp:337`). | Fri starttid är av som standard men går att slå på i vilken klass som helst. Inget förbud kopplat till klasstyp eller nivå. |
| TR 7.4.4 med TA, TR 7.5.3 (tredje meningen) | UPPFYLLD | UPPFYLLER | `StartInterval` "Intervall" per klass (`oEvent.cpp:344`), "Startintervall:" (`TabClass.cpp:5137`). | Ingen varning för intervall under 1 eller över 3 minuter. |
| TR 7.4.5 | SAKNAS | UPPFYLLER | "Seedningsgrupper:" (`TabClass.cpp:575`), "Seedad lottning" (`TabClass.cpp:5075`), `drawSeeded` (`oClass.cpp:4737`). | Fungerar för alla klasser och är inte begränsat till elitklasser. |
| TR 7.5.1 (förening) | UPPFYLLD | UPPFYLLER | `drawSOFTMethod` grupperar per förening och varvar dem (`oEventDraw.cpp:130-200`). Även `drawMeOSMethod` (`oEventDraw.cpp:202`). Metodval på `TabClass.cpp:502-504`. | Metoden "Lottning" (Random) har ingen föreningsseparation. Standard är "Lottning (MeOS)". |
| TR 7.5.1 (utan namn) | UPPFYLLD | DELVIS | Vakanser är egna löpare med klubben "Vakant" (`oEventDraw.cpp:2412`, `oEventDraw.cpp:2477`). | Ingen kontroll av att en löpare utan namn hålls utanför lottningen hittades. |
| TR 7.5.2 | DELVIS | DELVIS | `DrawMethod::SOFT` (`oEvent.h:551`, `oEventDraw.cpp:2585`). Slumpkällan är en fast tabell på 16381 bitar (`random.cpp`, `InitRanom`) som seedas en gång från `GetTickCount` vid start (`meos.cpp:245-246`), och nollställs i testläge (`oEventDraw.cpp:2567-2568`). `permute` bygger på bitar och delning (`random.cpp:91-112`). | Regeln föreskriver ingen viss blandningsalgoritm. Slumpkällans tillstånd går vidare mellan lottningar (`random.cpp:49`, `random.cpp:91`, seedad på `meos.cpp:245`), och nollställs bara i testläge (`oEventDraw.cpp:2567`). Att MeOS är godkänt och att upprepade lottningar inte ger snarlika utfall är inte belagt i koden. |
| TR 7.5.4 | DELVIS | UPPFYLLER | Startlistan har banlängd (`lClassLength`, "%s meter") och startplats (`lClassStartName`) per klass (`oListInfo.cpp:4769-4770`), samt nummerlapp, ranking, namn, förening och starttid per löpare (`oListInfo.cpp:4756-4762`). IOF StartList skriver `Course` med `Length` och `StartName` (`iof30interface.cpp:4105-4118`, `iof30interface.cpp:3486-3491`) och `BibNumber` (`iof30interface.cpp:3805`). | Kolumnerna för nummerlapp och ranking visas bara när data finns. Ranking skrivs inte i IOF-exporten (bara inläsning, `iof30interface.cpp:2260`). |
| TR 7.5.5 | SAKNAS | DELVIS | "Lotta klasser med samma bana gemensamt" (`TabClass.cpp:6235`). Reserverade platser för efteranmälda: `getDrawNumReserved` (`oClass.h:469-470`), "Förväntad andel efteranmälda" (`swedish.lng:636`). | Inget begrepp för rankingklass. Standardinställningen tillåter saxning (se TA till TR 6.5.1). |
| TR 7.5.6 med TA | SAKNAS | UPPFYLLER INTE | – | Ingen reservlista. Sökt: "reserv", "Reservlista", "waiting". |
| TR 7.5.7, TR 7.5.8 med TA | DELVIS | UPPFYLLER | Knapparna "Efteranmälda (före ordinarie)" och "Efteranmälda (efter ordinarie)" (`TabClass.cpp:6318-6319`) lottar in efteranmälda utan att flytta de redan lottade. Vakanser kan tas av efteranmälda (`swedish.lng:2093-2094`). | "Lotta om hela klassen" (`swedish.lng:1016`) lottar om allt. Elitklasser hanteras inte särskilt. |
| TR 7.5.9, TA till TR 7.8.2 (kval), TA till TR 7.8.3 (kvalgräns) | SAKNAS | DELVIS | Kval och final: `qualification_final.cpp`, `qf_editor.cpp`, "Kval/final-schema" (`swedish.lng:938`), "Kvalificeringsregler för X" (`swedish.lng:2753`). | Ingen kontroll av 150 minuter mellan kval och final, och ingen kvalgräns i resultatlistan. |
| TR 7.6.1 | DELVIS | DELVIS | SportIdent-avläsning (`SportIdent.cpp`, `TabSI.cpp`), "Avläsning/radiotider" (`TabSI.cpp:80`). | Avläsningen finns. Att systemet är godkänt av SOFT och anges i Eventor ligger utanför programvaran (samma bedömning som för fartOLa). Ingen Emit-kod hittades. |
| TA till TR 7.6.1 (enheternas tid) | SAKNAS | UPPFYLLER INTE | Bara brickans batteri läses (`SportIdent.cpp:1369`, "Batteristatus"). | Enheternas klocka och batteri läses inte. Fel klocka kan korrigeras i efterhand med kontrollens `TimeAdjust` (`oEvent.cpp:290`). Sökt: "clock", "Battery", "SetTime". |
| TA till TR 7.6.1 (backup) | DELVIS | DELVIS | Flera kodsiffror per kontroll (hjälptext i `swedish.lng:2353`), och extra stämplar ger inte fel (`oRunner.cpp:1448-1520`). | Varje löpare har bara en bricka. Ingen sammanslagning av två brickor hittades. |
| TR 7.6.2, TR 8.3.2 | UPPFYLLD | UPPFYLLER | Banan matchas i ordning som delföljd (`oRunner.cpp:1448-1520`, `evaluateCard` på `oRunner.cpp:1155`). Status "Multipel" ger valfri ordning, och rogaining finns (`oControl.h:61-65`). | Täcker även valfri ordning och poängorientering, vilket fartOLa saknar. |
| TA till TR 7.6.2 (bricka saknas) | UPPFYLLD | UPPFYLLER | Status väljs för hand i löparfliken (`TabRunner.cpp:3473-3477`, sparas på `TabRunner.cpp:778`). | Statusen heter "Felst.", inte "Ej godkänd" (se statusraderna). |
| TA till TR 7.6.2 (tekniskt fel) | UPPFYLLD | UPPFYLLER | Kontrollstatus "Trasig" (`StatusBad`) tas bort ur stämplingskontrollen (`oCourse.cpp:465-468`, `swedish.lng:2353`). Per löpare: "Lägg till stämpling" (`TabRunner.cpp:3571`) eller manuell status. | Per kontroll gäller det alla löpare. Ersättningskontroller går att lägga in som extra kodsiffror. |
| TR 7.7.1 med TA | UPPFYLLD | UPPFYLLER | Tjänsten "Onlineresultat" (`onlineresults.cpp:68`) skickar MOP 2.0 (`onlineresults.cpp:131-132`). URL, tävlings-id och "Lösenord:" ställs in i gränssnittet (`onlineresults.cpp:177-180`). |  |
| TR 7.8.2 | UPPFYLLD | DELVIS | IOF ResultList skriver `Course` med `Length` när klassen har en gemensam bana (`iof30interface.cpp:3418-3426`, `iof30interface.cpp:3489-3491`). Standardlistan `EStdResultList` (`oListInfo.cpp:4864`) har inte `lClassLength`. | Eventor-filen uppfyller regeln. Den utskrivna listan för arenan saknar banlängd tills fältet `ClassLength` läggs till i listredigeraren. |
| TA till TR 7.8.2 (per deltagare) | DELVIS | DELVIS | `EStdResultList` har placering, namn, förening och tid (`oListInfo.cpp:4864-4900`). `lRunnerRank` finns som listfält (`oListInfo.cpp:2178`). | Rankingnumret saknas i standardlistan och måste läggas till i listredigeraren. |
| TA till TR 7.8.2 (statusrader) | UPPFYLLD | DELVIS | `formatStatus` (`oEvent.cpp:5660-5700`): "Felst.", "Utg.", "Disk.", "Ej start", "Maxtid", "Utan tidtagning". | Avviker från SOFT på samma sätt som fartOLa: "Felst."/"Utg." i stället för "Ej godkänd", "Disk." i stället för "Diskad", och "Deltagit" saknas. Statusraderna sorteras sist. |
| TA till TR 7.8.2 (Ej start) | UPPFYLLD | UPPFYLLER | Knappen "Sätt okända löpare utan registrering till <Ej Start>" (`TabRunner.cpp:2869`, åtgärden på `TabRunner.cpp:974-986`) och ångra-funktion (`TabRunner.cpp:2871`). "Ej start" (`swedish.lng:411`). | Måste köras för hand från vyn Kvar-i-skogen. |
| TA till TR 7.8.3 (koppling) | EJ TILLÄMPLIG | EJ TILLÄMPLIG | `writePerson` skriver `<Id>` från löparens externa id (`iof30interface.cpp:3896-3906`). | Anvisningen gäller koppling av personer utan identitet i Eventor, som görs i Eventor. `writePerson` skriver befintligt externt id (`iof30interface.cpp:3893-3906`), vilket minskar kopplingsarbetet men inte är kopplingen. |
| TR 7.8.4 med TA | EJ TILLÄMPLIG | EJ TILLÄMPLIG | – | Rapporten görs i Eventor. MeOS laddar bara upp resultatfilen. |

### Kapitel 8. Regler för tävlande

| ID | fartOLa-status | MeOS | MeOS-belägg | Anmärkning |
|---|---|---|---|---|
| TR 8.1.4, TR 8.5.5, TR 8.5.6 | UPPFYLLD | UPPFYLLER | Avläsning (`SportIdent.cpp`, `TabSI.cpp:80`). Utan målstämpel blir statusen minst `StatusDNF` (`oRunner.cpp:1647-1650`). |  |
| TR 8.1.4 (kommentar, manuell stämpling) | SAKNAS | UPPFYLLER | Knappen "<< Lägg till stämpling" (`TabRunner.cpp:3571`), sparas med `savePunchTime` (`TabRunner.cpp:3225-3260`). Stämpeln märks som manuell (`PunchOrigin::Manual`, `oRunner.cpp:1296`). |  |

### Kapitel 10. Åtgärder vid regelöverträdelser

| ID | fartOLa-status | MeOS | MeOS-belägg | Anmärkning |
|---|---|---|---|---|
| TR 10.1.2, TR 10.1.3 | DELVIS | UPPFYLLER INTE | Inget ärenderegister och ingen motivering till manuell status. | Sökt: "protest", "regelanm", "ärende", "påföljd", "besvär". fartOLa sparar i alla fall en motivering i händelseloggen. |
| TR 10.2.2, TR 10.2.3 | EJ TILLÄMPLIG | EJ TILLÄMPLIG | – | Protesten är skriftlig och handläggs av jury eller tävlingsledning; regeln kräver inget register i programmet. Inget protestregister i MeOS (sökt: "protest", "delgivning", "Klagomål"). |
| TR 10.4.2 (diskvalificering), TR 10.4.3 | UPPFYLLD | UPPFYLLER | Status "Disk." sätts för hand (`TabRunner.cpp:3473-3477`). En senare avläsning behåller den eftersom den högre statusen vinner (`oRunner.cpp:1630-1632`, där `StatusDQ` = 5 och `StatusMP` = 3). IOF `Disqualified` (`oRunner.cpp:899-901`). | Texten är "Disk.", inte "Diskad". |
| TR 10.4.2 (tidstillägg) | SAKNAS | UPPFYLLER | `TimeAdjust` "Tidstillägg:" och `PointAdjust` "Poängavdrag:" (`oEvent.cpp:271-272`, `TabRunner.cpp:3455-3458`). Tillägget ingår i löptid, placering och export (`oRunner.cpp:823`). | Kräver MeOS-funktionen "TA" (poängavdrag kräver dessutom rogaining). Intervallet 1–5 minuter kontrolleras inte. |
| TR 10.4.10 | DELVIS | UPPFYLLER | Starttid, måltid och status rättas i löparfliken (`TabRunner.cpp:680-681`, `TabRunner.cpp:3473`). Onlineresultaten skickar ändringen automatiskt, och IOF kan exporteras igen. | Fältet "Måltid:" går bara att ändra utan målstämpel (`TabRunner.cpp:3888`), men målstämpeln kan ändras i stämpellistan (`TabRunner.cpp:3552`, `TabRunner.cpp:3246`). |

## 3. Sammanfattning

| MeOS-status | Antal |
|---|---|
| UPPFYLLER | 36 |
| DELVIS | 26 |
| UPPFYLLER INTE | 7 |
| EJ TILLÄMPLIG | 6 |
| **Totalt** | **75** |

Som jämförelse har fartOLa 25 UPPFYLLD, 21 DELVIS, 24 SAKNAS och 5 EJ TILLÄMPLIG.

MeOS-betygen är rättade efter en oberoende källkodsgranskning (Codex, MeOS 5.0 U3 build 1851, utan att programmet byggts eller körts): TR 3.4.8/4.14.1 (utan tidtagning), TR 4.14.4, TA till TR 4.18.9 och TR 4.23.3 blev UPPFYLLER, och TA till TR 7.8.3 (koppling) och TR 10.2.2/10.2.3 EJ TILLÄMPLIG. Anmärkningarna för TR 4.14.1 (direktanmälan), 4.18.9, 4.20.6, 4.20.7, 4.20.8, 4.20.9, 4.20.10, 4.21.1, 4.21.3, 7.5.2 och 10.4.10 är preciserade. TR 7.6.1 är DELVIS för båda av samma skäl (godkännande och angivelse i Eventor ligger utanför programmet).

Raderna jämförs i ordningen UPPFYLLD/UPPFYLLER > DELVIS > SAKNAS/UPPFYLLER INTE.

**fartOLa ligger före MeOS (8 rader):**

- TR 4.18.9 med TA (sen start): fartOLa räknar tiden från starttiden som standard och varnar för sen start. MeOS gör det bara med "Ej startstämpling" påslaget i varje klass.
- TR 4.20.7: fartOLa avrundar den officiella tiden till hel sekund. MeOS klipper av när tiondelar är påslagna (standard är hela sekunder).
- TR 4.21.1 och TR 4.21.2: i fartOLa gäller tävlingens maxtid alla klasser och låses vid första start. I MeOS kan en klass få ett eget värde, och maxtiden kan ändras när som helst.
- TR 7.5.1 (utan namn): fartOLa lottar inte en tävlande utan namn. I MeOS hittades ingen kontroll.
- TR 7.8.2: resultatskärmen visar klass, bana och längd. MeOS standardlista saknar banlängd.
- TA till TR 7.8.2 (statusrader): fartOLa använder SOFT:s namn ("Ej godkänd", "Diskad", "Ej start", "Deltagit"). MeOS skriver "Felst.", "Utg.", "Disk." och "Godkänd" för utan tidtagning.
- TR 10.1.2, TR 10.1.3: fartOLa sparar en motivering till varje manuell status. MeOS har ingen.

Med samma status har fartOLa dessutom några kvalitativa fördelar. Random-lottningen är en riktig Fisher-Yates, och SOFT-lottningen ger så få grannar från samma förening som möjligt (TR 7.5.1–7.5.2). Flera tidsavvikelser flaggas för juryn som varningar. Kvar-i-skogen bygger på backupminnet i check-enheten.

**MeOS ligger före fartOLa (27 rader, plus TR 7.1.2):**

- Modellering: TR 3.2.1, TR 3.4.4 m.fl., TR 3.4.8/4.14.1 (utan tidtagning per deltagare), TR 3.4.11 (patrull), TR 3.6.3 m.fl. (distrikt), TR 4.14.3 m.fl. (stafett), TR 4.23.1 (ogiltig klass), TR 4.23.3 (avkortad bana).
- Avgifter: TR 4.12.4, TR 4.12.6.
- Rättning och manuell inmatning: TA till TR 4.18.9 (kommentar om ny starttid), TR 4.18.14 och TR 10.4.2 (tidstillägg), TR 4.20.6 (måltid för hand), TR 8.1.4 (manuella stämplar), TR 10.4.10.
- Listor och publicering: TR 4.16.1, TR 4.22.1, TR 7.5.4.
- Lottning: TA till TR 6.5.1 (samma bana eller förstakontroll), TR 7.3.2 (vakanser), TR 7.3.6/7.3.7 (ranking och delning), TR 7.3.8, TR 7.4.1 (jaktstart och bokning), TR 7.4.5 (seedning), TR 7.5.5, TR 7.5.7/7.5.8 (efteranmälda), TR 7.5.9 (kval/final).
- TR 7.1.2: MeOS används som godkänt huvudsystem, vilket fartOLa inte är. Det går inte att belägga i koden.

**Lika (39 rader, varav 5 där båda är EJ TILLÄMPLIG):** antingen har båda funktionen eller så saknar båda den. Gemensamma luckor: stängningstid för målet (TR 4.16.3), målgångsordning vid gemensam start (TR 4.20.8), kontroll av kodsiffror (TA till TR 6.8.2), reservlista (TR 7.5.6) och klockkontroll av enheterna. Nu lika: TR 4.14.4 (samtycket följer av anmälan), TR 7.7.1 (liveresultat med inloggningsuppgifter) och TA till TR 7.8.2 (Ej start: båda sätter ej avlästa till Ej start med en åtgärd och kan ångra).

## 4. MeOS-funktioner som fartOLa saknar utöver regelraderna

Kolumnen fartOLa bygger på en genomgång av `apps/edge`, `apps/web`, `packages/sportident`, `ROADMAP.md` och `REQUIREMENTS.md`. Där den avviker från `soft-regelverk-2026.md` gäller matrisen.

Storlek är en grov uppskattning av arbetet i fartOLa: S är några dagar, M är en till tre veckor och L är mer än en månad.

### 4.1 Sekretariat och tidtagning

| Funktion | Vad det är | Var i MeOS | fartOLa | Storlek |
|---|---|---|---|---|
| Manuell måltid och status vid avläsning | Måltid och Godkänd/Utgått matas in när målstämpel saknas. | Kryssrutan "Manuell inmatning" i SI-fliken (`TabSI.cpp:2324`). Fältet "Måltid:" i löparfliken (`TabRunner.cpp:3446`). | Nej. Manuell status finns (`routes/manual.ts`), men ingen måltid (TR 4.20.6). | S |
| Manuella stämplar | Stämplar läggs till från startkort eller stiftklämma. | "<< Lägg till stämpling" (`TabRunner.cpp:3571`). | Nej (TR 8.1.4). | S |
| Tidstillägg och poängavdrag | Minuter eller poäng per löpare, som ingår i resultatet. | "Tidstillägg:" och "Poängavdrag:" (`TabRunner.cpp:3455-3458`), MeOS-funktionen "TA". | Nej (TR 10.4.2). | S |
| Kontroll inför tävlingen | Rapport över löpare utan bricka, starttid, klass, bana eller klubb, och brickor med för få stämplingsplatser för banan. | "Kör kontroll inför tävlingen..." (`TabList.cpp:2933`, `oReport.cpp:341`). | Nej. | S |
| Interaktiv avläsning och oparade brickor | Okänd bricka sparas och kopplas till en löpare i efterhand. Ny klass och bana kan skapas från brickdata. | "Spara oparad bricka", "Knyt bricka / deltagare" (`TabSI.cpp:3939`). | Delvis. Walk-up på okänd bricka och kö (`apps/web/src/lib/screens/WalkupModal.svelte`). | S |
| Fler arbetsstationer mot en databas | Flera MeOS-datorer arbetar mot samma MySQL-tävling. | "Databasanslutning..." (`TabCompetition.cpp:2539`), `MeosSQL.cpp`. | Delvis. Flera webbklienter mot en edge-server. Peer-sync är planerad till Fas 4 (REQ-EVT-005/006). | L |
| Säkerhetskopiering och återställning | Kopia till mapp med jämna mellanrum. Återställning från listan. | Automaten "Säkerhetskopiering", "Återställ säkerhetskopia..." (`TabCompetition.cpp:2544`). | Delvis. Daglig SQLite-kopia (`backup/daily.ts`). Återställning är inte verifierad. | S |
| Stämplingstest | Simulerar avläsningar och radiostämplingar mot en testtävling. | Automaten "Stämplingstest" (`TabAuto.cpp:1410`). | Nej. Det finns replay-fixturer i testerna men inget verktyg i gränssnittet. | M |

### 4.2 Listor och rapporter

| Funktion | Vad det är | Var i MeOS | fartOLa | Storlek |
|---|---|---|---|---|
| Utskrift, HTML och PDF av listor | Varje lista kan skrivas ut, sparas som HTML (med AutoRefresh) eller PDF. | "Skriv ut...", "Webb...", "PDF..." (`TabList.cpp:150-161`), `pdfwriter.cpp`, `HTMLWriter.cpp`. | Nej. Export finns bara som IOF XML. Termoskrivaren skriver kvitton, men startlistmallen är inte kopplad (TR 4.16.1). | M |
| Standardlistor | Start- och resultatlistor per klass, klubbstartlista, klubbresultat, minutstartlista, sträcktider. | Listor-fliken (`TabList.cpp:2644`), `oEvent::generateMinuteStartlist` (`oEvent.cpp:3614`). | Delvis. Resultat och sträcktider på skärm (`ResultsView.svelte`), inga utskrivbara listor. | M |
| Prisutdelningslista | Avgjorda placeringar med klockslag då placeringen är avgjord. | "Prisutdelningslista" (`TabList.cpp:2930`, `EIndPriceList` på `oListInfo.cpp:4992`). | Nej. | S |
| Tävlingsstatistik | Antal per klasstyp och distrikt, underlag för tävlingsrapporten. | `generateCompetitionReport` (`oReport.cpp:56`). | Nej. | S |
| Listredigerare | Egna listor med fält, filter, bilder och sortering, sparade som XML. | "Redigera lista..." (`TabList.cpp:3033`), `listeditor.cpp`, `metalist.cpp`. | Nej. | L |
| Resultatmoduler | Egna resultatberäkningar skrivna i ett skriptspråk. | "Result Modules..." (`TabList.cpp:3037`), `generalresult.cpp`, `methodeditor.cpp`. | Nej. | L |
| Automatisk resultatutskrift och export | Skriver ut ändrade sidor eller exporterar HTML/XML med jämna mellanrum, och kör eventuellt ett skript efteråt. | Automaten "Resultatutskrift / export" (`TabAuto.cpp:1408`, `printresultservice.cpp`). | Nej. | M |
| Sträcktidsutskrift med valbar lista | Lista per klass för sträcktidslappen, A4-format, egna textrader. | "Sträcktidsutskrift" (`TabSI.cpp:2318`), inställningar i `TabList.cpp:3059`. | Ja. ESC/POS med sex mallar (`print/templates.ts`). A4 saknas. | S |

### 4.3 Anmälan, ekonomi och hyrbrickor

| Funktion | Vad det är | Var i MeOS | fartOLa | Storlek |
|---|---|---|---|---|
| Anmälningsläge med avgift | Direktanmälan där brickan läses och avgift, hyrbricka och betalsätt fylls i. | "Anmälningsläge" (`TabSI.cpp:84`), fälten i `TabSI.cpp:3639-3780`. | Delvis. `WalkupModal.svelte` och `POST /api/competitors`, utan avgift. | M |
| Avgiftsmodell | Klassavgift, sen avgift i två steg, reducerad avgift efter ålder, brickhyra. | `oEvent.cpp:136-149`, `oEvent.cpp:348-353`, `oClass::getEntryFee` (`oClass.cpp:3206`), "Avgifter..." (`TabClub.cpp:652`). | Nej. REQ-OUT-005 tar bort betalningshantering, men inte registrering av avgifter. | M |
| Fakturor per klubb | Fakturor till klubbarna som utskrift, HTML eller PDF, med fakturanummer och betalningsuppgifter. | "Faktura", "Fakturainställningar...", "Skapa fakturor..." (`TabClub.cpp:641-655`), `oClub.cpp:707`. | Nej. | M |
| Betalning före resultat | Löparen är diskad tills avgiften betalats. | "Kräv betalning innan resultatet godkänns" (`oRunner.cpp:7394`). | Nej. | S |
| Startbevis | Lapp med starttid, bricka, avgift och betalning vid direktanmälan. | "Startbevis" (`TabSI.cpp:2321`), `oRunner::printStartInfo` (`oRunner.cpp:5611`). | Nej. Kvitto finns bara vid avläsning. | S |
| Hyrbrickor | Förregistrering av klubbens hyrbrickor, automatisk hyrflagga och avstämning genom att stämpla de återlämnade brickorna. | "Registrera hyrbrickor", "Tilldela hyrbrickor", "Avstämning hyrbrickor" (`TabSI.cpp:81-83`), "Hyrbricksrapport". | Delvis. Utlämning, kontakt och återlämning finns (`routes/hiredCards.ts`, `ActiveHyrbrickorView.svelte`). Förregistrering och stämpelavstämning saknas. | S |
| Löpardatabas | Egen databas med personer och klubbar, import från IOF XML och OE-CSV, uppdatering från Eventor, autokomplettering. | "Löpardatabasen" (`TabCompetition.cpp:2704`), `RunnerDB.cpp`. | Delvis. Eventor-cache med autokomplettering (`eventor/cache.ts`). Ingen import av egna register. | S |
| Fri anmälningsimport | Inklistrad fritext tolkas till anmälningar. | "Fri anmälningsimport" (`TabCompetition.cpp:2689`), `oFreeImport.cpp`. | Nej. | M |
| Webbanmälan | Anmälan via webben mot MeOS informationsserver, med behörighet per klass. | `restserver.cpp:375` (`entry`), `restserver.cpp:401` (`enter`), "Tillåt anmälan". | Nej. | M |
| Boka starttid (kiosk) | Löparen väljer en ledig starttid på en självbetjäningsskärm. | "Boka starttid" (`TabSI.cpp:86`), "Aktivera kioskläge" (`TabSI.cpp:5781`), `oEvent::requestStartTime` (`oEventDraw.cpp:3169`). | Nej. | M |

### 4.4 Lottning och startplanering

| Funktion | Vad det är | Var i MeOS | fartOLa | Storlek |
|---|---|---|---|---|
| Lotta flera klasser med startfördelning | Fördelar första start över klasser så att startflödet blir jämnt och samma bana eller förstakontroll inte startar samtidigt. Önskemål tidig, sen eller angiven tid per klass. | "Lotta flera klasser" (`TabClass.cpp:1749`), "Fördela starttider", `oEvent::optimizeStartOrder` (`oEventDraw.cpp:1390`). | Nej. Lottningen görs per klass (`routes/lottning.ts`). | L |
| Efteranmälda före eller efter | Lottar in efteranmälda utan att de redan lottade flyttas. | "Efteranmälda (före ordinarie)", "(efter ordinarie)" (`TabClass.cpp:6318-6319`), `drawRemaining` (`oEventDraw.cpp:1705`). | Nej. Omlottning nollställer klassen. | M |
| Vakanser som platser | Vakanser är egna poster med starttid och kan ges till efteranmälda. | "Andel vakanser" (`TabClass.cpp:1763`), "Tillsätt ytterligare vakans" (`TabRunner.cpp:2699`). | Delvis. Luckor i SOFT-läget (`draw/soft.ts`), som inte går att boka. | S |
| Seedning och seedningsgrupper | Lottning efter ranking, resultat eller tid, med grupper. | "Seedad lottning", "Seedningsgrupper:" (`TabClass.cpp:575`). | Nej. | M |
| Nummerlappar | Automatisk eller manuell numrering per klass. | "Nummerlappar..." (`TabClass.cpp:4563`). | Nej. | S |
| Startgrupper | Löpare lottas in i namngivna startgrupper. | "Startgrupper" (`TabClass.cpp:4627`), `drawListStartGroups` (`oEventDraw.cpp:1875`). | Nej. | M |
| Dela och slå ihop klasser | Klassen delas per klubb, ranking, resultat eller i jämna delar. | "Dela klassen..." (`TabClass.cpp:4603`), `oClass.cpp:2231-2241`. | Nej. | M |
| Klungstart och parstart | Starter i grupper eller par. | `DrawMethod::Clumped` (`oEvent.h:554`), "Tillämpa parstart". | Nej. | S |
| Start på signal | Klassen startar när funktionären trycker. | "Start på signal..." (`TabClass.cpp:6530`). | Nej. | S |

### 4.5 Tävlingsformer

| Funktion | Vad det är | Var i MeOS | fartOLa | Storlek |
|---|---|---|---|---|
| Stafett, patrull och lag | Sträckor, parallella sträckor, växling, omstart, repdragning, laguppställning. | Fördefinierade upplägg (`oTeamEvent.cpp:328`), Lag-fliken (`TabTeam.cpp`), "Omstart..." (`TabClass.cpp:1360`). | Nej. Planerat i REQ-EVT-CMP-009 och 011 (Fas 4). | L |
| Rogaining och poängorientering | Poäng per kontroll, tidsgräns, poängavdrag per minut. | Banfältet "Rogaining" (`TabCourse.cpp:1120`), kontrollpoäng i `TabControl.cpp`. | Nej. Planerat i REQ-EVT-CMP-010 (Fas 4). | M |
| Flera etapper och totalresultat | Länkade etapptävlingar, överföring av resultat, total- och etappresultat, jaktstart. | "Hantera flera etapper" (`TabCompetition.cpp:2709`), "Hantera jaktstart" (`TabClass.cpp:1791`). | Nej. Bara indirekt i Fas 5 (O-ringen). | L |
| Kval och final | Kvalklasser med regler för vilka som går till vilken final, och knockout. | "Kval/final-schema", `qualification_final.cpp`, `qf_editor.cpp`. | Nej. | L |
| Gafflingar och valfri ordning | Gafflade banor och kontroller med status "Multipel". | "Gafflingar i tabellformat", `oControl.h:61-65`. | Nej. | M |

### 4.6 Speaker och publik

| Funktion | Vad det är | Var i MeOS | fartOLa | Storlek |
|---|---|---|---|---|
| Speakermodul | Bevakning av kontroller, tidslinje med prognos, rapportläge och rullande tider. | Speaker-fliken (`TabSpeaker.cpp:1060-1084`): "Tidsinmatning", "Rapportläge", "Direkt tidtagning". `oEventSpeaker.cpp`, `speakermonitor.cpp`. | Nej. Planerat i REQ-UI-009 (Fas 3). | L |
| Förvarningsröst | Uppläsning av inkommande löpare vid förvarningskontroll. | Automaten "Förvarningsröst" (`TabAuto.cpp:772`). | Nej. | M |
| Resultatkiosk | Helskärm som visar resultatet för den senast avlästa löparen. | "Resultatkiosk" (`TabRunner.cpp:1889`). | Nej. Kids' finish är planerad i Fas 3. | S |

### 4.7 Integrationer, protokoll och format

| Funktion | Vad det är | Var i MeOS | fartOLa | Storlek |
|---|---|---|---|---|
| Onlineresultat | MOP 1.0/2.0 och IOF XML till en URL eller mapp, med tävlings-id och lösenord i gränssnittet. | Automaten "Resultat online" (`onlineresults.cpp:131-180`). | Delvis. MOP-push till liveresultat med tävlings-id och lösenord i Inställningar (`integrations/liveresultat/`, TR 7.7.1); ingen IOF-export till URL eller mapp. | S |
| Inmatning online | Radiostämplingar och anmälningar från MIP, ROC eller SportIdent Center. | Automaten "Inmatning online" (`onlineinput.cpp:187-189`). | Nej. Planerat i REQ-STD-005 och 006 (Fas 4). | M |
| Radiotider från SI-master | Stämplar som skickas direkt till mastern blir mellantider. | Läget "Avläsning/radiotider" (`TabSI.cpp:80`). | Nej. Planerat i REQ-HW-005 (Fas 4). | M |
| SI över TCP | Stämplar och avläsningar tas emot på TCP-port 10000. | `MonitorTCPSI` (`SportIdent.cpp:790`). | Nej. | S |
| Informationsserver (REST) | HTTP-tjänst med `?get=iofresult`, `iofstart`, `competitor`, `result`, uppslag i löpardatabasen och MOP-differenser. | `restserver.cpp:142` och `restserver.cpp:375-451`, automaten "Informationsserver". | Delvis. REST och WS för LAN-klienter, inget publikt API. Ett flöde för OBS/vMix är planerat i REQ-UI-010. | M |
| Fler filformat | IOF XML 2.0.3, OE/OS-CSV, OCAD-CSV för banor, CSV för ranking och laguppställningar. | `importformats.cpp:44`, `csvparser.cpp`. | Delvis. IOF XML 3.0 samt banor från Purple Pen och IOF CourseData. CSV saknas. | M |
| Stämplar från fil | Avläsningar och stämplar från filer från SI Config+ och SIMAN. | "Importera från fil..." (`TabSI.cpp:2369`), `csvparser.cpp:816`. | Delvis. Backupminnet läses direkt från enheten (`packages/sportident/src/SiStation/readBackup.ts`). | S |
| Mer Eventor | Tävling skapas från Eventor, löpardatabasen uppdateras. | "Tävling från Eventor..." (`TabCompetition.cpp:2538`), "Uppdatera löpardatabasen". | Delvis. Anmälningar hämtas och listor laddas upp. | S |
| WinSplits | Sträcktider exporteras till WinSplits. | Automaten "Export av resultat/sträcktider" (`TabAuto.h:319`). | Nej. | S |

## 5. Tio MeOS-funktioner att bygga först

Urvalet utgår från luckorna i `soft-regelverk-2026.md` ("Störst luckor") som MeOS redan har löst. Det är filtrerat till en individuell tävling på nivå 2–3 och ordnat efter hur mycket luckan blockerar en sanktionerad tävling, och därefter efter storlek.

På grenen `feat/soft-small-gaps` är punkt 3 (person-id och banlängd), 6 (onlineresultat) och maxtidsdelen av 7 gjorda, liksom "Ej start" för ej avlästa och SOFT:s benämningar i punkt 4. Kvar i punkt 4 är "Utan tidtagning" per löpare.

1. **Manuell inmatning i sekretariatet (S).** Det gäller måltid för hand, manuella stämplar och tidstillägg som ingår i tid, placering och export (TR 4.20.6, TR 8.1.4, TR 4.18.14, TR 10.4.2, TR 10.4.10). Förebilder i MeOS: "Måltid:", "<< Lägg till stämpling" och "Tidstillägg:" i löparfliken. Utan detta går en vanlig tävlingsdag inte att avsluta när en målenhet krånglar eller en tjuvstart döms.
2. **Utskrivbara listor för arenan (M).** Start-, resultat-, minutstart-, Kvar-i-skogen- och prisutdelningslista som utskrift, HTML och PDF, med banlängd och startplats (TR 4.16.1, TR 4.21.3, TR 7.5.4, TR 7.8.2). Förebild: Listor-fliken med "Skriv ut...", "Webb..." och "PDF...".
3. **Eventors person-id och banlängd i IOF-exporten (S).** `<Id>` per person (`iof30interface.cpp:3896-3906`) och `Course/Length` per klass (TA till TR 7.8.3, TR 7.8.2). Utan dem kopplas resultaten för hand i Eventor, och Sverigelistan påverkas.
4. **"Ej start" för alla ej avlästa, och statusbenämningar (S).** Sätt alla som inte lästs till Ej start i ett steg med ångra-funktion (som MeOS "Sätt okända löpare utan registrering till <Ej Start>"), och "Utan tidtagning" per löpare (TA till TR 7.8.2, TR 3.4.8). Här kan fartOLa gå förbi MeOS genom att använda SOFT:s ord: "Ej godkänd", "Diskad", "Deltagit".
5. **Efteranmälda utan omlottning, och vakanser som går att boka (M).** Efteranmälda läggs före eller efter de ordinarie eller i vakanta platser, utan att någon annan flyttas (TR 7.5.7, TR 7.5.8, TR 7.3.2). Förebild: "Efteranmälda (före/efter ordinarie)" och vakanser som egna poster.
6. **Inställningar för onlineresultat (S).** URL, tävlings-id och lösenord för liveresultat i gränssnittet, så att den befintliga MOP-pushen kan köras (TR 7.7.1). Förebild: "Resultat online".
7. **Gemensam maxtid och ogiltigförklarad klass (S).** En maxtid på tävlingsnivå som klasserna ärver (MeOS "Gräns för maxtid"), gärna låst efter första start, vilket MeOS inte har (TR 4.21.1, TR 4.21.2). Dessutom en klasstatus "ogiltig" som tar bort placeringarna och exporteras som `Invalidated` (TR 4.23.1).
8. **Startplanering över klasser (L).** Varning och optimering för samma bana och samma förstakontroll vid samma starttid, och fördelning av första start per klass (TA till TR 6.5.1, TR 7.5.3, TR 7.5.5). Förebild: "Lotta flera klasser" med "Fördela starttider" och `optimizeStartOrder`. Börja med varningarna (S) och bygg optimeringen senare.
9. **Klasstyp, födelseår och direktanmälan per klass (M).** Klasstyp (elit, ålder, ungdom, öppen, inskolning), födelseår per tävlande och en markering per klass om direktanmälan är tillåten (TR 3.4.2, TR 3.4.4, TR 4.14.1, TR 7.4.2). MeOS har fälten men kopplar dem inte till reglerna. fartOLa kan låta klasstypen styra spärrarna direkt.
10. **Avgifter vid direktanmälan och klubbfakturor (M).** Klassavgift, efteranmälningsavgift, brickhyra bara för hyrbricka och faktura per klubb (TR 4.12.4, TR 4.12.6). Förebild: avgiftsfälten och "Skapa fakturor..." i Klubbar-fliken. Taket per klasstyp och undantaget för öppna ungdomsklasser kan byggas in från början, vilket MeOS saknar. Betalningshantering ligger kvar utanför (REQ-OUT-005).

Med i bedömningen men utanför topp tio: kontroll inför tävlingen (S, liten och nyttig), startbevis (S), seedning och nummerlappar (M, behövs främst på nivå 1) samt flera arbetsstationer mot en gemensam databas (L, redan planerat). Stafett, patrull, speaker och etapper är stora MeOS-funktioner, men de behövs inte för en individuell tävling på nivå 2–3 och finns redan i Fas 3–5.
