import { processImageJob } from './image-processing'
import { ImageBackendUnavailableError } from './image-protocol'
import type { ImageJob, ImageWorkerMessage } from './image-protocol'

// The project uses lib DOM. Describe only this worker's surface rather than
// adding lib WebWorker and conflicting with the application's Window globals.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<ImageJob>) => void) | null
  postMessage: (message: ImageWorkerMessage) => void
}

scope.onmessage = (event) => {
  void processImageJob(event.data, 'worker', (completed, total) => {
    scope.postMessage({ kind: 'progress', completed, total })
  }).then((result) => {
    scope.postMessage({ kind: 'result', result })
  }).catch((error: unknown) => {
    scope.postMessage({
      kind: 'error',
      message: error instanceof Error ? error.message : 'The image could not be processed. Try a smaller JPEG or PNG.',
      unavailable: error instanceof ImageBackendUnavailableError,
    })
  })
}

scope.postMessage({ kind: 'ready' })
