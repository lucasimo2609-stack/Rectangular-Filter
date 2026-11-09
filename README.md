# Rectangular Filter

Web app per **PC, iPad e smartphone** che usa la webcam o la fotocamera, riconosce le mani e crea un **rettangolo dinamico** con le punte di **pollici e indici**. Dentro il rettangolo viene applicato il filtro che scegli, come nei reel fatti con TouchDesigner.

- Gira tutta nel browser: niente da installare e nessuna immagine inviata a server.
- Riconoscimento mani con [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) (fino a 2 mani, 21 punti ciascuna).
- Filtri in WebGL in tempo reale, ritagliati sul quadrilatero formato dalle dita.
- **Gesto ✊ → ✌️**: chiudi la mano a pugno, poi fai la V con indice e medio. La tua persona si sfoca e sparisce e resta solo lo sfondo. Rifai il gesto per riapparire.

## Come si usa

1. Apri l'app e premi **Avvia fotocamera** (concedi il permesso alla fotocamera).
2. Mostra le mani alla fotocamera:
   - **Due mani**: i due **indici** sono gli angoli in alto e i due **pollici** quelli in basso, come nel reel. Muovendo le mani il quadrilatero si deforma, si ruota e può anche incrociarsi.
   - **Una mano**: pollice e indice diventano due angoli opposti di un rettangolo. Allargali o avvicinali per cambiarne la dimensione.
   - Se chiudi le dita (pollice contro indice) il rettangolo sparisce.
3. Scegli il filtro dalla barra in basso.
4. Con il pulsante bianco scatti una **foto**. Su iPad, *Salva / Condividi* ti permette di salvarla nel Rullino.

> Senza mani puoi anche **trascinare col dito o col mouse** per disegnare un rettangolo, utile per provare i filtri. Un tocco senza trascinare lo cancella.

### Sparire con un gesto: pugno ✊ poi V ✌️

1. Metti il dispositivo **fermo** (su un supporto o un treppiede).
2. Chiudi una mano a **pugno** ✊ per un attimo. In alto compare *"✊ ok · ora ✌️ per sparire"*.
3. Entro un secondo e mezzo apri **indice e medio a V** ✌️. Con una sfocatura veloce (circa mezzo secondo) la tua persona sparisce e resta **solo lo sfondo**, su tutta l'immagine e non dentro il rettangolo.
4. Per **riapparire** rifai lo stesso gesto: ✊ e poi ✌️.

- La prima volta l'app non conosce ancora lo sfondo vuoto. Al primo gesto parte da sola un conto alla rovescia: **esci dall'inquadratura**, lo sfondo viene catturato e quando rientri sei già invisibile.
- Mentre sei invisibile il rettangolo e i punti delle mani vengono disattivati, così non ti tradiscono.
- La scena resta **dal vivo**: l'app riconosce la tua sagoma (segmentazione MediaPipe), confronta l'immagine con lo sfondo salvato e sostituisce solo i pixel che appartengono a te, comprese ombre e oggetti che tieni in mano.
- Puoi attivarlo anche con il pulsante a forma di **fantasmino** in alto o con il tasto `V`. Il gesto si spegne da *Impostazioni › Gesto ✊ → ✌️*.

### Effetto "Invisibile" (sparire dentro il rettangolo)

1. Metti il dispositivo **fermo** (su un supporto o un treppiede).
2. Premi l'icona **Cattura sfondo** in alto a destra (oppure scegli il filtro *Invisibile*): parte un conto alla rovescia, durante il quale **esci dall'inquadratura**.
3. Quando lo sfondo vuoto è stato salvato, rientra e fai il rettangolo con le mani: tutto ciò che c'è dentro viene sostituito dallo sfondo e il tuo corpo "sparisce".

Consigli: luce costante, niente oggetti che si muovono sullo sfondo, fotocamera immobile. Se cambi fotocamera devi ricatturare lo sfondo.

### Filtri disponibili

| # | Filtro | Effetto |
|---|--------|---------|
| 1 | Acido | Colori psichedelici animati in stile reel |
| 2 | Bianco e nero | Scala di grigi con un po' di contrasto |
| 3 | Invisibile | Mostra lo sfondo catturato, così sparisci |
| 4 | Termico | Look da termocamera |
| 5 | Negativo | Colori invertiti |
| 6 | Pixel | Pixel art a blocchi |
| 7 | Neon | Contorni luminosi colorati su nero |
| 8 | Glitch | Separazione RGB, strappi e scanline |
| 9 | Fumetto | Colori piatti, contorni neri e retino |
| 0 | Sfocato | Sfocatura forte, utile anche per la privacy |
| – | Raggi X | Negativo azzurro con contorni |
| – | Caleidoscopio | Specchi radiali attorno al centro del rettangolo |

### Impostazioni (icona con i cursori)

- **Forma**: automatica (1 o 2 mani), solo due mani, oppure una mano.
- **Gesto ✊ → ✌️** per sparire e riapparire (attivo o disattivo).
- **Applica il filtro**: dentro o **fuori** dal rettangolo (anche con il pulsante a sinistra dello scatto).
- Mostra/nascondi i punti delle mani, bordo del rettangolo, effetto specchio.
- **Stabilizzazione**: riduce il tremolio degli angoli (One Euro filter).
- **Sfumatura bordi**, **timer cattura sfondo**, **qualità di rendering**.
- **Motore riconoscimento mani**: *Automatico* (GPU, con passaggio alla CPU in caso di errore), *GPU* o *CPU*. Se su un dispositivo le mani non vengono riconosciute, prova *CPU*.

### Scorciatoie da tastiera (PC)

`1`–`9`, `0` filtri · `←` `→` filtro precedente/successivo · `V` sparisci/riappari · `B` cattura sfondo · `I` dentro/fuori · `P` o `Spazio` foto · `C` cambia fotocamera · `S` impostazioni · `H` nascondi interfaccia · `F` schermo intero · `Esc` chiudi

## Estensione per Google Meet e Microsoft Teams

La stessa app è anche un'**estensione per Chrome e Edge**: applica il filtro alla tua webcam dentro le videochiamate, così gli altri partecipanti vedono il rettangolo, i filtri e la sparizione.

Funziona su:

- **Google Meet** (`meet.google.com`);
- **Microsoft Teams nel browser** (`teams.microsoft.com`, `teams.live.com`, `teams.cloud.microsoft`).

> **Teams desktop non è supportato**: l'app installata sul computer non accetta estensioni del browser. Entra nella riunione da Chrome o Edge ("Continua in questo browser").

### Installazione

1. Scarica il progetto (**Code › Download ZIP** su GitHub) ed estrai la cartella.
2. Apri `chrome://extensions` (su Edge `edge://extensions`).
3. Attiva **Modalità sviluppatore**.
4. Premi **Carica estensione non pacchettizzata** e scegli la cartella del progetto, quella che contiene `manifest.json`.

### Uso

1. Apri una riunione su Meet o Teams e accendi la webcam. Se la pagina era già aperta, ricaricala.
2. In basso a destra compare il pannello **Rectangular Filter** con l'anteprima e i filtri. Si può trascinare, ingrandire (⤢) e ridurre a icona (—).
3. Tutto funziona come nell'app: rettangolo con pollici e indici, gesto ✊ → ✌️ per sparire, cattura dello sfondo.
4. **Filtro: ON/OFF** nel pannello (o nel popup dell'estensione) riporta subito la webcam normale.
5. Dall'icona dell'estensione puoi anche aprire **l'app a tutto schermo** in una scheda, senza server e senza internet.

Note:

- Nell'anteprima ti vedi a specchio; agli altri arriva l'immagine non specchiata, come per una webcam normale.
- Se il pannello è lento o non risponde, l'estensione fa passare la webcam originale: la chiamata non resta mai senza video.
- L'estensione chiede solo il permesso `storage` (per ricordare ON/OFF) e funziona solo sui siti elencati sopra. Le immagini restano sul computer.

## Avvio

Il browser concede la fotocamera solo su **HTTPS** oppure su **`http://localhost`**, quindi aprire `index.html` con un doppio clic non basta: serve un piccolo server.

### Sul PC (Windows, macOS, Linux)

Dalla cartella del progetto:

```bash
python3 -m http.server 8000
# oppure
npx serve .
```

Poi apri <http://localhost:8000> in Chrome, Edge, Safari o Firefox.

### Su iPad o smartphone (iPhone, Android)

Serve un indirizzo **https://**. Il modo più semplice è **GitHub Pages**, già configurato in questo repository:

1. Su GitHub: **Settings › Pages › Build and deployment › Source: GitHub Actions**.
2. Ogni push sul branch principale pubblica l'app (workflow `.github/workflows/pages.yml`). Puoi anche lanciarlo a mano da **Actions › Pubblica su GitHub Pages › Run workflow**.
3. Apri su iPad, in Safari, `https://lucasimo2609-stack.github.io/Rectangular-Filter/`.
4. *(Facoltativo)* Condividi › **Aggiungi alla schermata Home**: l'app si apre a schermo intero come un'app normale.

> Con un account GitHub gratuito, GitHub Pages funziona solo se il repository è **pubblico**. In alternativa puoi trascinare la cartella su [Netlify Drop](https://app.netlify.com/drop), oppure usare Vercel o Cloudflare Pages: tutti offrono HTTPS gratis.

Requisiti: iPadOS/iOS 16.4 o successivo (Safari), Chrome su Android, oppure un browser recente su PC. Al **primo avvio** serve internet per scaricare i modelli (mani ~8 MB, sagoma ~250 KB) e la libreria MediaPipe. Dopo, il browser li tiene in cache.

## Risoluzione problemi

- **"Permesso fotocamera negato"**: su iPad vai in *Impostazioni › Safari › Fotocamera* e scegli *Chiedi* o *Consenti*. Su PC usa l'icona del lucchetto nella barra degli indirizzi.
- **Le mani non vengono riconosciute**: serve più luce e le mani devono essere ben visibili, non troppo vicine al bordo. Prova *Impostazioni › Motore: CPU*, oppure apri l'app con `?cpu` in fondo all'indirizzo.
- **Va a scatti**: imposta *Qualità di rendering: Bassa* e chiudi le altre app o schede che usano la fotocamera.
- **"Invisibile" o la sparizione lasciano aloni**: ricattura lo sfondo con la stessa luce e la fotocamera ferma. L'esposizione automatica della fotocamera può cambiare un po' i colori.
- **Il gesto ✊ → ✌️ non scatta**: tieni la mano rivolta verso la fotocamera, fai un pugno ben chiuso e una V con le dita ben aperte. Fai la V entro circa 1,5 secondi dal pugno.

## Come funziona (computer vision)

La spiegazione completa di come funzionano riconoscimento delle mani, filtro One Euro, maschera del quadrilatero, filtri, riconoscimento dei gesti e sparizione, con formule e schemi, è in [`docs/computer-vision.pdf`](docs/computer-vision.pdf). Il sorgente LaTeX è [`docs/computer-vision.tex`](docs/computer-vision.tex) e si compila con `pdflatex` (servono i pacchetti `babel-italian`, `tikz` e `listings`).

## Struttura del progetto

```
index.html              interfaccia
css/style.css           stile
js/main.js              avvio, fotocamera, geometria del rettangolo, UI
js/tracker.js           MediaPipe Hand Landmarker (GPU/CPU)
js/gestures.js          riconoscimento pose (pugno, V) e sequenza ✊ → ✌️
js/segmenter.js         segmentazione della persona per la sparizione
js/renderer.js          WebGL: video, sparizione, maschera del quadrilatero (SDF), filtro
js/filters.js           elenco filtri e codice GLSL di ciascuno
js/smoothing.js         One Euro filter per stabilizzare gli angoli
js/capture.js           foto
manifest.json           estensione per Chrome / Edge
extension/              script dell'estensione (aggancio alla webcam, pannello, popup)
vendor/                 MediaPipe e modelli inclusi nell'estensione (licenza Apache 2.0)
manifest.webmanifest    installazione come app (PWA)
```

### Aggiungere un filtro

1. In `js/filters.js` aggiungi una voce in `FILTERS` con un nuovo `id`.
2. Nella funzione GLSL `applyFilter` aggiungi un blocco `if (uFilter == <id>) { ... return colore; }`. Hai a disposizione `uv` (coordinate del video), `p` (pixel sullo schermo), `c` (colore originale) e gli helper `vid()`, `luma()`, `sobel()`, `blurAt()`, `hsv2rgb()`.

Il quadrilatero è definito dagli angoli `[indice sinistro, indice destro, pollice destro, pollice sinistro]`. Nello shader viene calcolata la sua distanza con segno (regola pari-dispari), quindi bordi sfumati e forme incrociate "a farfalla" funzionano senza casi speciali.
