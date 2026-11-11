/** A single owner serializes all document-producing entry points. */
export function createExportOperation(onBusyChange: (busy: boolean) => void) {
  let activeController: AbortController | null = null;

  return {
    cancel(): void {
      activeController?.abort(
        new DOMException('Export cancelled', 'AbortError'),
      );
    },
    async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
      if (activeController) throw new Error('已有导出任务正在进行');
      const controller = new AbortController();
      activeController = controller;
      onBusyChange(true);
      try {
        return await operation(controller.signal);
      } finally {
        activeController = null;
        onBusyChange(false);
      }
    },
  };
}
