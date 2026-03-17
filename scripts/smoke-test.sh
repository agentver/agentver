#!/bin/bash
set -euo pipefail

BASE_URL="${1:?Usage: $0 <base-url>}"
FAILURES=0

echo "Running smoke tests against ${BASE_URL}..."
echo "---"

# Health check
if curl -sf "${BASE_URL}/api/v1/health" | jq . > /dev/null 2>&1; then
  echo "  Health check passed"
else
  echo "  Health check FAILED"
  FAILURES=$((FAILURES + 1))
fi

# Version endpoint
if curl -sf "${BASE_URL}/api/v1/health" | jq -e '.version' > /dev/null 2>&1; then
  echo "  Version present in health response"
else
  echo "  Version endpoint not found (non-blocking)"
fi

# Search endpoint
if curl -sf "${BASE_URL}/api/v1/search?q=test&limit=1" | jq -e '.total' > /dev/null 2>&1; then
  echo "  Search endpoint passed"
else
  echo "  Search endpoint not available (non-blocking)"
fi

# Main page loads
HTTP_CODE=$(curl -sf -o /dev/null -w '%{http_code}' "${BASE_URL}/" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  echo "  Main page loads (${HTTP_CODE})"
else
  echo "  Main page FAILED (${HTTP_CODE})"
  FAILURES=$((FAILURES + 1))
fi

echo "---"

if [ "$FAILURES" -gt 0 ]; then
  echo "Smoke tests FAILED with ${FAILURES} failure(s)"
  exit 1
fi

echo "Smoke tests complete - all checks passed"
