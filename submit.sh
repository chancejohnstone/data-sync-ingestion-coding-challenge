#!/bin/bash
set -e

# Load env vars
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "$TARGET_API_KEY" ]; then
  echo "Error: TARGET_API_KEY not set in .env"
  exit 1
fi

GITHUB_REPO="https://github.com/chancejohnstone/data-sync-ingestion-coding-challenge"
API_BASE="http://datasync-dev-alb-101078500.us-east-1.elb.amazonaws.com/api/v1"

echo "Extracting event IDs from PostgreSQL..."
docker exec assignment-postgres psql -U postgres -d ingestion \
  -t -A -c "SELECT id FROM ingested_events ORDER BY id;" > event_ids.txt

COUNT=$(wc -l < event_ids.txt | tr -d ' ')
echo "Found $COUNT event IDs in event_ids.txt"

echo ""
echo "WARNING: This will use one of your 5 submission attempts."
echo "Submitting to: $API_BASE/submissions?github_repo=$GITHUB_REPO"
echo ""
read -p "Proceed with submission? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Submission cancelled."
  exit 0
fi

echo "Submitting..."
curl -X POST \
  -H "X-API-Key: $TARGET_API_KEY" \
  -H "Content-Type: text/plain" \
  --data-binary @event_ids.txt \
  "$API_BASE/submissions?github_repo=$GITHUB_REPO"

echo ""
echo "Done."
