#!/bin/bash

# Fix CORS for iECHO RAG Chatbot API Gateway
# This script adds proper CORS headers to your existing API Gateway

set -e

# Configuration
API_ID="nl40r7jl44"
REGION="us-west-2"
STAGE="prod"

echo "🔧 Fixing CORS for API Gateway: $API_ID"

# Get all resources
echo "📋 Getting API Gateway resources..."
RESOURCES=$(aws apigateway get-resources --rest-api-id $API_ID --region $REGION)

# Extract resource IDs
ROOT_RESOURCE_ID=$(echo $RESOURCES | jq -r '.items[] | select(.path == "/") | .id')
CHAT_RESOURCE_ID=$(echo $RESOURCES | jq -r '.items[] | select(.path == "/chat") | .id')
HEALTH_RESOURCE_ID=$(echo $RESOURCES | jq -r '.items[] | select(.path == "/health") | .id')
STATUS_RESOURCE_ID=$(echo $RESOURCES | jq -r '.items[] | select(.path == "/status") | .id')
FEEDBACK_RESOURCE_ID=$(echo $RESOURCES | jq -r '.items[] | select(.path == "/feedback") | .id')
DOCUMENTS_RESOURCE_ID=$(echo $RESOURCES | jq -r '.items[] | select(.path == "/documents") | .id')

echo "📍 Found resources:"
echo "  Root: $ROOT_RESOURCE_ID"
echo "  Chat: $CHAT_RESOURCE_ID"
echo "  Health: $HEALTH_RESOURCE_ID"
echo "  Status: $STATUS_RESOURCE_ID"
echo "  Feedback: $FEEDBACK_RESOURCE_ID"
echo "  Documents: $DOCUMENTS_RESOURCE_ID"

# Function to add OPTIONS method with CORS headers
add_cors_options() {
    local resource_id=$1
    local resource_name=$2
    
    echo "🔧 Adding OPTIONS method to $resource_name..."
    
    # Check if OPTIONS method already exists
    if aws apigateway get-method --rest-api-id $API_ID --resource-id $resource_id --http-method OPTIONS --region $REGION 2>/dev/null; then
        echo "  ⚠️  OPTIONS method already exists for $resource_name, deleting first..."
        aws apigateway delete-method --rest-api-id $API_ID --resource-id $resource_id --http-method OPTIONS --region $REGION
    fi
    
    # Create OPTIONS method
    aws apigateway put-method \
        --rest-api-id $API_ID \
        --resource-id $resource_id \
        --http-method OPTIONS \
        --authorization-type NONE \
        --region $REGION
    
    # Create mock integration for OPTIONS
    aws apigateway put-integration \
        --rest-api-id $API_ID \
        --resource-id $resource_id \
        --http-method OPTIONS \
        --type MOCK \
        --integration-http-method OPTIONS \
        --request-templates '{"application/json": "{\"statusCode\": 200}"}' \
        --region $REGION
    
    # Create method response for OPTIONS
    aws apigateway put-method-response \
        --rest-api-id $API_ID \
        --resource-id $resource_id \
        --http-method OPTIONS \
        --status-code 200 \
        --response-parameters '{
            "method.response.header.Access-Control-Allow-Origin": false,
            "method.response.header.Access-Control-Allow-Headers": false,
            "method.response.header.Access-Control-Allow-Methods": false
        }' \
        --region $REGION
    
    # Create integration response for OPTIONS
    aws apigateway put-integration-response \
        --rest-api-id $API_ID \
        --resource-id $resource_id \
        --http-method OPTIONS \
        --status-code 200 \
        --response-parameters '{
            "method.response.header.Access-Control-Allow-Origin": "'"'"'*'"'"'",
            "method.response.header.Access-Control-Allow-Headers": "'"'"'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"'"'",
            "method.response.header.Access-Control-Allow-Methods": "'"'"'GET,POST,OPTIONS'"'"'"
        }' \
        --region $REGION
    
    echo "  ✅ OPTIONS method added to $resource_name"
}

# Function to update existing methods with CORS headers
update_method_cors() {
    local resource_id=$1
    local method=$2
    local resource_name=$3
    
    echo "🔧 Updating $method method CORS headers for $resource_name..."
    
    # Check if method exists
    if ! aws apigateway get-method --rest-api-id $API_ID --resource-id $resource_id --http-method $method --region $REGION 2>/dev/null; then
        echo "  ⚠️  $method method doesn't exist for $resource_name, skipping..."
        return
    fi
    
    # Update method response to include CORS headers
    aws apigateway put-method-response \
        --rest-api-id $API_ID \
        --resource-id $resource_id \
        --http-method $method \
        --status-code 200 \
        --response-parameters '{
            "method.response.header.Access-Control-Allow-Origin": false,
            "method.response.header.Access-Control-Allow-Headers": false,
            "method.response.header.Access-Control-Allow-Methods": false
        }' \
        --region $REGION 2>/dev/null || echo "  ⚠️  Method response already exists"
    
    # Update integration response to include CORS headers
    aws apigateway put-integration-response \
        --rest-api-id $API_ID \
        --resource-id $resource_id \
        --http-method $method \
        --status-code 200 \
        --response-parameters '{
            "method.response.header.Access-Control-Allow-Origin": "'"'"'*'"'"'",
            "method.response.header.Access-Control-Allow-Headers": "'"'"'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'"'"'",
            "method.response.header.Access-Control-Allow-Methods": "'"'"'GET,POST,OPTIONS'"'"'"
        }' \
        --region $REGION 2>/dev/null || echo "  ⚠️  Integration response already exists"
    
    echo "  ✅ $method method CORS headers updated for $resource_name"
}

# Add OPTIONS methods to all resources
if [ "$CHAT_RESOURCE_ID" != "null" ]; then
    add_cors_options $CHAT_RESOURCE_ID "chat"
    update_method_cors $CHAT_RESOURCE_ID "POST" "chat"
fi

if [ "$HEALTH_RESOURCE_ID" != "null" ]; then
    add_cors_options $HEALTH_RESOURCE_ID "health"
    update_method_cors $HEALTH_RESOURCE_ID "GET" "health"
fi

if [ "$STATUS_RESOURCE_ID" != "null" ]; then
    add_cors_options $STATUS_RESOURCE_ID "status"
    update_method_cors $STATUS_RESOURCE_ID "GET" "status"
fi

if [ "$FEEDBACK_RESOURCE_ID" != "null" ]; then
    add_cors_options $FEEDBACK_RESOURCE_ID "feedback"
    update_method_cors $FEEDBACK_RESOURCE_ID "POST" "feedback"
fi

if [ "$DOCUMENTS_RESOURCE_ID" != "null" ]; then
    add_cors_options $DOCUMENTS_RESOURCE_ID "documents"
    update_method_cors $DOCUMENTS_RESOURCE_ID "GET" "documents"
fi

# Deploy the API
echo "🚀 Deploying API Gateway changes..."
aws apigateway create-deployment \
    --rest-api-id $API_ID \
    --stage-name $STAGE \
    --description "CORS fix deployment $(date)" \
    --region $REGION

echo ""
echo "✅ CORS configuration completed!"
echo ""
echo "🧪 Test your API now:"
echo "curl -X OPTIONS https://$API_ID.execute-api.$REGION.amazonaws.com/$STAGE/chat -v"
echo ""
echo "Your frontend should now work without CORS errors! 🎉"