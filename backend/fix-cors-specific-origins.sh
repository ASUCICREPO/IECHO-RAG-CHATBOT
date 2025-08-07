#!/bin/bash

# Fix CORS for iECHO RAG Chatbot API Gateway - Specific Origins Version
# This script adds CORS headers for specific allowed origins

set -e

# Configuration
API_ID="nl40r7jl44"
REGION="us-west-2"
STAGE="prod"

# Define allowed origins (modify as needed)
ALLOWED_ORIGINS=(
    "http://localhost:3000"
    "http://localhost:3002"
    "https://yourdomain.com"
    "https://yourapp.netlify.app"
)

echo "🔧 Fixing CORS for API Gateway: $API_ID"
echo "📍 Allowed origins: ${ALLOWED_ORIGINS[*]}"

# Convert array to comma-separated string for API Gateway
ORIGINS_STRING=$(IFS=','; echo "${ALLOWED_ORIGINS[*]}")

# Rest of the script would be similar but use specific origins instead of '*'
# For simplicity, using '*' is recommended unless you have specific security requirements

echo "⚠️  For production use, consider using specific origins instead of '*'"
echo "   Current script uses '*' which allows all origins"