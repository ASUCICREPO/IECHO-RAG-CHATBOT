'use strict'; // Enforce strict mode for safer JS (e.g., no implicit globals)

const fs = require('fs'); // Filesystem access for reading/writing temp files
const os = require('os'); // OS utilities; used here to get the Lambda /tmp directory
const path = require('path'); // Path helpers for safe filename and extension handling

// AWS SDK v3 S3 client + commands (lightweight modular imports)
const { S3Client, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = new S3Client({}); // Uses Lambda's execution role/region by default

// LibreOffice wrapper (provided by @shelf/aws-lambda-libreoffice layer or docker image)
// convertTo expects input file present in /tmp and outputs the converted file in the same dir
const { convertTo } = require('@shelf/aws-lambda-libreoffice');

/**
 * S3 Event Handler - converts office files to PDF
 * Triggered when files are uploaded to uploads/ folder
 * - For .pdf: copies directly to processed/
 * - For Office files (.pptx/.docx/.xlsx/etc.): converts to PDF, uploads to processed/
 * - Deletes original from uploads/ after success
 */
exports.s3Handler = async (event) => {
    console.log('S3 Event:', JSON.stringify(event, null, 2)); // Log full event for traceability
    
    // Process each S3 record independently (multiple objects can trigger one invocation)
    for (const record of event.Records) {
        const bucket = record.s3.bucket.name; // Source bucket name
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' ')); // Object key (decode '+' and URI-encoding)
        
        console.log(`Processing: ${bucket}/${key}`);
        
        const workdir = os.tmpdir(); // Lambda writable temp dir (/tmp, 512MB limit)
        const fileName = path.basename(key); // Extract file name from key
        const fileExt = path.extname(fileName).toLowerCase(); // Normalized extension for branching
        // Sanitize filename for local filesystem (avoid spaces/specials that may confuse LibreOffice)
        const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const inputFile = path.join(workdir, safeFileName); // Local input path in /tmp
        const outputFile = inputFile.replace(/\.[^.]+$/, '.pdf'); // Expected local output PDF path
        // Destination key: uploads/... -> processed/... and change extension to .pdf
        const outputKey = key.replace('uploads/', 'processed/').replace(/\.[^.]+$/, '.pdf');
        
        try {
            // 1. Download file from S3 (stream body to memory, then write to /tmp)
            console.log('Downloading file...');
            const getObjectResponse = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            const chunks = [];
            // Body is a readable stream in Node.js runtime
            for await (const chunk of getObjectResponse.Body) {
                chunks.push(chunk);
            }
            fs.writeFileSync(inputFile, Buffer.concat(chunks)); // Persist to /tmp for LibreOffice
            
            if (fileExt === '.pdf') {
                // 2a. If it's already a PDF, simply copy to processed/ (server-side copy, no download/upload)
                console.log('Copying PDF directly to processed folder...');
                const processedKey = key.replace('uploads/', 'processed/'); // Preserve original filename
                await s3Client.send(new CopyObjectCommand({
                    CopySource: `${bucket}/${key}`, // Source in the same bucket
                    Bucket: bucket,
                    Key: processedKey,
                    ContentType: 'application/pdf' // Ensure proper content-type on destination
                }));
                console.log(`Successfully copied PDF: ${key} -> ${processedKey}`);
            } else {
                // 2b. Convert office files to PDF using LibreOffice headless
                console.log('Converting to PDF...');
                // convertTo reads from /tmp by filename; it creates a .pdf in the same directory
                await convertTo(safeFileName, 'pdf');
                
                // 3. Upload converted file to processed/ with application/pdf content-type
                console.log('Uploading converted file...');
                await s3Client.send(new PutObjectCommand({
                    Bucket: bucket,
                    Key: outputKey,
                    Body: fs.readFileSync(outputFile), // Read the generated PDF from /tmp
                    ContentType: 'application/pdf'
                }));
                console.log(`Successfully processed: ${key} -> ${outputKey}`);
            }
            
            // 4. Delete original file from uploads/ folder (cleanup to avoid reprocessing)
            console.log('Deleting original file...');
            await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
            
            
        } catch (error) {
            // Any error per-object bubbles up (causing retry depending on event source settings)
            console.error(`Error processing ${key}:`, error);
            throw error; // Re-throw to signal failure to Lambda/S3 (may trigger retry/DLQ)
        }
    }
};
