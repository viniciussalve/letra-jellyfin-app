# letra: accounts by phrase, and audio only the uploader can open

Date: 2026-11-12. Status: for the owner's review.

## 1. Why

letra has one account today: the owner's. The owner wants other people to use it, each responsible for what they upload, with no e-mail and no password: the site generates a phrase and the phrase is the only way in, as Mullvad does with its account number. What drew the owner to this design is that **the person owns their key**: the site must not be able to open what it stores.

Decided with the owner, in order:

- Anyone can ask for an account: "Quero um convite" → a short term with a checkbox → a nickname → the phrase. The account works at once; there is no approval step.
- Each person has their own library and answers for their uploads.
- Only the audio is encrypted. Title, artist, cover and lyrics stay readable by the server, so lyrics lookup, translation and link previews keep working.
- No blockchain, no wallet, no fees. The key technique of wallets is used without a chain.

## 2. What success looks like

- A visitor gets an account in under a minute without typing an e-mail or choosing a password, and leaves with a phrase they were made to keep.
- The same phrase opens the same library on another device.
- A shared link plays for anyone who has it, at any time, with nobody else online.
- A copy of the server's disk and database does not let anyone listen to a guest's song or sign in as a guest.
- The owner can still take a song down or block an account.

## 3. The phrase and the keys

- **Phrase:** 6 words drawn in the browser with `crypto.getRandomValues` from the BIP39 Portuguese list (2,048 words, no accents): 66 bits. It is normalised before use the way sign-in does today (accents and case ignored, runs of white space as one space).
- **Seed:** `PBKDF2-SHA-256(phrase, salt "letra/v1", 2,000,000 iterations)`, 32 bytes, computed in the browser. Measured in Chromium: 0.4 s at 4× CPU slowdown.
- **From the seed, by HKDF-SHA-256 with distinct labels:**
  - a signing key pair (Ed25519): the public key is the account's identity on the server;
  - a wrapping key (AES-256-GCM): locks each song's key for storage on the server.
- **Account id:** the first 16 bytes of SHA-256 of the public key, in hex. It is what the browser sends to say who it is.
- Ed25519 comes from one small audited library (`@noble/ed25519`) on every browser, so there is one code path; AES, HKDF, PBKDF2 and SHA-256 come from Web Crypto.
- The server stores: account id, public key, nickname, creation date, the version of the term accepted and when, status (active or blocked), bytes used. It never receives the phrase or the seed.

**Losing the phrase loses the account and its songs.** Nobody can recover it. The invitation flow says so before the phrase is shown and makes the person confirm they kept it.

## 4. Getting in

### Asking for an account

1. The bar shows "Quero um convite" beside "Entrar" to anyone not signed in.
2. A dialog, "Antes de entrar", with four points and a link "Letras miúdas":
   - "Você responde pelo que envia e só envia o que tem direito de usar."
   - "Quem tem o link de uma música consegue ouvir."
   - "Sua frase é a única chave. Se você perder, não há como recuperar."
   - "Seu acesso pode ser retirado e suas músicas removidas se houver abuso ou denúncia."
   A checkbox "Li e aceito"; "Continuar" is disabled until it is ticked.
3. "Como você quer ser chamado?": one field, 2 to 30 characters, trimmed; it need not be unique.
4. The phrase, shown once, with "Copiar" and "Baixar" (a text file, `letra - frase de acesso.txt`), and a checkbox "Guardei minha frase". "Entrar" is disabled until it is ticked.
5. The browser registers the account (public key, nickname, term version) and signs in. The person lands on their own empty library.

### Signing in

- "Entrar" asks for the phrase only. The browser derives the keys, asks the server for a challenge for its account id, signs it, and the server sets the session cookie. A wrong phrase and an unknown account give the same message: "Frase incorreta."
- The seed is kept in the browser (IndexedDB, as a non-extractable key where the platform allows) for as long as the session lasts, so the library opens without typing the phrase on each visit. "Sair" removes it.

### In the account

The bar's account action shows the nickname and opens a menu (the shared menu behaviour):

- "Trocar a frase": a new phrase is generated and shown as in step 4; the browser re-wraps every song key with the new wrapping key and the server replaces the public key and the wrapped keys in one transaction. The old phrase stops working. No audio is uploaded again.
- "Apagar minha conta": confirms by typing the nickname; deletes the account, its songs and their files.
- "Sair".

### The owner

The owner's current phrase (`UPLOAD_PASSWORD`) keeps working. At start-up the server derives the same public key from it and makes sure an administrator account with that key exists, owning every song already on the site. The owner then signs in like everyone else, and the phrase is no longer sent over the network. The old password route is removed.

## 5. Audio

### Uploading

The browser, not the server, now reads the file:

1. reads title, artist, cover and duration from the file's tags;
2. draws a random 256-bit key for this song;
3. encrypts the audio in 64 KiB chunks with AES-256-GCM; the nonce is the chunk's index, and the index and a last-chunk flag are authenticated, so chunks can not be reordered or the file cut short unnoticed;
4. sends: the song's data in the clear (title, artist, duration, size, type, cover image), the encrypted audio, and the song key wrapped with the account's wrapping key.

The server stores the ciphertext, runs lyrics lookup and the palette from the cover as today, and counts the bytes against the account's quota. Measured in Chromium: a 101 MB file encrypts in 0.5 s at 4× CPU slowdown.

### Playing

A service worker answers the audio element's requests: for the byte range asked, it fetches the matching chunks of ciphertext, decrypts them, and returns the plain bytes. Seeking works because any chunk can be decrypted alone. Measured in Chromium, 4× slowdown: first sound in about 0.3 s and a jump to 80% of a 101 MB file in about 0.3 s.

Where a service worker is not available (some private modes), the page downloads and decrypts the whole file and plays it from memory, and says "Preparando a música…" while it does. Files over 50 MB are refused in that mode with a message.

### Sharing

- A song's link is its address today plus the song key after `#`: `…#k=<key>`. Browsers never send that part to the server.
- The share dialog, the QR code, the story card and a link to a moment (`?t=`) all carry it.
- Opened without the key, the page shows the cover, the title and the lyrics, with no sound and the note "Este link está incompleto. Peça o link de novo a quem enviou."
- The home's "Ouvidas recentemente" keeps each song's key in the browser, so a song opens again from there.
- Link previews (title, artist, cover) are unchanged.

### Songs already on the site

They stay as they are, unencrypted, and their links keep working. Everything uploaded from now on, by the owner too, is encrypted. Converting the old ones would change their links and is out of scope.

## 6. Limits, reports and the owner's view

- **Rate limits:** 3 new accounts a day per IP address and 30 a day in total; sign-in challenges 5 a minute per IP, as today's sign-in.
- **Quota:** 500 MB per account, 100 MB per song. The upload panel shows the space used. The numbers are server settings.
- **Reports:** every song page has "Denunciar" in the share menu: a reason (a short list and a free text of up to 500 characters) and nothing else. No account is needed.
- **"Contas"**, a third tab that only the administrator sees: nickname, created, songs, space used, open reports; "Bloquear" (the account can not sign in, its songs and files return 404) and "Desbloquear"; "Apagar" (as the person's own delete). A report lists the song and the reason, with "Remover a música" and "Arquivar".
- **"Letras miúdas"**, a page at `/letras-miudas`, linked from the invitation dialog and from the foot of the home: the four points in full; what is stored (nickname, songs' data, encrypted audio, the term's acceptance) and what is not (e-mail, the phrase, anything that opens the audio); how to report a song and that reported songs are reviewed by the owner; how to delete the account and what goes with it; who runs the site and how to reach them. The owner supplies the contact and reviews the text; it is not legal advice.

## 7. What the server can and can not do

| | The server |
|---|---|
| Sign in as a guest | No: it has only public keys. |
| Listen to a guest's song | No: it has the ciphertext and a key it can not unwrap. |
| Know what a song is | Yes: title, artist, cover and lyrics are in the clear. |
| Remove a song or block an account | Yes. |
| Learn a song key | Only if someone sends it the full link, which browsers do not do. |

A leaked database lets an attacker guess phrases offline against a public key; 66 bits behind 2,000,000 PBKDF2 iterations makes that impractical. A person with a song's link can listen and can pass the link on; that is what a link is.

## 8. Stages

Each ships on its own.

1. **Encrypted audio for the one account there is.** Browser-side tag reading, encryption, the service worker, links with the key, the fallback. The owner's new uploads are encrypted. This stage ends with a check on the owner's iPhone before anything else is built (section 10).
2. **Accounts.** Keys from the phrase, challenge sign-in, the invitation flow, per-account libraries, the account menu, the administrator account from `UPLOAD_PASSWORD`.
3. **Limits, reports, "Contas" and "Letras miúdas".** Public sign-up is switched on only when this stage is in (`SIGNUP=open`; default `closed`, which hides "Quero um convite").

## 9. Testing

- Unit: phrase generation and normalisation; key derivation against fixed vectors; chunked encryption (round trip, a flipped bit, a missing last chunk, reordered chunks all fail); wrapping and re-wrapping; the range-to-chunks arithmetic at every boundary.
- API: registration and its limits; challenge sign-in (replayed, expired and foreign-account challenges fail); a blocked account; quotas; reports; one account can not read or change another's songs; the administrator account derived at start-up.
- End to end: the invitation flow with both checkboxes; the phrase works on a second browser context and shows the same library; upload, play, seek and share an encrypted song; the link without its key; changing the phrase keeps the songs playing and kills the old phrase; deleting the account; the administrator blocks an account and its link stops; the fallback without a service worker.

## 10. Not verifiable here

- **Safari and iPhone.** The measurements above are Chromium only. A service worker feeding an audio element is the part most likely to misbehave on iOS. Stage 1 ships a self-check the owner runs on their iPhone (play, seek, lock the screen, come back); if it fails, the fallback (decrypt the whole file first) becomes the iOS path and the 50 MB limit applies there.
- Whether encryption changes the owner's legal position for hosted audio. It is a question for a lawyer.

## 11. Out of scope

- Saved lines following the account across devices (they stay in the browser).
- Encrypting titles, covers or lyrics.
- Converting the songs already uploaded.
- Recovery of a lost phrase; e-mail of any kind.
- Blockchain, wallets, decentralised storage, device-to-device transfer.
- Payments.
