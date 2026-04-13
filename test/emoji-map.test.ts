import { describe, it, expect } from 'vitest';
import { replaceEmoji } from '../src/core/emoji-map';

describe('replaceEmoji', () => {
  it('replaces known shortcodes', () => {
    expect(replaceEmoji(':smile:')).toBe('😊');
    expect(replaceEmoji(':rocket:')).toBe('🚀');
    expect(replaceEmoji(':+1:')).toBe('👍');
  });

  it('preserves unknown shortcodes', () => {
    expect(replaceEmoji(':unknown_thing:')).toBe(':unknown_thing:');
  });

  it('replaces multiple emoji in one line', () => {
    const result = replaceEmoji('Hello :smile: World :rocket: Done :+1:');
    expect(result).toBe('Hello 😊 World 🚀 Done 👍');
  });

  it('does NOT replace emoji inside inline code', () => {
    const input = '`code :smile:`';
    expect(replaceEmoji(input)).toBe('`code :smile:`');
  });

  it('does NOT replace emoji inside fenced code blocks', () => {
    const input = '```\n:smile: :rocket:\n```';
    expect(replaceEmoji(input)).toBe('```\n:smile: :rocket:\n```');
  });

  it('handles emoji adjacent to text', () => {
    const result = replaceEmoji('hello:smile:world');
    expect(result).toBe('hello😊world');
  });

  it('returns plain text unchanged', () => {
    const input = 'Just some regular text without emoji';
    expect(replaceEmoji(input)).toBe(input);
  });
});
