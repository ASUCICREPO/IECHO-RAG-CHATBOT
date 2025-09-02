'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const aws = require('aws-sdk');
const s3 = new aws.S3();

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
            const fileStream = fs.createWriteStream(inputFile);
            const s3Stream = s3.getObject({ Bucket: bucket, Key: key }).createReadStream();
            
            await new Promise((resolve, reject) => {
                s3Stream.pipe(fileStream);
                fileStream.on('finish', resolve);
                fileStream.on('error', reject);
                s3Stream.on('error', reject);
            });
            
            if (fileExt === '.pdf') {
                // 2. For PDF files, copy directly to processed folder
                console.log('Copying PDF directly to processed folder...');
                const processedKey = key.replace('uploads/', 'processed/');
                await s3.copyObject({
                    CopySource: `${bucket}/${key}`,
                    Bucket: bucket,
                    Key: processedKey,
                    ContentType: 'application/pdf'
                }).promise();
                console.log(`Successfully copied PDF: ${key} -> ${processedKey}`);
            } else {
                // 2. Convert office files to PDF
                console.log('Converting to PDF...');
                await convertTo(safeFileName, 'pdf');
                
                // 3. Upload converted file to processed/ folder
                console.log('Uploading converted file...');
                await s3.upload({
                    Bucket: bucket,
                    Key: outputKey,
                    Body: fs.createReadStream(outputFile),
                    ContentType: 'application/pdf'
                }).promise();
                console.log(`Successfully processed: ${key} -> ${outputKey}`);
            }
            
            // 4. Delete original file from uploads/ folder
            console.log('Deleting original file...');
            await s3.deleteObject({ Bucket: bucket, Key: key }).promise();

            
        } catch (error) {
            console.error(`Error processing ${key}:`, error);
            throw error;
        }
    }
};