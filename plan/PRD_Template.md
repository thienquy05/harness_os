# Product Requirements Document (PRD) Template

## How to Use This Template

This Product Requirements Document (PRD) template helps teams build customer-centric, outcome-driven products and works equally well for humans and AI prototyping tools.

At first glance, it's intentionally lightweight and easy to fill out. Each section includes guidance explaining:

- Why the section exists
- What to include
- What good looks like
- Common pitfalls to avoid

### Who This Template Is For

- **New to PRDs?** Read the guidance as you write.
- **Experienced PM?** Skip the guidance and focus on the content.
- **Using AI tools?** Make sure the following sections are completed:
  - Problem Alignment
  - Target Users
  - Key Capabilities
  - UX Principles
  - Constraints
  - Success Metrics

These sections provide the context and guardrails AI needs to produce realistic outputs.

---

> Template by Jimmy Rodriguez.
>
> For guidance on using this template, read the associated documentation.
>
> Want AI prompts for every section and a tool-by-tool handoff guide for Cursor, v0, Bolt, Replit, and Lovable? The AI-Ready PRD System includes both.

---

# [PRD] Product Initiative Name

**Suggested Format:**

```text
[PRD] Description of Product Initiative
```

### Guidance

#### Purpose

Ensure anyone scanning a list of documents immediately understands what this PRD is about.

#### What to Include

- The fact that this is a PRD
- A clear description of the product initiative

#### Good Examples

- `[PRD] B2B Merchant Dashboard Navigation Redesign`
- `[PRD] Improving Checkout Conversion for Ecommerce Merchants`

#### Common Pitfalls

- Internal codenames
- Company acronyms
- Vague titles such as "Dashboard Improvements"

---

# Problem Alignment (or Opportunity)

**Describe the core customer problem or opportunity this initiative addresses.**

## Problem Statement

[Clearly describe the customer problem.]

### Guidance

#### Purpose

Explain what is broken or missing today, why it matters to customers, and why it matters to the business.

#### What to Include

- Customer problem in plain language
- Evidence of the problem
  - Customer feedback
  - Behavioral data
  - Support tickets
- Business impact if not addressed

#### What Good Looks Like

- Customer-centric
- Grounded in data
- Easy to understand

#### Common Pitfalls

- Describing symptoms instead of root causes
- Jumping to solutions too early

---

## Why Now

[Explain why this problem should be solved now.]

### Guidance

#### Purpose

Justify timing and priority.

#### What to Include

- Strategic priorities
- Roadmap dependencies
- Market shifts
- Customer expectation changes
- Cost of delay

#### What Good Looks Like

- Time-bound
- Specific
- Shows consequences of inaction

#### Common Pitfalls

- Repeating the problem statement
- Lack of urgency

---

## Background & Evidence

[Summarize relevant research, data, and insights.]

### Guidance

#### Purpose

Provide credibility and context.

#### What to Include

- Customer interviews
- Survey findings
- Product analytics
- Revenue or retention metrics
- Market research
- Competitive analysis

#### What Good Looks Like

- Focuses on patterns
- Metrics support the problem

#### Common Pitfalls

- Data dumps
- Unrelated research

---

# Solution Summary

[Provide a high-level summary of the proposed solution.]

### Guidance

#### Purpose

Describe the overall approach without diving into detailed requirements.

#### What to Include

- Solution direction
- Key principles
- Major assumptions

#### What Good Looks Like

- Explainable in under 60 seconds
- Clearly addresses the problem

#### Common Pitfalls

- Turning it into a feature list
- Over-specifying implementation

---

# Target Users

## Primary Users

[List primary users.]

## Secondary Users

[List secondary users.]

## Explicitly Not For

[List excluded audiences.]

### Guidance

#### Purpose

Clarify who this solution is for—and who it is not for.

#### What to Include

- Real personas
- Roles
- Clear exclusions

#### What Good Looks Like

- Specific
- Opinionated
- Prevents over-design

#### Common Pitfalls

- Trying to serve everyone

---

# Definition of Success

**List 3–5 outcome-focused success metrics.**

| Metric | Baseline | Target |
|----------|----------|----------|
| Metric 1 | | |
| Metric 2 | | |
| Metric 3 | | |

### Guidance

#### Purpose

Define success using outcomes rather than outputs.

#### What to Include

- Customer outcomes
- Business outcomes
- Baselines

#### Examples

- Time saved
- Task completion rate
- Adoption rate
- Retention
- Revenue impact

#### Common Pitfalls

- Vanity metrics
- Feature-count metrics

---

# UX / Design Principles

List 3–5 principles guiding how the product should feel and behave.

1. Principle #1
2. Principle #2
3. Principle #3
4. Principle #4
5. Principle #5

### Guidance

#### Purpose

Guide design decisions for humans and AI tools.

#### What to Include

- Emotional tone
- Interaction philosophy
- Accessibility expectations

#### What Good Looks Like

- Short
- Actionable
- Influences tradeoffs

#### Common Pitfalls

- Generic statements like "user-friendly"

---

# Scope & Capabilities

## Scope Summary

[One-paragraph summary of what is included and excluded.]

### Guidance

#### Purpose

Set boundaries and protect focus.

#### What to Include

- Included work
- Excluded work

#### Common Pitfalls

- Repeating the solution summary

---

## Key Capabilities

List outcome-based capabilities the system must support.

### Capability 1

[Description]

### Capability 2

[Description]

### Capability 3

[Description]

### Guidance

#### Purpose

Translate the solution into capabilities that AI tools can understand.

#### What to Include

- Simple capability statements
- Testable outcomes

#### Common Pitfalls

- Technical requirements
- UI specifications

---

## In-Scope User Stories

Prioritized user stories using real personas.

### User Story 1

```text
As a [persona],
I want to [action],
So that [outcome].
```

### User Story 2

```text
As a [persona],
I want to [action],
So that [outcome].
```

### Guidance

#### Purpose

Align on user value and expected behavior.

#### What Good Looks Like

- Specific
- Outcome-focused
- Testable

#### Common Pitfalls

- Implementation details disguised as stories

---

## Out of Scope

List features intentionally excluded or deferred.

- Item 1
- Item 2
- Item 3

### Guidance

#### Purpose

Make tradeoffs explicit.

#### What to Include

- Known exclusions
- Deferred ideas

#### Common Pitfalls

- Leaving this section empty

---

# Delivery, Risks & Open Questions

## Release Plan & Milestones

### Milestone 1

- Goal:
- Target Date:
- Success Criteria:

### Milestone 2

- Goal:
- Target Date:
- Success Criteria:

### Guidance

#### Purpose

Align on timing, rollout strategy, and post-launch evaluation.

#### What to Include

- Milestones
- Rollout phases
- Experiment plans
- Metric reviews

#### Common Pitfalls

- Shipping dates without validation plans

---

## Constraints & Assumptions

### Constraints

- Technical constraints
- Legal constraints
- Resource constraints

### Assumptions

- Assumption 1
- Assumption 2
- Assumption 3

### Guidance

#### Purpose

Define boundaries that shape the solution.

#### What Good Looks Like

- Explicit
- Realistic

#### Common Pitfalls

- Hidden assumptions

---

## Open Questions & Risks

### Open Questions

1. Question 1
2. Question 2
3. Question 3

### Risks

| Risk | Impact | Mitigation |
|--------|--------|--------|
| Risk 1 | | |
| Risk 2 | | |

### Dependencies

- Dependency 1
- Dependency 2
- Dependency 3

### Guidance

#### Purpose

Surface uncertainty early and reduce false confidence.

#### What to Include

- Open questions
- Risks
- Dependencies

#### What Good Looks Like

- Honest
- Actively revisited

#### Common Pitfalls

- Using this section as a parking lot