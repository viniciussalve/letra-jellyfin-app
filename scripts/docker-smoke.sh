#!/usr/bin/env bash
# Docker smoke test: build the image, start it against a mock Jellyfin on the host, log in,
# upload the fixture and fetch the share page and the audio. Exits non-zero on the first failed check.
# Run from anywhere: bash scripts/docker-smoke.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT=letra-smoke
export APP_PORT=3999
export PORT=3000
export TRANSLATOR=fake
export PUBLIC_URL="http://localhost:${APP_PORT}"
BASE="$PUBLIC_URL"
JELLYFIN_PORT=3998
LRCLIB_PORT=3997
export JELLYFIN_URL="http://host.docker.internal:${JELLYFIN_PORT}"
export LRCLIB_URL="http://host.docker.internal:${LRCLIB_PORT}"

compose() { docker compose -p "$PROJECT" -f docker-compose.yml -f scripts/docker-smoke.compose.yml "$@"; }

WORK="$(mktemp -d)"
export SMOKE_LIBRARY_DIR="$WORK/library"
mkdir -m 777 "$SMOKE_LIBRARY_DIR"
MOCK_PID=""
cleanup() {
  status=$?
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
  if [ "$status" -ne 0 ]; then
    echo "FAIL: smoke test aborted (exit $status). Container logs:" >&2
    compose logs --no-color --tail 50 app >&2 || true
  fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

step() { echo "==> $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

step "start the mock Jellyfin and LRCLIB on the host"
node scripts/smoke-jellyfin.ts "$SMOKE_LIBRARY_DIR" "$JELLYFIN_PORT" "$LRCLIB_PORT" >"$WORK/mock.log" 2>&1 &
MOCK_PID=$!
for _ in $(seq 1 50); do grep -q '^ready' "$WORK/mock.log" && break; sleep 0.2; done
grep -q '^ready' "$WORK/mock.log" || fail "mock Jellyfin did not start: $(cat "$WORK/mock.log")"
export JELLYFIN_API_KEY="$(sed -n 's/^ready api-key=//p' "$WORK/mock.log")"
echo "ok: mock Jellyfin on port $JELLYFIN_PORT"

step "build and start (project $PROJECT, port $APP_PORT)"
compose up -d --build

step "wait for /healthz (up to 60 s)"
ok=0
for _ in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" || true)" = "200" ]; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] || fail "/healthz did not return 200 within 60 s"
echo "ok: /healthz returned 200"

step "wait for the Docker HEALTHCHECK to report healthy (up to 60 s)"
cid="$(compose ps -q app)"
[ -n "$cid" ] || fail "app container not found"
health=""
for _ in $(seq 1 60); do
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid")"
  [ "$health" = "healthy" ] && break
  sleep 1
done
[ "$health" = "healthy" ] || fail "container health is '$health', expected 'healthy'"
echo "ok: container is healthy"

step "log in with the mock Jellyfin user"
code="$(curl -s -o /dev/null -w '%{http_code}' -c "$WORK/jar" \
  -H 'Content-Type: application/json' -d '{"username":"jelly","password":"jelly-pass"}' "$BASE/api/session")"
[ "$code" = "200" ] || fail "login returned $code, expected 200"
echo "ok: login returned 200"

step "upload test/fixtures/song.mp3"
code="$(curl -s -o "$WORK/upload.json" -w '%{http_code}' -b "$WORK/jar" \
  -F "file=@test/fixtures/song.mp3;type=audio/mpeg" "$BASE/api/tracks")"
[ "$code" = "201" ] || fail "upload returned $code, expected 201: $(cat "$WORK/upload.json")"
id="$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' "$WORK/upload.json")"
[ -n "$id" ] || fail "no track id in upload response: $(cat "$WORK/upload.json")"
echo "ok: uploaded track $id"

step "GET /t/$id has og:title"
curl -s -f "$BASE/t/$id" -o "$WORK/page.html" || fail "GET /t/$id failed"
grep -q 'property="og:title"' "$WORK/page.html" || fail "/t/$id has no og:title"
echo "ok: og:title present"

step "GET /media/$id/audio with Range returns 206"
code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-99' "$BASE/media/$id/audio")"
[ "$code" = "206" ] || fail "audio Range request returned $code, expected 206"
echo "ok: audio Range returned 206"

step "docker logs has the request log, without the session cookie"
logs="$(compose logs --no-color app)"
grep -q '"msg":"incoming request"' <<<"$logs" || fail "no request log in docker logs"
if grep -qi 'letra_session' <<<"$logs"; then fail "the session cookie shows up in docker logs"; fi
echo "ok: requests logged, cookie absent"

step "docker stop: SIGTERM closes the app cleanly, well before the 10 s kill"
start="$(date +%s)"
compose stop app >/dev/null
elapsed=$(( $(date +%s) - start ))
exit_code="$(docker inspect -f '{{.State.ExitCode}}' "$cid")"
[ "$exit_code" = "0" ] || fail "app exited with $exit_code after SIGTERM, expected 0"
[ "$elapsed" -lt 8 ] || fail "docker stop took ${elapsed} s, expected the app to exit on SIGTERM"
echo "ok: stopped in ${elapsed} s with exit code 0"

step "all checks passed"
