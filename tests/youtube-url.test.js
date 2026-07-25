import test from 'node:test';
import assert from 'node:assert/strict';
import { extractVideoId } from '../src/services/youtube.service.js';

const id = 'dQw4w9WgXcQ';
for (const input of [
  id,
  `https://www.youtube.com/watch?v=${id}`,
  `https://youtu.be/${id}?si=abc`,
  `https://www.youtube.com/shorts/${id}`,
  `https://www.youtube.com/embed/${id}`,
  `https://www.youtube.com/live/${id}`
]) test(`extracts video ID from ${input}`, () => assert.equal(extractVideoId(input), id));

test('rejects non-YouTube and malformed URLs', () => {
  assert.equal(extractVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(extractVideoId('not a youtube url'), null);
});
