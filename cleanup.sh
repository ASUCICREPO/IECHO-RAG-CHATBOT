#!/bin/bash

# iECHO RAG Chatbot Project Cleanup Script
set -e

echo "🧹 Cleaning up iECHO RAG Chatbot project..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[CLEANUP]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Remove node_modules if they exist
if [ -d "cdk-infrastructure/node_modules" ]; then
    print_status "Removing node_modules..."
    rm -rf cdk-infrastructure/node_modules
fi

# Remove CDK output directory
if [ -d "cdk-infrastructure/cdk.out" ]; then
    print_status "Removing CDK output directory..."
    rm -rf cdk-infrastructure/cdk.out
fi

# Remove any compiled TypeScript files
print_status "Removing compiled TypeScript files..."
find cdk-infrastructure -name "*.js" -not -path "*/node_modules/*" -delete 2>/dev/null || true
find cdk-infrastructure -name "*.d.ts" -not -path "*/node_modules/*" -delete 2>/dev/null || true

# Remove Lambda layer python directory if it exists (will be rebuilt)
if [ -d "cdk-infrastructure/lambda-layers/document-processing/python" ]; then
    print_status "Removing Lambda layer python directory (will be rebuilt during deployment)..."
    rm -rf cdk-infrastructure/lambda-layers/document-processing/python
fi

# Remove any temporary files
print_status "Removing temporary files..."
find . -name ".DS_Store" -delete 2>/dev/null || true
find . -name "*.tmp" -delete 2>/dev/null || true
find . -name "*.log" -delete 2>/dev/null || true

# Remove any backup files
find . -name "*~" -delete 2>/dev/null || true
find . -name "*.bak" -delete 2>/dev/null || true

# Clean up any empty directories
print_status "Removing empty directories..."
find . -type d -empty -delete 2>/dev/null || true

echo ""
print_status "Project cleanup completed! ✨"
echo ""
echo "📁 Current project structure:"
echo "├── README.md"
echo "├── DEPLOYMENT.md"
echo "├── deploy.sh"
echo "├── cleanup.sh (this script)"
echo "├── .gitignore"
echo "└── cdk-infrastructure/"
echo "    ├── package.json"
echo "    ├── tsconfig.json"
echo "    ├── cdk.json"
echo "    ├── jest.config.js"
echo "    ├── build-layer.sh"
echo "    ├── bin/"
echo "    │   └── iecho-rag-chatbot.ts"
echo "    ├── lib/"
echo "    │   └── iecho-rag-chatbot-stack.ts"
echo "    ├── test/"
echo "    │   └── iecho-rag-chatbot.test.ts"
echo "    ├── lambda-functions/"
echo "    │   └── document-processor/"
echo "    │       └── index.py"
echo "    └── lambda-layers/"
echo "        └── document-processing/"
echo "            └── requirements.txt"
echo ""
echo "🚀 Ready for deployment! Run './deploy.sh' to deploy the infrastructure."
