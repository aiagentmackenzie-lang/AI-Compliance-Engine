// src/ai/docParser.worker.ts
// Worker thread for document parsing (isolated from main process)

import { parentPort, workerData } from 'node:worker_threads';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

interface WorkerData {
  buffer: string; // base64 encoded
  mimeType: string;
}

async function extractText(): Promise<void> {
  if (!parentPort) {
    throw new Error('This module must be run as a worker thread');
  }

  const { buffer, mimeType } = workerData as WorkerData;
  const fileBuffer = Buffer.from(buffer, 'base64');

  try {
    let text: string;

    switch (mimeType) {
      case 'application/pdf': {
        const parser = new PDFParse({ data: fileBuffer });
        const textResult = await parser.getText();
        text = textResult.text;
        await parser.destroy();
        break;
      }
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        const docxResult = await mammoth.extractRawText({ buffer: fileBuffer });
        text = docxResult.value;
        break;
      default:
        throw new Error(`Unsupported MIME type: ${mimeType}`);
    }

    parentPort.postMessage({ success: true, text });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    parentPort.postMessage({ success: false, error: errorMessage });
  }
}

extractText();
