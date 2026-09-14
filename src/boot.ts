export class Boot {
  private readonly root: HTMLElement;
  private readonly status: HTMLElement;
  private readonly fill: HTMLElement;
  private dismissed = false;

  constructor() {
    this.root = document.querySelector("#boot") as HTMLElement;
    this.status = document.querySelector("#boot-status") as HTMLElement;
    this.fill = document.querySelector("#boot-fill") as HTMLElement;
  }

  show(message: string, amount: number): void {
    if (this.dismissed) return;
    this.status.textContent = message;
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, amount)) * 100)}%`;
  }

  fail(error: unknown): void {
    const reason = error instanceof Error ? error.message : "Something failed while opening the lawn.";
    this.status.textContent = `Could not load — ${reason}`;
    this.root.classList.add("boot-error");
    this.fill.style.width = "100%";
  }

  dismiss(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    document.body.dataset.booted = "1";
    this.root.classList.add("boot-out");
    window.setTimeout(() => this.root.remove(), 420);
  }

  static frame(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
}
