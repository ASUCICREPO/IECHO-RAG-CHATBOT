#!/bin/bash

# Build Lambda Layer for Document Processing
set -e

echo "🔨 Building Lambda layer for document processing..."

# Create layer directory structure
LAYER_DIR="lambda-layers/document-processing"
mkdir -p $LAYER_DIR/python

# Install Python dependencies
echo "📦 Installing Python dependencies..."
pip install -r $LAYER_DIR/requirements.txt -t $LAYER_DIR/python/

# Clean up unnecessary files to reduce layer size
echo "🧹 Cleaning up unnecessary files..."
find $LAYER_DIR/python -name "*.pyc" -delete
find $LAYER_DIR/python -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
find $LAYER_DIR/python -name "*.dist-info" -type d -exec rm -rf {} + 2>/dev/null || true
find $LAYER_DIR/python -name "tests" -type d -exec rm -rf {} + 2>/dev/null || true

echo "✅ Lambda layer built successfully!"
echo "📁 Layer location: $LAYER_DIR"
echo "📊 Layer size: $(du -sh $LAYER_DIR | cut -f1)"
