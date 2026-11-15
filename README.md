# letra web player

Upload an MP3, get a share link. The link opens a full-screen player with
synced lyrics (from the file, LRCLIB or your own `.lrc`) and optional
translation. Only you can upload; anyone with the link can listen.

## First run

Needs Docker with Compose.

```bash
cp .env.example .env
```

Edit `.env`: set `UPLOAD_PASSWORD` and `PUBLIC_URL`, the address people will
use to open your links. Keep `PUBLIC_URL` on `http://` (the default
`http://localhost:3000`, or `http://<server-ip>:3000`) until HTTPS is in
place (see [HTTPS](#https)): an `https://` address marks the session cookie
`Secure`, and browsers drop that cookie over plain HTTP, so you could not stay
logged in.

```bash
docker compose up -d
```

Open the app at the `PUBLIC_URL` address, click "Entrar", enter the password
and upload a track. Data (database, audio, covers) lives in the `letra-data`
Docker volume.

The app refuses to start without `UPLOAD_PASSWORD`. Every other variable is
optional; see `.env.example`.

## The password

`UPLOAD_PASSWORD` protects uploading, editing and deleting. Listening needs no
login. It works best as a phrase of a few random words (the sign-in dialog
calls it "Frase de acesso"): it is compared without regard to capital letters,
accents or extra spaces, so it is easy to type on a phone. Pick at least five
random words, since that leniency makes a short password weaker. Logging in is rate limited to 5 attempts per minute per IP. To change
the password, edit `.env` and restart:

```bash
docker compose up -d
```

Changing the password does not sign out browsers that are already logged in:
their session cookie stays valid for up to 30 days, as long as the key that
signed it does. To lock out a leaked cookie, also rotate that key and restart.
If you set `SESSION_SECRET`, change it in `.env` and run
`docker compose up -d`. If you left it empty, delete the generated key from
the data volume and restart; a new one is made on start:

```bash
docker compose exec app rm /data/session-secret
```

```bash
docker compose restart app
```

Either way every browser, yours included, has to log in again.

## HTTPS

The app speaks plain HTTP. Put it behind a reverse proxy (Caddy, nginx,
Traefik) or a Cloudflare Tunnel that terminates HTTPS and forwards to port
3000, and set `PUBLIC_URL` to the `https://` address. The session cookie is
then marked `Secure`, so from then on open the app at that `https://` address.

Behind a proxy or tunnel, also set `APP_BIND=127.0.0.1` and `TRUST_PROXY=true`
in `.env`. Binding to localhost keeps everyone but your proxy off port 3000;
otherwise a client could spoof `X-Forwarded-For` and dodge the login rate
limit. `TRUST_PROXY` lets the login rate limit see real client IPs instead of
the proxy's. Values:

- empty (default): the app is reached directly.
- `true`: trust the `X-Forwarded-For` header from any hop. Use this only when
  nothing but your proxy can reach port 3000.
- a number (`1`): trust that many proxy hops.
- a comma list of IPs or CIDRs (`172.18.0.0/16`): trust only those proxies.

If your proxy sends the client address in a header of its own (`X-Real-IP`,
`CF-Connecting-IP`), set `CLIENT_IP_HEADER` to that header's name instead, and
the rate limits use it. Only do this when the proxy always overwrites that
header; otherwise a client can set it and dodge the limits.

Example with Caddy on the same host:

```text
letra.example.com {
  reverse_proxy localhost:3000
}
```

With nginx, raise its 1 MB request body limit to match `MAX_UPLOAD_MB` in the
`server` block, or uploads fail at the proxy with a 413:

```text
client_max_body_size 100m;
```

## Deploy on Railway

[Railway](https://railway.com) builds this folder's Dockerfile and serves the
app over HTTPS at a public address. `railway.json` holds the build and health
check settings.

1. Create a project with **Deploy from GitHub repo** and pick this repository.
2. In the service's **Settings**:
   - **Root Directory:** `/` (or leave empty).
   - **Railway Config File:** `/railway.json`.
   - **Region:** one close to your listeners.
3. Attach a **volume** to the service, mounted at `/data`. The database,
   audio and covers live there; without a volume every deploy starts empty.
4. In **Variables**, set:
   - `UPLOAD_PASSWORD`.
   - `ANTHROPIC_API_KEY`, for translation (optional). The other way to turn
     translation on is `TRANSLATE_API_URL`, `TRANSLATE_API_KEY` and
     `TRANSLATE_MODEL` (see [Chat engine](#chat-engine)).
   - `RAILWAY_RUN_UID=0`. Railway mounts volumes as root, and the image runs
     as the `node` user, which cannot write to the volume otherwise.
5. In **Networking**, generate a domain. Then deploy.

Leave `PUBLIC_URL`, `TRUST_PROXY` and `CLIENT_IP_HEADER` unset:

- **`PUBLIC_URL`:** the app takes Railway's domain
  (`https://<name>.up.railway.app`). If you add a custom domain later, set
  `PUBLIC_URL` to it.
- **`CLIENT_IP_HEADER`:** the rate limits read the client address from the
  `X-Real-IP` header Railway's proxy sends.
- **`TRUST_PROXY`:** Railway sends no `X-Forwarded-For`, so there is nothing
  for it to read.

Railway redeploys when you push changes to the connected branch.
It also closes uploads that take longer than 5 minutes, so a 100 MB file needs
about 3 Mbit/s of upload speed.

## Backups

Everything is in the `letra-data` volume. Stop the app first so the SQLite
database is not copied mid-write, then start it again afterwards.

```bash
docker compose stop app
```

Back up to a tarball in the current directory (project name defaults to the
directory name, `letra-jellyfin`):

```bash
docker run --rm -v letra-jellyfin_letra-data:/data -v "$PWD":/backup alpine tar czf /backup/letra-data.tgz -C /data .
```

```bash
docker compose start app
```

To restore, stop the app, extract into the volume, and start it:

```bash
docker compose stop app
```

```bash
docker run --rm -v letra-jellyfin_letra-data:/data -v "$PWD":/backup alpine tar xzf /backup/letra-data.tgz -C /data
```

```bash
docker compose start app
```

Check the exact volume name with `docker volume ls` if you used another
project name.

## Translation

`TRANSLATOR=auto` (default) tries Claude first, then the chat engine, then
LibreTranslate, and shows no translation button if none is configured.

### Claude

Set `ANTHROPIC_API_KEY` in `.env` and restart. The model defaults to
`claude-opus-5-5`; override it with `ANTHROPIC_MODEL`.

### Chat engine

Works with any endpoint that speaks OpenAI's chat completions. It is enabled
when `TRANSLATE_API_URL` (a base URL ending in `/v1`) and `TRANSLATE_MODEL`
are both set; `TRANSLATE_API_KEY` is optional. With only one of the two (or
only the key), `auto` skips the engine and logs a warning at startup, and
`TRANSLATOR=chat` (which uses only this engine) stops the server at startup.

The server also checks the values at startup, and stops with a message that
names the variable (never its value) when one is wrong: `TRANSLATE_API_URL`
and `LIBRETRANSLATE_URL` must be `http` or `https` URLs with no user or
password in them, `TRANSLATE_API_URL` must be the base URL and not the
`.../chat/completions` address, and `TRANSLATE_API_KEY` can not hold a space
or a line break.

`TRANSLATE_DETECT_LANGUAGE` (`true` by default) lets the engine ask the model
for the language of the lyrics. With `false` the engine does not ask. A song
whose language is not already known then stays unknown, so for that song the
app does not say a line is already in the chosen language and the menu on
`/salvas` does not disable a language; a line asked in its own language comes
back as it is and is kept as its translation. Turn it off for a model that can
not name languages reliably.

**Hugging Face.** Set `TRANSLATE_API_URL=https://router.huggingface.co/v1`,
`TRANSLATE_MODEL` to the model id as the router names it, and
`TRANSLATE_API_KEY` to a Hugging Face token. Create the token in your
account's settings, under Access Tokens, with the "Inference Providers"
permission. The lines, the song title and the artist go to Hugging Face and
to the provider it routes the request to. As an estimate from the router's
price table (not measured), the monthly credits of a PRO account cover
thousands of songs.

**In Docker.** Run a small model beside the app. Add this to `.env`:

```text
TRANSLATE_API_URL=http://hymt:8080/v1
TRANSLATE_MODEL=Hy-MT2-1.8B
TRANSLATE_API_KEY=
TRANSLATE_DETECT_LANGUAGE=false
```

Then start the stack with the profile on:

```bash
docker compose --profile hymt up -d
```

The first start downloads the model (1.1 GB) into the `hymt-models` volume;
later starts reuse it. The model is `tencent/Hy-MT2-1.8B` (Apache-2.0), run
by llama.cpp. The numbers here were measured with the model's container
limited to 2 CPUs and 2 GB (for example with
`docker update --cpus 2 --memory 2g <container>`): one line takes 1 to 3 s and
24 lines about 35 s; other hardware will differ. The model takes one request
at a time, and the app allows 60 s per request: two songs translated at the
same moment can make the second fail (asking again works), and on a slower
machine a 24-line part of a song may not fit in 60 s, though single lines do.
The model can not name languages, hence `TRANSLATE_DETECT_LANGUAGE=false`.

The same variables also turn on the player's whole-lyrics translation.

### LibreTranslate

A self-hosted fallback, off by default. Add this to `.env`:

```text
LIBRETRANSLATE_URL=http://libretranslate:5000
```

Then start the stack with the profile on. The first start downloads language
models (several GB), kept in the `lt-models` volume.

```bash
docker compose --profile libretranslate up -d
```

For a public LibreTranslate server, set `LIBRETRANSLATE_URL` to its address
and `LIBRETRANSLATE_API_KEY` to your key, and skip the profile.

## Navigation bar

Every screen has the same bar at the top: the "letra" wordmark (text, not a
link), the tabs "Início" (`/`) and "Linhas salvas" (`/salvas`) in a `nav`
named "Principal", and the screen's own actions at the right: "Entrar" or
"Sair" on the home, `/salvas` and the owner view; translation, share and full
screen on the player. The current tab is underlined; the player marks
neither. On the player under 480 px the wordmark is hidden and the actions
wrap under the tabs when they do not fit. The cover view hides the wordmark,
the tabs and translation, and keeps share and full screen.

## Sharing

The share dialog on a song page offers WhatsApp, a Stories card (an image of
the current verse), X, copy link, "Mais…" where the system share sheet exists,
and a QR code of the link.

The home page lists the songs a listener opened recently. That history lives
only in the listener's browser (localStorage, the last 50 songs); "Limpar
histórico" clears it. The server keeps no listener data.

`GET /api/tracks/summary` is public, limited to 60 requests per minute per
client, and returns only the title, artist, cover flag and colors for ids the
caller already has.

## Saved lines

A listener can save a verse. In the player, each verse has a bookmark icon:
click it, or press `S` to save the verse that is playing (or the one with
keyboard focus). Press it again to remove the line. Synced lyrics also get a
button after the lyrics for keyboard and screen reader users: it shows when it
has keyboard focus, the Tab stop after the verses. Lyrics without timing have
one save button per line instead. `S` is ignored while typing in a field,
while a dialog or menu is open, with repeated key presses, and in the cover
view, where the lyrics are hidden. A browser that refuses the write (private
mode, blocked storage) shows "Não foi possível salvar neste navegador."

Saved lines are listed at `/salvas`, grouped by song, newest song first. Each
line links to the song at that moment, and can be removed; the toast after a
removal has "Desfazer" (or press Ctrl+Z or Cmd+Z while it shows). The home
page shows the three latest saved lines. Both work for every listener, with
no sign-in; every listener reaches `/salvas` from the "Linhas salvas" tab in
the navigation bar.

Each line of a song the server still has gets a "Traduzir linha" button on
`/salvas`. Its menu offers "Português" and "Inglês", and "Ocultar tradução"
while a translation shows. The translation is kept with the saved line in the
browser (`letra.saved.v1`). The button needs a translation engine (see
[Translation](#translation)). The server only translates a line that the song
still has (`GET /api/tracks/:id/translation/line`), 30 requests a minute per
client.

Saved lines live only in the listener's browser, in localStorage under
`letra.saved.v1`, on that device. Each line keeps its text, its time and a
copy of the song's title and artist. The browser holds up to 1000 lines.
Nothing about saved lines is kept on the server, so they are not in the
backups. Translating a line sends that line's text to the server, which sends
it with the song's title and artist to the translation engine and keeps the
translation in its cache.
Clearing the browser's site data removes them. The song titles and covers on
`/salvas` and the home are read through `GET /api/tracks/summary`; a line of a
song you have deleted stays, as plain text without a link.

A link opens a song at a moment with `?t=` in seconds, with up to one decimal:
`/t/<id>?t=83.5`. A missing or malformed value, or a time past the end of the
song, is ignored and the song opens at the start.

## Local development

Needs Node 22.18 or later (the server runs TypeScript directly, through
Node's type stripping, which is on by default from 22.18).

```bash
npm ci
```

The server reads the built front end (`dist/web`) once, when it starts, so
build it first:

```bash
npm run build
```

Or, to rebuild on every front-end change, run this in its own terminal and
let the first build finish:

```bash
npm run dev:web
```

Then start the server with a throwaway password. It restarts when server code
changes, but not when the front end is rebuilt: after a front-end change,
stop it (Ctrl-C) and start it again.

```bash
UPLOAD_PASSWORD=dev DATA_DIR=.data npm run dev:server
```

Open `http://localhost:3000`.

## Measuring motion

`scripts/perf-motion.mjs` counts dropped frames in headless Chromium at
390x844 and 1440x900 (device scale 2, 4x CPU slowdown): the player at rest,
home to player, the cover view, and the lyrics following playback. Build
first, then run it from the repo root:

```bash
npm run build
node scripts/perf-motion.mjs [--runs N] [--json out.json]
```

It prints a table with frames, frames over 25 ms and 33 ms, the longest frame
and the gap between the two pages of a navigation. It is a measurement run by
hand, not part of CI (`--json` also writes every run to a file); use it to compare a change against the same machine's
earlier run.

## Tests

```bash
npm run typecheck
```

```bash
npm test
```

End to end tests need Chromium (`npx playwright install chromium`). They
build the front end and run with a fake translator and a stubbed LRCLIB, so
no network is used:

```bash
npm run test:e2e
```

The Docker smoke test builds the image, starts it on port 3999, uploads the
fixture and checks the share page and Range requests, then tears everything
down:

```bash
bash scripts/docker-smoke.sh
```
