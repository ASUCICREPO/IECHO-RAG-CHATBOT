import json
import boto3
import os
import tempfile
import logging
import subprocess
import shutil
from urllib.parse import unquote_plus
from typing import Dict, Any

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
s3 = boto3.client('s3')
bedrock_agent = boto3.client('bedrock-agent')

# Environment variables
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID')
DATA_SOURCE_ID = os.environ.get('DATA_SOURCE_ID')

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    try:
        processed_files = []
        
        for record in event['Records']:
            bucket = record['s3']['bucket']['name']
            key = unquote_plus(record['s3']['object']['key'])
            
            logger.info(f"Processing file: s3://{bucket}/{key}")
            
            if not key.startswith('uploads/'):
                continue
            
            file_extension = key.lower().split('.')[-1] if '.' in key else ''
            file_name = key.split('/')[-1]
            base_name = '.'.join(file_name.split('.')[:-1]) if '.' in file_name else file_name
            
            if not is_file_size_acceptable(bucket, key):
                logger.error(f"File too large: {file_name}")
                continue
            
            if file_extension in ['ppt', 'pptx']:
                pdf_key = convert_ppt_to_pdf(bucket, key, base_name)
                if pdf_key:
                    processed_files.append(pdf_key)
                    s3.delete_object(Bucket=bucket, Key=key)
                    logger.info(f"Converted and deleted: {key}")
                    
            elif file_extension in ['pdf', 'txt', 'md', 'html', 'docx']:
                processed_key = f"processed/{file_name}"
                s3.copy_object(
                    Bucket=bucket,
                    CopySource={'Bucket': bucket, 'Key': key},
                    Key=processed_key
                )
                s3.delete_object(Bucket=bucket, Key=key)
                processed_files.append(processed_key)
        
        # Trigger Knowledge Base sync
        if processed_files and KNOWLEDGE_BASE_ID and DATA_SOURCE_ID:
            try:
                bedrock_agent.start_ingestion_job(
                    knowledgeBaseId=KNOWLEDGE_BASE_ID,
                    dataSourceId=DATA_SOURCE_ID
                )
                logger.info("Knowledge Base sync started")
            except Exception as e:
                logger.error(f"KB sync failed: {str(e)}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Processing completed',
                'processedFiles': len(processed_files)
            })
        }
        
    except Exception as e:
        logger.error(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }



def convert_ppt_to_pdf(bucket: str, ppt_key: str, base_name: str) -> str:
    temp_dir = None
    try:
        temp_dir = tempfile.mkdtemp()
        
        # Download file
        file_ext = ppt_key.lower().split('.')[-1]
        ppt_file = os.path.join(temp_dir, f"{base_name}.{file_ext}")
        s3.download_file(bucket, ppt_key, ppt_file)
        
        # Use LibreOffice from Shelf.io layer - it handles extraction automatically
        # The layer provides soffice in PATH after extraction
        cmd = ['/opt/libreoffice/program/soffice', '--headless', '--convert-to', 'pdf', '--outdir', temp_dir, ppt_file]
        
        logger.info(f"Running conversion: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
        
        if result.returncode != 0:
            logger.error(f"Conversion failed: {result.stderr}")
            return None
        
        # Find generated PDF
        pdf_file = os.path.join(temp_dir, f"{base_name}.pdf")
        if not os.path.exists(pdf_file):
            logger.error("PDF not generated")
            return None
        
        # Upload PDF
        pdf_key = f"processed/{base_name}.pdf"
        s3.upload_file(pdf_file, bucket, pdf_key)
        
        logger.info(f"Successfully converted: {pdf_key}")
        return pdf_key
        
    except Exception as e:
        logger.error(f"Conversion error: {str(e)}")
        return None
    finally:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

def is_file_size_acceptable(bucket: str, key: str, max_mb: int = 50) -> bool:
    try:
        response = s3.head_object(Bucket=bucket, Key=key)
        size_mb = response.get('ContentLength', 0) / (1024 * 1024)
        return size_mb <= max_mb
    except:
        return False