**Story:** As <the player / the developer / the AI agent>, I want <capability>
so that <the actual value — if this clause is weak, question the feature>.

**Problem today:** <what's painful/missing right now, one or two sentences>

## Requirements
- MUST <hard requirement — the feature is wrong without it>
- MUST <hard requirement>
- SHOULD <strong preference, negotiable under constraint>
- NEVER <guardrail — what this must not do/break>

**Non-goals:** <explicitly out of scope — prevents drift while implementing>

**Design notes:** <approach, affected systems, patterns to follow — cite ADRs/GDDs
with backticked paths; name the reference implementation if one exists>

**Mockup:** <for UX/UI: `kb mockup <board> <card> <file.html>` a live clickable
mockup — see SKILL "HTML mockups on cards". One direction per card when comparing.>

## Acceptance
- [ ] Given <precondition>, when <action>, then <observable outcome>
- [ ] Given <precondition>, when <action>, then <observable outcome>
- [ ] Edge: <the boundary/failure case that most likely breaks>
- [ ] Verified via <test / playmode / screenshot — name the exact check>
