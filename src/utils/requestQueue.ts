export class RequestQueue {
  private queue: (() => Promise<void>)[] = [];
  private isProcessing = false;
  private delayMs: number;

  constructor(delayMs = 6000) {
    this.delayMs = delayMs;
  }

  setDelay(ms: number) {
    this.delayMs = ms;
  }

  add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      if (!this.isProcessing) {
        this.processNext();
      }
    });
  }

  private async processNext() {
    this.isProcessing = true;
    while (this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        await task();
        // Enforce rate limit delay before the next request
        if (this.queue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, this.delayMs));
        }
      }
    }
    this.isProcessing = false;
  }

  clear() {
    this.queue = [];
  }
  
  get length() {
    return this.queue.length;
  }
}

// Global singleton queue to ensure rate limits across the entire app
// 6000ms delay ensures max 10 requests per minute (Gemini free tier allows 15 RPM)
export const translationQueue = new RequestQueue(6000);
