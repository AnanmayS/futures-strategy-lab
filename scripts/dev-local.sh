#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
API_PORT="${API_PORT:-8001}"
NEXT_PORT="${NEXT_PORT:-3000}"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://127.0.0.1:${API_PORT}}"
export NEXT_PUBLIC_API_URL

cleanup() {
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

cd "$ROOT_DIR/backend"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT" --reload &
BACKEND_PID="$!"

cd "$ROOT_DIR"
echo "Frontend: http://localhost:${NEXT_PORT}"
echo "Backend:  ${NEXT_PUBLIC_API_URL}"
npx next dev --webpack --port "$NEXT_PORT"
