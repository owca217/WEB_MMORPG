export interface TimedNoticeTarget {
  textContent: string | null;
  hidden: boolean;
}

export class TimedNotice {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly target: TimedNoticeTarget) {}

  show(message: string, durationMs = 3000): void {
    this.clearTimer();
    this.target.textContent = message;
    this.target.hidden = false;
    this.timer = setTimeout(() => {
      this.target.textContent = "";
      this.target.hidden = true;
      this.timer = undefined;
    }, durationMs);
  }

  destroy(): void {
    this.clearTimer();
    this.target.textContent = "";
    this.target.hidden = true;
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
