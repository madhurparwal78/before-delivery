export interface Screen {
  render(): Promise<void>;
  destroy(): void;
}
