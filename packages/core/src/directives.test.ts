import { describe, expect, it } from 'vitest';
import { requestReviewDirective } from './directives.js';

// A model rates its own output higher than equally good output from others, so the review must come
// from a separate agent with fresh context, never from the agent that wrote the change.
describe('requestReviewDirective', () => {
  it('asks for an independent, fresh-context reviewer that sees only the change', () => {
    const d = requestReviewDirective('medium', ['src/a.ts']);
    expect(d).toMatchObject({ action: 'invoke_agent', agent: 'code-reviewer', files: ['src/a.ts'], independent: true });
    expect(d.reason).toMatch(/not the agent that wrote/i);
    expect(d.reason).toMatch(/fresh context/i);
  });

  it('recommends the stronger model for high and critical risk, the faster one for medium', () => {
    expect(requestReviewDirective('critical', ['a.ts'])).toMatchObject({ agent: 'security-reviewer', model: 'opus' });
    expect(requestReviewDirective('high', ['a.ts'])).toMatchObject({ model: 'opus' });
    expect(requestReviewDirective('medium', ['a.ts'])).toMatchObject({ model: 'sonnet' });
  });

  it('requires no review for low risk', () => {
    expect(requestReviewDirective('low', ['a.md']).action).toBe('no_review_required');
  });
});
