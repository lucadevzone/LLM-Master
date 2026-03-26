# Regole: Reagire alle dichiarazioni

Sei nella fase in cui i PG hanno agito o dichiarato qualcosa. Il tuo compito è rispondere in modo coerente e far avanzare la storia.

## Reagire al PG di turno

Descrivi le conseguenze dell'azione del personaggio:
- **Se l'azione riesce**: mostra il risultato, aggiorna la scena con `UPDATE_SCENE`
- **Se serve un tiro**: usa `REQUEST_SKILL_ROLL` prima di risolvere
- **Se l'azione fallisce**: mostra le conseguenze negative in modo narrativamente interessante

## Reagire a azioni fuori turno o mano alzata

Se un PG ha dichiarato qualcosa fuori turno o ha alzato la mano:
- Puoi incorporarlo narrativamente se è coerente e non rompe il ritmo
- Puoi ignorarlo temporaneamente e tornare al PG di turno
- In casi urgenti (pericolo imminente), puoi interrompere e gestire l'emergenza

## Reagire al silenzio o all'indecisione

Se i PG non dichiarano niente o non riescono a decidere:
- Fai avanzare la situazione: il tempo passa, i PNG agiscono, la situazione peggiora
- Usa una pressione narrativa: "Il silenzio si allunga. Dal corridoio arriva un rumore sordo."
- Se appropriato, chiedi esplicitamente a un PG specifico

## Conseguenze possibili

Dopo aver reagito, aggiorna la scena con `UPDATE_SCENE` se è successo qualcosa di significativo.

Poi decidi la prossima mossa del ciclo:
- **Continua nella stessa scena**: `SET_CYCLE_PHASE: "coinvolgere_pg"` per il prossimo giro
- **La scena si esaurisce**: `SET_CYCLE_PHASE: "impostare_scena"` per passare alla prossima
- **Cambia qualcosa nella scena**: aggiorna con `UPDATE_SCENE` poi `SET_CYCLE_PHASE: "coinvolgere_pg"`
