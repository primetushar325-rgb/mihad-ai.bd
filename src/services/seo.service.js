const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'this', 'that', 'your', 'you']);

export function analyzeSeo({ title = '', description = '', tags = [], keyword = '' }) {
  const normalizedTags = Array.isArray(tags) ? tags.filter(Boolean) : String(tags).split(',').map((x) => x.trim()).filter(Boolean);
  const checks = [];
  const add = (id, label, passed, points, tip) => checks.push({ id, label, passed, points, earned: passed ? points : 0, tip });
  const cleanTitle = String(title).trim();
  const cleanDescription = String(description).trim();
  const needle = String(keyword).trim().toLowerCase();

  add('title-length', 'Title is 40–70 characters', cleanTitle.length >= 40 && cleanTitle.length <= 70, 18, 'Aim for a clear, compelling title between 40 and 70 characters.');
  add('keyword-title', 'Primary keyword appears in title', !needle || cleanTitle.toLowerCase().includes(needle), 16, 'Place the primary keyword naturally near the beginning of the title.');
  add('description-length', 'Description is at least 200 characters', cleanDescription.length >= 200, 16, 'Add a useful summary, context, links, and a call to action.');
  add('keyword-description', 'Keyword appears in first 120 characters', !needle || cleanDescription.slice(0, 120).toLowerCase().includes(needle), 12, 'Mention the topic naturally in the opening two lines.');
  add('tags-count', 'Uses 5–15 focused tags', normalizedTags.length >= 5 && normalizedTags.length <= 15, 12, 'Use a mix of exact, broad, and long-tail tags.');
  add('hashtags', 'Description contains 1–3 hashtags', (cleanDescription.match(/#[\p{L}\p{N}_-]+/gu) || []).length >= 1 && (cleanDescription.match(/#[\p{L}\p{N}_-]+/gu) || []).length <= 3, 8, 'Use one to three relevant hashtags—avoid tag stuffing.');
  add('chapters', 'Description includes chapter timestamps', /(?:^|\n)(?:00:00|0:00)\s+/m.test(cleanDescription), 8, 'For longer videos, add chapters beginning with 00:00.');
  add('cta', 'Description includes a clear call to action', /subscribe|comment|watch next|learn more|visit|download/i.test(cleanDescription), 6, 'Invite viewers to take one clear next action.');
  add('no-clickbait', 'Title avoids excessive capitalization', !/[A-Z]{8,}/.test(cleanTitle), 4, 'Use emphasis sparingly to keep the title credible.');

  const score = checks.reduce((sum, x) => sum + x.earned, 0);
  const words = `${cleanTitle} ${cleanDescription}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
  const frequencies = words.reduce((map, word) => {
    if (!stopWords.has(word)) map.set(word, (map.get(word) || 0) + 1);
    return map;
  }, new Map());
  const suggestions = [...frequencies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word]) => word);

  return {
    score,
    grade: score >= 90 ? 'Excellent' : score >= 75 ? 'Strong' : score >= 55 ? 'Good start' : 'Needs work',
    checks,
    metrics: { titleLength: cleanTitle.length, descriptionLength: cleanDescription.length, tagCount: normalizedTags.length },
    keywordSuggestions: suggestions,
    tagSuggestions: [...new Set([needle, ...suggestions, ...suggestions.slice(0, 4).map((x) => `${needle} ${x}`.trim())])].filter(Boolean).slice(0, 12)
  };
}
