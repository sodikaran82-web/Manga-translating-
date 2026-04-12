export class RequestQueue {
  private queue: (() => Promise<void>)[] = [];
  private activeCount = 0;
  private concurrency = 1;
  private delayMs: number;

  constructor(delayMs = 800, concurrency = 1) {
    this.delayMs = delayMs;
    this.concurrency = concurrency;
  }

  setDelay(ms: number) {
    this.delayMs = ms;
  }

  setConcurrency(count: number) {
    this.concurrency = count;
    this.processNext();
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
      
      this.processNext();
    });
  }

  private processNext() {
    if (this.activeCount >= this.concurrency || this.queue.length === 0) return;

    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        this.activeCount++;
        
        // Execute task without awaiting it here to allow parallel execution
        (async () => {
          try {
            await task();
          } finally {
            this.activeCount--;
            // Enforce rate limit delay before processing the next item from THIS slot
            if (this.queue.length > 0) {
              setTimeout(() => this.processNext(), this.delayMs);
            } else {
              this.processNext();
            }
          }
        })();
      }
    }
  }

  clear() {
    this.queue = [];
  }
  
  get length() {
    return this.queue.length;
  }
}

// Global singleton queue to ensure rate limits across the entire app
export const translationQueue = new RequestQueue(800);
