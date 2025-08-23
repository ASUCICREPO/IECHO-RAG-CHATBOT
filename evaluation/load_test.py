#!/usr/bin/env python3
"""
Load test script for iECHO Strands API
"""
import asyncio
import aiohttp
import time
import json
from typing import List, Dict

API_BASE_URL = "https://your-api-gateway-url.execute-api.region.amazonaws.com/prod"

TEST_QUERIES = [
    "What are the main symptoms of tuberculosis?",
    "How is TB diagnosed?",
    "How can I improve soil fertility?",
    "What are the best irrigation practices?",
    "How do I control pests organically?",
]

async def make_request(session: aiohttp.ClientSession, query: str, request_id: int) -> Dict:
    """Make a single API request"""
    start_time = time.time()
    
    try:
        async with session.post(
            f"{API_BASE_URL}/chat-stream",
            json={
                "query": query,
                "userId": f"load-test-{request_id}",
                "sessionId": f"session-{request_id}-{int(time.time())}"
            },
            timeout=aiohttp.ClientTimeout(total=60)
        ) as response:
            
            if response.status != 200:
                return {
                    "request_id": request_id,
                    "query": query,
                    "status": "error",
                    "response_time": time.time() - start_time,
                    "error": f"HTTP {response.status}"
                }
            
            # Collect streaming response
            full_response = ""
            async for line in response.content:
                if line:
                    try:
                        line_str = line.decode('utf-8').strip()
                        if line_str:
                            data = json.loads(line_str)
                            if data.get('type') == 'content' and 'data' in data:
                                full_response += data['data']
                            elif 'response' in data and data['response']:
                                full_response = data['response']
                    except:
                        continue
            
            return {
                "request_id": request_id,
                "query": query,
                "status": "success",
                "response_time": time.time() - start_time,
                "response_length": len(full_response)
            }
            
    except Exception as e:
        return {
            "request_id": request_id,
            "query": query,
            "status": "error",
            "response_time": time.time() - start_time,
            "error": str(e)
        }

async def run_load_test(concurrent_requests: int = 10, total_requests: int = 50):
    """Run load test with specified concurrency"""
    print(f"Starting load test: {total_requests} requests, {concurrent_requests} concurrent")
    
    connector = aiohttp.TCPConnector(limit=concurrent_requests)
    async with aiohttp.ClientSession(connector=connector) as session:
        
        # Create tasks
        tasks = []
        for i in range(total_requests):
            query = TEST_QUERIES[i % len(TEST_QUERIES)]
            task = make_request(session, query, i + 1)
            tasks.append(task)
        
        # Run with concurrency limit
        semaphore = asyncio.Semaphore(concurrent_requests)
        
        async def limited_request(task):
            async with semaphore:
                return await task
        
        start_time = time.time()
        results = await asyncio.gather(*[limited_request(task) for task in tasks])
        total_time = time.time() - start_time
        
        # Analyze results
        successful = [r for r in results if r['status'] == 'success']
        failed = [r for r in results if r['status'] == 'error']
        
        if successful:
            response_times = [r['response_time'] for r in successful]
            avg_response_time = sum(response_times) / len(response_times)
            min_response_time = min(response_times)
            max_response_time = max(response_times)
        else:
            avg_response_time = min_response_time = max_response_time = 0
        
        # Print results
        print(f"\n=== Load Test Results ===")
        print(f"Total requests: {total_requests}")
        print(f"Concurrent requests: {concurrent_requests}")
        print(f"Total time: {total_time:.2f}s")
        print(f"Requests per second: {total_requests/total_time:.2f}")
        print(f"Successful: {len(successful)}")
        print(f"Failed: {len(failed)}")
        print(f"Success rate: {len(successful)/total_requests*100:.1f}%")
        
        if successful:
            print(f"\n=== Response Times ===")
            print(f"Average: {avg_response_time:.2f}s")
            print(f"Min: {min_response_time:.2f}s")
            print(f"Max: {max_response_time:.2f}s")
        
        if failed:
            print(f"\n=== Errors ===")
            error_counts = {}
            for r in failed:
                error = r.get('error', 'Unknown')
                error_counts[error] = error_counts.get(error, 0) + 1
            
            for error, count in error_counts.items():
                print(f"{error}: {count}")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Load test iECHO API')
    parser.add_argument('--concurrent', '-c', type=int, default=10, help='Concurrent requests (default: 10)')
    parser.add_argument('--total', '-t', type=int, default=50, help='Total requests (default: 50)')
    
    args = parser.parse_args()
    
    asyncio.run(run_load_test(args.concurrent, args.total))