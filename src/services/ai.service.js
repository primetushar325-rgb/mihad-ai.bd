import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

const instructions = {
  titles: 'Return 8 compelling YouTube titles. Keep each under 70 characters and avoid deceptive clickbait.',
  descriptions: 'Return 3 polished YouTube descriptions with an opening hook, concise value summary, CTA, and optional chapter placeholders.',
  hashtags: 'Return 12 relevant hashtags, with no duplicates and no spam.',
  tags: 'Return 18 focused tags mixing exact, broad, and long-tail phrases.',
  thumbnails: 'Return 6 thumbnail concepts. For each include visual composition, 2-4 words of overlay text, color direction, and emotional hook.'
};

export async function generateContent({ type, topic, tone = 'professional', audience = 'general', keywords = [] }) {
  if (!instructions[type]) throw new AppError('Unsupported generation type.', 422, 'INVALID_AI_TYPE');
  if (!env.aiApiKey) return localFallback({ type, topic, tone, audience, keywords });

  const response = await fetch(`${env.aiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.aiApiKey}` },
    body: JSON.stringify({
      model: env.aiModel,
      temperature: 0.75,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are Mihad AI, a precise YouTube content strategist. Return only JSON with an "items" array of strings. Never invent factual claims. Do not imitate living creators.' },
        { role: 'user', content: `${instructions[type]}\nTopic: ${topic}\nTone: ${tone}\nAudience: ${audience}\nKeywords: ${keywords.join(', ') || 'none supplied'}` }
      ]
    }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new AppError('The AI provider is temporarily unavailable.', 502, 'AI_PROVIDER_ERROR');
  const payload = await response.json();
  try {
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content || '{}');
    if (!Array.isArray(parsed.items)) throw new Error('Missing items');
    return { items: parsed.items.map(String), source: 'ai' };
  } catch {
    throw new AppError('The AI response could not be parsed. Please retry.', 502, 'AI_RESPONSE_INVALID');
  }
}

function localFallback({ type, topic, tone, audience, keywords }) {
  const subject = String(topic).trim();
  const key = keywords[0] || subject;
  const sets = {
    titles: [
      `${subject}: The Complete Guide`, `How to Master ${subject} Step by Step`, `${subject} Explained Clearly`,
      `7 Practical ${subject} Tips That Actually Help`, `What Nobody Tells You About ${subject}`,
      `${subject} for Beginners: Start Here`, `A Smarter Way to Learn ${subject}`, `${subject}: From Idea to Result`
    ],
    descriptions: [
      `Discover a practical approach to ${subject} designed for ${audience} viewers. We break the process into clear, useful steps so you can move from idea to action.\n\nIn this video:\n00:00 Introduction\n00:30 The essentials\n03:00 Step-by-step walkthrough\n\nSubscribe for more ${tone} guides and share your biggest takeaway below. #${slug(key)} #Tutorial`,
      `Ready to understand ${subject} without the noise? This video covers the essential ideas, common mistakes, and actionable next steps. Watch to the end for a concise implementation checklist.\n\nIf this helped, like the video and subscribe for more. #${slug(key)}`,
      `${subject} can feel complicated—this guide makes it usable. Follow along for a focused walkthrough made for ${audience} viewers, then apply the key lessons to your own workflow.\n\nComment with your questions and watch the next video for a deeper dive. #${slug(key)}`
    ],
    hashtags: [`#${slug(key)}`, '#YouTubeTips', '#CreatorTips', '#ContentStrategy', '#VideoMarketing', '#Tutorial', '#HowTo', '#DigitalCreator', '#LearnOnYouTube', '#GrowthTips', '#ContentCreator', '#MihadAI'],
    tags: [key, `${key} tutorial`, `${key} for beginners`, `how to ${key}`, `${key} tips`, `${key} guide`, `learn ${key}`, `${key} step by step`, subject, `${subject} explained`, 'content strategy', 'youtube growth', 'creator tips', 'video tutorial', 'beginner guide', 'practical tips', 'how to guide', 'Mihad AI'],
    thumbnails: [
      `Split-screen before/after result — overlay: “THE DIFFERENCE” — neon green accents — strong transformation hook`,
      `Close crop of the core subject with one bold arrow — overlay: “START HERE” — black and green — clarity hook`,
      `Three-step visual path with the final result glowing — overlay: “3 EASY STEPS” — structured progress hook`,
      `Minimal hero object centered inside a neon frame — overlay: “FULL GUIDE” — premium technical feel`,
      `Common mistake marked red beside correct approach in green — overlay: “DON’T DO THIS” — risk-avoidance hook`,
      `Large number or result on left, subject on right — overlay: “REAL RESULTS” — evidence-led curiosity hook`
    ]
  };
  return { items: sets[type], source: 'template', note: 'Connect an AI provider in environment settings for model-generated output.' };
}

function slug(value) {
  return String(value).replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 30) || 'CreatorTips';
}
