'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { S3Client, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = new S3Client({});

const { convertTo } = require('@shelf/aws-lambda-libreoffice');

/**
 * S3 Event Handler - converts office files to PDF
 * Triggered when files are uploaded to uploads/ folder
 */
exports.s3Handler = async (event) => {
    console.log('S3 Event:', JSON.stringify(event, null, 2));
    
    for (const record of event.Records) {
        const bucket = record.s3.bucket.name;
        const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
        
        console.log(`Processing: ${bucket}/${key}`);
        
        const workdir = os.tmpdir();
        const fileName = path.basename(key);
        const fileExt = path.extname(fileName).toLowerCase();
        const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const inputFile = path.join(workdir, safeFileName);
        const outputFile = inputFile.replace(/\.[^.]+$/, '.pdf');
        const outputKey = key.replace('uploads/', 'processed/').replace(/\.[^.]+$/, '.pdf');
        
        try {
            // 1. Download file from S3
            console.log('Downloading file...');
            const getObjectResponse = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            const chunks = [];
            for await (const chunk of getObjectResponse.Body) {
                chunks.push(chunk);
            }
            fs.writeFileSync(inputFile, Buffer.concat(chunks));
            
            if (fileExt === '.pdf') {
                // 2. For PDF files, copy directly to processed folder
                console.log('Copying PDF directly to processed folder...');
                const processedKey = key.replace('uploads/', 'processed/');
                await s3Client.send(new CopyObjectCommand({
                    CopySource: `${bucket}/${key}`,
                    Bucket: bucket,
                    Key: processedKey,
                    ContentType: 'application/pdf'
                }));
                console.log(`Successfully copied PDF: ${key} -> ${processedKey}`);
            } else {
                // 2. Convert office files to PDF
                console.log('Converting to PDF...');
                await convertTo(safeFileName, 'pdf');
                
                // 3. Upload converted file to processed/ folder
                console.log('Uploading converted file...');
                await s3Client.send(new PutObjectCommand({
                    Bucket: bucket,
                    Key: outputKey,
                    Body: fs.readFileSync(outputFile),
                    ContentType: 'application/pdf'
                }));
                console.log(`Successfully processed: ${key} -> ${outputKey}`);
            }
            
            // 4. Delete original file from uploads/ folder
            console.log('Deleting original file...');
            await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

            
        } catch (error) {
            console.error(`Error processing ${key}:`, error);
            throw error;
        }
    }
};