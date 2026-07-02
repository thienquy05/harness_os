import { describe, expect, it, vi } from 'vitest';

const mockPoolEnd = vi.fn();
vi.mock('@harness-os/core', () => ({
  createPool: vi.fn(() => ({ end: mockPoolEnd })),
  getDecisionById: vi.fn(),
  recordDecision: vi.fn(),
}));
vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(() => ({ question: vi.fn(async () => 'y'), close: vi.fn() })),
}));

describe('approve main', () => {
  it('refuses to run when stdin is not an interactive TTY', async () => {
    const { main } = await import('./approve.js');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['5'], false);
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('interactive TTY'));
    errorSpy.mockRestore();
  });

  it('exits 2 with a usage message when no decision id is given', async () => {
    const { main } = await import('./approve.js');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main([], true);
    expect(code).toBe(2);
    errorSpy.mockRestore();
  });

  it('rejects approving a decision that is not pending_approval', async () => {
    const core = await import('@harness-os/core');
    vi.mocked(core.getDecisionById).mockResolvedValue({
      id: 5,
      status: 'approved',
      rationale: 'r',
      risk_level: 'critical',
      project_path: '/p',
      actor: 'x',
      action: 'y',
      constitution_rules_applied: [],
      approvals: [],
      related_decision_id: null,
      created_at: '',
    });
    const { main } = await import('./approve.js');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['5'], true);
    expect(code).toBe(1);
    errorSpy.mockRestore();
  });

  it('approves a pending decision after TTY confirmation', async () => {
    const core = await import('@harness-os/core');
    vi.mocked(core.getDecisionById).mockResolvedValue({
      id: 5,
      status: 'pending_approval',
      rationale: 'financial logic',
      risk_level: 'critical',
      project_path: '/p',
      actor: 'x',
      action: 'y',
      constitution_rules_applied: [],
      approvals: [],
      related_decision_id: null,
      created_at: '',
    });
    vi.mocked(core.recordDecision).mockResolvedValue({ id: 6 });
    const { main } = await import('./approve.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['5'], true);
    expect(code).toBe(0);
    expect(core.recordDecision).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'approve_decision', relatedDecisionId: 5, status: 'approved' }),
    );
    logSpy.mockRestore();
  });
});
