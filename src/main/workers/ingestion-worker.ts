import { parentPort } from 'node:worker_threads'
import { ingestDocument } from '../../core/ingest'
import type { IngestStage } from '../../shared/types'

interface IngestRequest {
  id: string
  filename: string
  content: string
}

if (!parentPort) {
  throw new Error('The ingestion worker needs a parent port.')
}

const port = parentPort

port.on('message', (message: IngestRequest) => {
  try {
    const result = ingestDocument(message.filename, message.content, (stage: IngestStage, detail: string) => {
      port.postMessage({ id: message.id, type: 'stage', stage, detail })
    })
    port.postMessage({ id: message.id, type: 'result', result })
  } catch (error) {
    port.postMessage({
      id: message.id,
      type: 'error',
      message: error instanceof Error ? error.message : 'Ingest failed.'
    })
  }
})
