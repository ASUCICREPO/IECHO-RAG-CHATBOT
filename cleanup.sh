#!/usr/bin/env bash
set -euo pipefail

# --------------------------------------------------
# iECHO RAG Chatbot Cleanup Script
# Usage: ./cleanup.sh
# --------------------------------------------------

echo "🗑️  iECHO RAG Chatbot Cleanup"
echo ""
echo "This will destroy all iECHO resources using the main deployment script."
echo ""
read -rp "Are you sure you want to proceed? (y/N): " confirm

if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Cleanup cancelled."
  exit 0
fi

echo ""
echo "🚀 Starting cleanup via deployment script..."

# Call the main deployment script with destroy action
./deploy.sh destroy

exit 0
