# Ways of Working

These rules are **MANDATORY** whenever the user invokes `/implement-spec`. They override any conflicting default behavior. If a rule conflicts with another instruction, raise the conflict — do not silently choose.

## Core principles

1. **TDD is non-negotiable.** No production code without a failing test that justifies it.
2. **Very small steps.** One logical change at a time. If the commit message needs the word "and", split the step.
3. **Stop after every step.** Wait for explicit user approval before moving on. Do not batch.
4. **Ask, don't assume.** If the spec is ambiguous, the design is unclear, or you'd be guessing — stop and ask.
5. **Simple over clever.** Readable, boring code wins. No speculative generality, no premature abstraction.
6. **Clean architecture.** Respect existing module boundaries (see `.claude/CLAUDE.md` for the 16-module pipeline). Don't reach across modules without justifying it.

## The TDD cycle

### Red — write a failing test
- The test must fail **for the right reason**: an assertion failure, not a compile/import error.
- If the test passes immediately, the test is wrong. Rewrite it before continuing.
- Run the test and paste the actual failure output. Don't claim red without proof.

### Green — minimum code to pass
- Smallest amount of code that turns the test green. Hard-code values if that's smallest.
- No "while I'm here" cleanup. No features the test didn't ask for. No error handling for paths the test doesn't exercise.
- Run the test and show it passing. Don't claim green without proof.

### Refactor — only on green
- Optional. Only do it if there's a real smell: duplication, unclear naming, dead code introduced this step.
- **Never mix refactor with behavior change in the same step.** Split into two commits.
- Tests stay green throughout the refactor.

## Step granularity

One step = one of these:
- A single failing test plus the implementation that makes it pass.
- A pure refactor (no behavior change, tests still green).
- A test fixture or scaffolding setup (no production code).

If a step touches more than one file for non-mechanical reasons, ask whether to split it.

## Output format per step

Use this format every step. No exceptions.

1. **Step description** — what you're doing this step, and which acceptance criterion it advances.
2. **Failing test** — the test code, the command to run it, and the actual failure output pasted verbatim.
3. **STOP — wait for the user's approval before writing implementation.**
4. **Minimal implementation** — the smallest diff that turns the test green.
5. **Test run showing green** — paste the passing output.
6. **Refactor** — if any. Otherwise say "no refactor needed this step."
7. **Suggested commit message** — Conventional Commits style:
   - `test: <what the test covers>` for the failing-test commit
   - `feat: <what the user can now do>` for the implementation
   - `refactor: <what improved>` for refactor-only commits
   Each step yields one or two commits, not one giant one.
8. **STOP — wait for the user's approval before starting the next step.**

## Definition of Done (per step)

A step is done only when **all** of these are true:
- Relevant tests are green.
- TypeScript typecheck passes (`tsc --noEmit`).
- Lint passes (`npm run lint`) if the project has it.
- The diff contains nothing unrelated to this step.
- A commit message has been drafted.

If any are false, the step is not done — fix it or surface it.

## Stop conditions / push-back

- **Ambiguous spec** — stop and ask. Do not interpret silently.
- **Disagreement with the design** — if the spec implies an approach you think is wrong, raise it before writing the test, not after implementing.
- **Two failures in a row for the same reason** — stop. The approach is probably wrong; surface the problem rather than retrying a third time.
- **Scope creep** — if a step requires changes outside the spec's scope, stop and propose splitting.
- **Missing dependency / tool** — if a required test framework, library, or env var is missing, stop and ask. Do not improvise.

## Existing tests

- If a test already covers the area, **extend it** rather than creating a parallel file.
- If an existing test is wrong (asserts the wrong thing, or is flaky), fix it as a separate `refactor:` or `fix:` step *before* writing the new feature's test. Never silently change an existing test's intent in the same step as new behavior.

## Project-specific notes

These come from `.claude/CLAUDE.md` and user memory — they apply to every step:

- **TypeScript strict mode.** No `any` unless justified inline.
- **Modules export a single `run()` function** taking pipeline context, returning results.
- **Errors are logged, not thrown** — modules must never crash the pipeline (use try/catch).
- **Structured logging only** via `src/utils/logger.ts`.
- **AI prompts** live in `src/ai/prompts/` as template functions, never inline.
- **Appium locators** prefer `accessibility ID` over XPath.
- **Platform-specific code** in separate files (`android-*.ts` / `ios-*.ts`).
- **Claude SDK preference**: Agent SDK only. Do **not** introduce `@anthropic-ai/sdk`.
- **No new comments** unless the WHY is non-obvious. Don't narrate what the code does.
- **No new docs/markdown files** unless the spec asks for them.
