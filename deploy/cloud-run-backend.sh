#!/bin/bash
set -e

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="logos-backend"
IMAGE="gcr.io/$PROJECT_ID/$SERVICE_NAME"

echo "Building and pushing image: $IMAGE"
gcloud builds submit --tag "$IMAGE" ./backend

echo "Deploying to Cloud Run: $SERVICE_NAME"
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "GEMINI_API_KEY=${GEMINI_API_KEY:?Set GEMINI_API_KEY}" \
  --set-env-vars "GEMINI_MODEL=${GEMINI_MODEL:-gemini-2.0-flash-live-001}" \
  --set-env-vars "MOCK_MODE=${MOCK_MODE:-false}" \
  --set-env-vars "ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-https://your-frontend-domain.run.app}" \
  --memory 512Mi \
  --timeout 300 \
  --concurrency 80 \
  --min-instances 0 \
  --max-instances 10

echo "Backend deployed. URL:"
gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format "value(status.url)"
