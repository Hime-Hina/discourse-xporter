import { describe, expect, it, vi } from 'vitest';
import { createExportOperation } from '../src/runtime/export-operation';

describe('document operation ownership', () => {
  it('serializes all callers and releases once after an error', async () => {
    const busy = vi.fn();
    const operation = createExportOperation(busy);
    let fail: ((error: Error) => void) | undefined;
    const first = operation.run(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    await expect(operation.run(async () => undefined)).rejects.toThrow(
      '已有导出任务',
    );
    expect(busy.mock.calls).toEqual([[true]]);
    fail?.(new Error('fixture failure'));
    await expect(first).rejects.toThrow('fixture failure');
    expect(busy.mock.calls).toEqual([[true], [false]]);
    await expect(operation.run(async () => 'finished')).resolves.toBe(
      'finished',
    );
  });

  it('keeps ownership until cancelled work has actually settled', async () => {
    const busy = vi.fn();
    const operation = createExportOperation(busy);
    let signal: AbortSignal | undefined;
    let settle: (() => void) | undefined;
    const first = operation.run((taskSignal) => {
      signal = taskSignal;
      return new Promise<void>((resolve) => {
        settle = resolve;
      });
    });
    operation.cancel();
    expect(signal?.aborted).toBe(true);
    await expect(operation.run(async () => undefined)).rejects.toThrow(
      '已有导出任务',
    );
    expect(busy.mock.calls).toEqual([[true]]);
    settle?.();
    await first;
    expect(busy.mock.calls).toEqual([[true], [false]]);
  });
});
