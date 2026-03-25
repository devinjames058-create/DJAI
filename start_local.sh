#!/bin/bash
# DJAI Local Artifact Server — startup script
# Run this once to enable file generation from the Quick Pitch panel.
#
# Usage:  chmod +x ~/Desktop/DJAI/start_local.sh
#         ~/Desktop/DJAI/start_local.sh
#
# The server runs in the background. To stop it:
#   kill $(lsof -ti:3001)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/local_server.log"
PID_FILE="$SCRIPT_DIR/local_server.pid"

# Kill any existing server on port 3001
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  kill "$OLD_PID" 2>/dev/null && echo "[DJAI] Stopped previous server (PID $OLD_PID)"
  rm -f "$PID_FILE"
fi

# Also kill anything else on 3001
lsof -ti:3001 | xargs kill -9 2>/dev/null

# Check Python
if ! command -v python3 &>/dev/null; then
  echo "[DJAI] Error: python3 not found. Install Python 3 first."
  exit 1
fi

# Check dependencies
python3 -c "import openpyxl, pptx" 2>/dev/null
if [ $? -ne 0 ]; then
  echo "[DJAI] Installing required packages..."
  pip3 install openpyxl python-pptx --quiet
fi

# Start server in background
python3 "$SCRIPT_DIR/local_server.py" > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

# Wait briefly and verify it started
sleep 1
if kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "[DJAI] Artifact server started (PID $SERVER_PID)"
  echo "[DJAI] Listening on http://localhost:3001"
  echo "[DJAI] Logs: $LOG_FILE"
  echo "[DJAI] Stop: kill $SERVER_PID"
else
  echo "[DJAI] Error: Server failed to start. Check $LOG_FILE for details."
  cat "$LOG_FILE"
  exit 1
fi
