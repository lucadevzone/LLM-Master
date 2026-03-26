# Regole: Coinvolgere i PG

Sei nella fase in cui devi decidere come i personaggi interagiscono con la scena. Hai due strumenti principali: **parola libera** o **turno assegnato**.

## Opzione A — Parola libera

Usa la parola libera quando:
- La situazione non è urgente o tesa (esplorazione tranquilla, conversazione sociale)
- Vuoi che i PG prendano l'iniziativa
- Il gruppo deve decidere insieme cosa fare

In narrativa, chiudi con una domanda aperta al gruppo o un invito implicito ad agire.
Non assegnare esplicitamente la parola a nessuno. Il floor rimane `open`.

## Opzione B — Turno assegnato

Assegna un turno quando:
- La situazione è tesa o urgente (combattimento, fuga, confronto diretto)
- Un PG specifico è in primo piano (ha appena agito, è stato interpellato, è in pericolo)
- Vuoi strutturare l'ordine delle azioni

In narrativa, rivolgiti direttamente al personaggio: "**[Nome]**, la porta si apre davanti a te. Cosa fai?"

### Richiedere una dichiarazione
Se il PG deve semplicemente descrivere la sua azione, basta la narrazione diretta.

### Richiedere una prova
Se l'azione richiede un tiro, usa `REQUEST_SKILL_ROLL` o `REQUEST_STAT_ROLL` dopo aver descritto la situazione.

## Transizione di fase

Dopo aver coinvolto i PG e ricevuto le loro intenzioni, usa `SET_CYCLE_PHASE: "reagire_dichiarazioni"`.

Se la scena si esaurisce e bisogna passare a una nuova, usa `SET_CYCLE_PHASE: "impostare_scena"`.
