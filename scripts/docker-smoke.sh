#!/usr/bin/env bash
# Docker smoke test: build the image, start it, log in, upload the fixture and
# fetch the share page and the audio. Exits non-zero on the first failed check.
# Run from anywhere: bash scripts/docker-smoke.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT=letra-smoke
export APP_PORT=3999
export PORT=3000
export UPLOAD_PASSWORD=smoke
export TRANSLATOR=fake
export PUBLIC_URL="http://localhost:${APP_PORT}"
BASE="$PUBLIC_URL"

compose() { docker compose -p "$PROJECT" "$@"; }

WORK="$(mktemp -d)"
cleanup() {
  status=$?
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

step "log in with the password"
code="$(curl -s -o /dev/null -w '%{http_code}' -c "$WORK/jar" \
  -H 'Content-Type: application/json' -d "{\"password\":\"$UPLOAD_PASSWORD\"}" "$BASE/api/session")"
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
