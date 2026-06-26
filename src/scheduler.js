export class QuotaScheduler {
  constructor({ quotaState, intervalMs, jitterMs = 1500, logger = console }) {
    this.quotaState = quotaState;
    this.intervalMs = Math.max(1000, intervalMs);
    this.jitterMs = Math.max(0, jitterMs);
    this.logger = logger;
    this.timer = null;
    this.running = false;
    this.lastPollAt = null;
    this.lastPollError = null;
  }

  start({ runImmediately = true } = {}) {
    if (this.timer) {
      return;
    }
    if (runImmediately) {
      void this.poll();
    }
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async poll() {
    if (this.running) {
      return null;
    }
    this.running = true;
    try {
      const result = await this.quotaState.checkAll({ jitterMs: this.jitterMs });
      this.lastPollAt = new Date().toISOString();
      this.lastPollError = null;
      return result;
    } catch (error) {
      this.lastPollError = error instanceof Error ? error.message : String(error);
      this.logger.error?.("Quota poll failed", error);
      return null;
    } finally {
      this.running = false;
    }
  }
}
