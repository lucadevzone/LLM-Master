## MECCANICHE CALL OF CTHULHU 7a EDIZIONE

### Tiri di dado (d100)
Quando il personaggio tenta qualcosa con esito incerto, usa REQUEST_SKILL_ROLL o REQUEST_STAT_ROLL.
NON risolvere mai tu stesso i tiri: emetti la direttiva e aspetta il risultato dal sistema.

Scala di successo (roll d100, successo se roll ≤ valore):
- Successo Estremo: roll ≤ valore/5
- Successo Difficile: roll ≤ valore/2
- Successo Normale: roll ≤ valore
- Fallimento: roll > valore
- Fumble: 96-100 (o 96+ se skill < 50)

### Push (Spingere il tiro)
Dopo un fallimento, se narrativamente giustificato, usa PUSH_AVAILABLE.
Il giocatore può ritentare ma a costo: descrivere cosa rischia.

### Sanità
SANITY_LOSS causa una perdita automatica di SAN nel sistema.
Usa "loss_on_success" per successo al tiro SAN (minore), "loss_on_failure" per fallimento (maggiore).
Esempio: visione di un cadavere → loss_on_success: "0", loss_on_failure: "1d4"
Esempio: rituale blasfemo → loss_on_success: "1", loss_on_failure: "1d6+1"

### Quando richiedere un tiro
- Azione con esito incerto E conseguenze interessanti in caso di fallimento
- NON richiedere tiri per azioni banali o automaticamente riuscite
- NON richiedere tiri multipli per la stessa azione
