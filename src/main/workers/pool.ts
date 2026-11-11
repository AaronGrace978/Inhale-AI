import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { ingestDocument, type IngestResult } from '../../core/ingest'
import type { IngestStage } from '../../shared/types'

interface WorkerMessage {
  id: string
  type: 'stage' | 'result' | 'error'
  stage?: IngestStage
  detail?: string
  result?: IngestResult
  message?: string
}

interface Pending {
  resolve: (result: IngestResult) => void
  reject: (error: Error) => void
  onStage: (stage: IngestStage, detail: string) => void
}

export class IngestionPool {
  private worker: Worker | null = null
  private pending = new Map<string, Pending>()

  constructor(private readonly workerFile = join(__dirname, 'ingestion-worker.js')) {}

  async run(filename: string, content: string, onStage: (stage: IngestStage, detail: string) => void): Promise<IngestResult> {
    if (!existsSync(this.workerFile)) {
      return ingestDocument(filename, content, onStage)
    }
    try {
      return await this.runOnWorker(filename, content, onStage)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (/cannot find module|ingestion-worker/i.test(message)) {
        return ingestDocument(filename, content, onStage)
      }
      throw error
    }
  }

  stop(): void {
    const worker = this.worker
    this.worker = null
    for (const [id, pending] of this.pending) {
      pending.reject(new Error('Ingestion stopped.'))
      this.pending.delete(id)
    }
    void worker?.terminate()
  }

  private runOnWorker(filename: string, content: string, onStage: (stage: IngestStage, detail: string) => void): Promise<IngestResult> {
    const worker = this.ensure()
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onStage })
      worker.postMessage({ id, filename, content })
    })
  }

  private ensure(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(this.workerFile)
    worker.on('message', (message: WorkerMessage) => {
      const pending = this.pending.get(message.id)
      if (!pending) return
      if (message.type === 'stage' && message.stage && message.detail) {
        pending.onStage(message.stage, message.detail)
        return
      }
      this.pending.delete(message.id)
      if (message.type === 'result' && message.result) pending.resolve(message.result)
      else pending.reject(new Error(message.message || 'Ingest failed.'))
    })
    worker.on('error', (error: unknown) => {
      const wrapped = error instanceof Error ? error : new Error('The ingestion worker failed.')
      for (const [id, pending] of this.pending) {
        pending.reject(wrapped)
        this.pending.delete(id)
      }
      this.worker = null
    })
    this.worker = worker
    return worker
  }
}
