import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSeo } from '../src/services/seo.service.js';

test('SEO analyzer returns an explainable bounded score', () => {
  const result = analyzeSeo({
    keyword: 'youtube seo',
    title: 'YouTube SEO: A Practical Step-by-Step Guide for Creators',
    description: 'YouTube SEO helps creators publish clearer, more useful content. In this practical guide, you will learn a repeatable research and metadata workflow.\n\n00:00 Introduction\n01:10 Title research\n04:20 Description structure\n\nSubscribe for more creator guides and comment with your next topic. #YouTubeSEO #CreatorTips',
    tags: ['youtube seo', 'youtube seo tutorial', 'creator tips', 'video seo', 'youtube growth', 'metadata guide']
  });
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(result.checks.length, 9);
  assert.ok(result.checks.every((check) => typeof check.tip === 'string'));
  assert.ok(result.tagSuggestions.length > 0);
});

test('SEO analyzer handles blank metadata without throwing', () => {
  const result = analyzeSeo({});
  assert.equal(result.score, 32); // Keyword checks are neutral and blank text has no excess capitalization.
  assert.equal(result.metrics.titleLength, 0);
  assert.equal(result.metrics.tagCount, 0);
});
