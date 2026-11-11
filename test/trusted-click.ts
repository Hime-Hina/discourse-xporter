import { vi } from 'vitest';

/** Simulate the browser event boundary without claiming a real trusted browser click. */
export function captureUserClicks(): (element: Element) => Promise<void> {
  const clickListeners = new WeakMap<
    EventTarget,
    EventListenerOrEventListenerObject[]
  >();
  const original = EventTarget.prototype.addEventListener;
  vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(
    function (this: EventTarget, type, listener, options) {
      if (type === 'click' && listener) {
        const listeners = clickListeners.get(this) ?? [];
        listeners.push(listener);
        clickListeners.set(this, listeners);
      }
      original.call(this, type, listener, options);
    },
  );
  return async (element) => {
    const event = {
      isTrusted: true,
      preventDefault() {},
      stopPropagation() {},
    } as MouseEvent;
    for (const listener of clickListeners.get(element) ?? []) {
      if (typeof listener === 'function') await listener.call(element, event);
      else listener.handleEvent(event);
    }
    await Promise.resolve();
    await Promise.resolve();
  };
}
