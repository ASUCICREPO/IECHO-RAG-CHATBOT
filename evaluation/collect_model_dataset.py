#!/usr/bin/env python3
"""
Collect model evaluation dataset by calling iECHO Strands API
"""
import requests
import json
import time
from typing import List, Dict

# Your API endpoint
API_BASE_URL = "https://your-api-gateway-url.execute-api.region.amazonaws.com/prod"

# Test prompts for evaluation
TEST_PROMPTS = {
    "TB": [
        "What are the main symptoms of tuberculosis?",
        "How is TB diagnosed?",
        "What is the treatment for drug-resistant TB?",
        "How can TB transmission be prevented?",
        "What are the side effects of TB medications?",
    ],
    "Agriculture": [
        "How can I improve soil fertility in my farm?",
        "What are the best irrigation practices?",
        "How do I control pests organically?",
        "When is the best time to plant crops?",
        "How can I increase crop yield?",
    ]
}

def get_ground_truth(prompt: str) -> str:
    """Generate ground truth responses based on medical and agricultural expertise"""
    ground_truths = {
        "What are the main symptoms of tuberculosis?": "The main symptoms of tuberculosis include persistent cough lasting more than 3 weeks, fever, night sweats, unexplained weight loss, fatigue, and hemoptysis (coughing up blood). Additional symptoms may include chest pain, loss of appetite, and general malaise.",
        
        "How is TB diagnosed?": "TB diagnosis involves multiple steps: symptom screening, tuberculin skin test or interferon-gamma release assays, chest X-ray, sputum smear microscopy, culture testing, and molecular tests like GeneXpert. Definitive diagnosis requires bacteriological confirmation through sputum culture or molecular testing.",
        
        "What is the treatment for drug-resistant TB?": "Drug-resistant TB treatment depends on resistance patterns. MDR-TB requires 18-24 months of second-line drugs including fluoroquinolones, injectable agents, and companion drugs. XDR-TB needs newer drugs like bedaquiline and delamanid. Treatment must be directly observed and requires regular monitoring for adverse effects.",
        
        "How can TB transmission be prevented?": "TB transmission prevention includes early case detection and treatment, infection control measures (ventilation, masks, isolation), contact tracing, treatment of latent TB infection in high-risk individuals, vaccination with BCG in endemic areas, and addressing social determinants like overcrowding and malnutrition.",
        
        "What are the side effects of TB medications?": "Common TB medication side effects include hepatotoxicity (liver damage), peripheral neuropathy, gastrointestinal upset, skin rashes, and visual disturbances. First-line drugs may cause orange discoloration of body fluids. Second-line drugs can cause more severe effects including hearing loss, kidney damage, and psychiatric symptoms.",
        
        "How can I improve soil fertility in my farm?": "Improve soil fertility through organic matter addition (compost, manure), crop rotation with legumes, cover cropping, reduced tillage, proper pH management with lime or sulfur, balanced fertilization based on soil tests, and maintaining soil structure through minimal compaction.",
        
        "What are the best irrigation practices?": "Best irrigation practices include drip or micro-sprinkler systems for water efficiency, soil moisture monitoring, irrigation scheduling based on crop needs, proper drainage to prevent waterlogging, mulching to reduce evaporation, and water quality management to prevent salt buildup.",
        
        "How do I control pests organically?": "Organic pest control involves integrated pest management using beneficial insects, crop rotation, companion planting, physical barriers, organic pesticides (neem, pyrethrin), pheromone traps, and maintaining biodiversity to support natural predator populations.",
        
        "When is the best time to plant crops?": "Optimal planting time depends on crop type, local climate, and frost dates. Generally, plant warm-season crops after last frost when soil temperature reaches 60°F, and cool-season crops 2-4 weeks before last frost. Consider local growing seasons and water availability.",
        
        "How can I increase crop yield?": "Increase crop yield through improved seed varieties, optimal plant spacing, balanced nutrition, efficient irrigation, pest and disease management, soil health improvement, proper timing of operations, and post-harvest loss reduction through better storage and handling."
    }
    
    return ground_truths.get(prompt, "Ground truth response not available for this question.")

def call_iecho_api(prompt: str, user_id: str = "eval-user") -> Dict:
    """Call iECHO streaming API and collect full response"""
    print(f"  Making request to: {API_BASE_URL}/chat-stream")
    
    try:
        response = requests.post(f"{API_BASE_URL}/chat-stream", json={
            "query": prompt,
            "userId": user_id,
            "sessionId": f"eval-{int(time.time())}"
        }, stream=True, timeout=30)
        
        print(f"  Response status: {response.status_code}")
        
        if response.status_code != 200:
            print(f"  Error response body: {response.text}")
            return {"response": f"API Error: {response.status_code}"}
        
        # Collect streaming response
        full_response = ""
        final_data = None
        
        for line in response.iter_lines():
            if line:
                try:
                    line_str = line.decode('utf-8').strip()
                    if not line_str:
                        continue
                    
                    data = json.loads(line_str)
                    
                    if data.get('type') == 'content' and 'data' in data:
                        full_response += data['data']
                    elif 'response' in data:
                        final_data = data
                        if data['response']:
                            full_response = data['response']
                        
                except (json.JSONDecodeError, KeyError, UnicodeDecodeError) as e:
                    continue
        
        return {"response": final_data.get('response', full_response) if final_data else full_response}
            
    except Exception as e:
        print(f"  Error: {e}")
        return {"response": f"Error: {str(e)}"}

def collect_dataset() -> List[Dict]:
    """Collect model evaluation dataset"""
    dataset = []
    
    for category, prompts in TEST_PROMPTS.items():
        for prompt in prompts:
            try:
                print(f"\\nProcessing [{category}]: {prompt}")
                response = call_iecho_api(prompt)
                
                response_text = response.get('response', '')
                print(f"  ✓ Response length: {len(response_text)}")
                
                dataset.append({
                    "prompt": prompt,
                    "referenceResponse": get_ground_truth(prompt),
                    "category": category,
                    "modelResponses": [{
                        "response": response_text,
                        "modelIdentifier": "iECHO-Strands-Chatbot"
                    }]
                })
                
                time.sleep(1)
                
            except Exception as e:
                print(f"  ❌ Error with prompt '{prompt}': {e}")
                dataset.append({
                    "prompt": prompt,
                    "referenceResponse": get_ground_truth(prompt),
                    "category": category,
                    "modelResponses": [{
                        "response": f"Error: {str(e)}",
                        "modelIdentifier": "iECHO-Strands-Chatbot"
                    }]
                })
    
    return dataset

def save_to_jsonl(dataset: List[Dict], filename: str = "model_evaluation_dataset.jsonl"):
    """Save dataset to JSONL format"""
    with open(filename, 'w', encoding='utf-8') as f:
        for item in dataset:
            f.write(json.dumps(item, ensure_ascii=False) + '\n')

if __name__ == "__main__":
    dataset = collect_dataset()
    save_to_jsonl(dataset)
    print(f"Collected {len(dataset)} samples for model evaluation")