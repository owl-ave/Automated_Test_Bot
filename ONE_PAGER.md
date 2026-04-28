# Automated App Testing Bot — Engineering One-Pager

## What We Built

A **fully autonomous mobile app testing platform** that triggers on every GitHub PR, uses AI to understand code changes, generates test scenarios, executes them on real devices (Android + iOS), and reports results — all with **zero human intervention**.

---

## Why It Took Significant Engineering Time

### 1. Not a Simple Script — It's a 16-Module Pipeline

This isn't a wrapper around a test runner. It's a complete **state machine** orchestrating 16 independent modules in sequence:

| Phase | What Happens |
|-------|-------------|
| **App Build** | Detects framework (React Native / Flutter / Native), builds APK + IPA from PR branch |
| **Code Analysis** | Parses git diff, scans repo structure, maps screens and navigation flows |
| **AI Test Generation** | Claude analyzes the app, generates Gherkin BDD scenarios including edge cases, negative tests, i18n, and chatbot jailbreak tests |
| **Test Execution** | Converts scenarios to Appium code, runs on **8 real devices** via BrowserStack (Pixel 8, iPhone 17 Pro, Galaxy Tab S9, iPad Air, etc.) |
| **AI Validation** | Claude Vision inspects screenshots to judge pass/fail, filters false positives, generates bug reproduction steps |
| **Self-Healing** | When UI elements change, AI finds alternative locators automatically (5-level fallback: accessibility ID → resource-id → text → XPath → Vision) |
| **Reporting** | Posts structured results on the PR, adds labels, blocks merge on critical failures |
| **Auxiliary Testing** | Accessibility (TalkBack/VoiceOver), performance (FPS, memory, battery), security (MobSF, SSL, PII), visual regression (Percy), chaos testing (network drops, interrupts, rotation) |

### 2. Cross-Platform Complexity

Every module had to work across **two platforms** and **three frameworks**:

- **Platforms**: Android + iOS (different build tools, different locator strategies, different accessibility APIs)
- **Frameworks**: React Native, Flutter, Native (Kotlin/Swift) — each has its own build system, project structure, and element hierarchy
- **Devices**: 8 physical devices with different screen sizes, OS versions, and capabilities

A single test scenario must compile, execute, and validate correctly across all combinations.

### 3. Hardened for Production Reliability

External services (BrowserStack, Claude API, GitHub API) are inherently flaky. The system implements:

- **Exponential backoff retries** with configurable max attempts
- **Critical vs non-critical module classification** — auxiliary failures don't abort the pipeline
- **False positive filtering** — cross-device verification before marking a test as failed
- **Popup/alert handling** — unexpected system dialogs are auto-dismissed
- **GitHub App token refresh** — handles token expiry during long runs (up to 120 min)

### 4. AI Integration Is Non-Trivial

Claude is used in **four distinct roles**, each requiring carefully engineered prompts:

1. **Code Analyst** — Understands mobile app structure from source code
2. **Test Strategist** — Generates comprehensive BDD scenarios with edge cases
3. **Visual Judge** — Inspects device screenshots to determine pass/fail
4. **Self-Healer** — Finds replacement UI locators when elements change

Each role needed iterative prompt engineering, output parsing, error handling, and timeout management.

### 5. Historical Learning System

A PostgreSQL + pgvector database stores test run history with **384-dimensional embeddings** for:

- **Failure pattern matching** — "this failure looks like one we saw 2 weeks ago"
- **Flaky test detection** — identifies tests that intermittently fail
- **Risk-based prioritization** — ML scoring to run high-risk tests first

### 6. Full Dashboard + CI/CD

- **Dashboard**: Dark-themed web UI (Cloudflare Workers) with live log streaming, run history, branch analysis, pass/fail trends, and health scoring
- **GitHub Action**: 289-line workflow handling framework detection, conditional macOS/Ubuntu runners, secret validation, artifact upload, and PR commenting

---

## By the Numbers

| Metric | Value |
|--------|-------|
| TypeScript source files | 102 |
| Lines of code (source) | ~16,700 |
| Lines of code (tests) | ~1,900 |
| Pipeline modules | 16 |
| AI prompt templates | 4 |
| Supported frameworks | 3 (React Native, Flutter, Native) |
| Target platforms | 2 (Android + iOS) |
| Real devices in matrix | 8 |
| External service integrations | 7 (Claude, BrowserStack, Percy, GitHub, PostgreSQL, MobSF, Cloudflare) |
| Test categories | 8 (functional, accessibility, performance, security, visual, chaos, API, AI validation) |

---

## What Makes This Hard (Industry Context)

Mobile app testing automation is one of the most complex domains in software engineering:

- **No equivalent open-source tool** does AI-driven test generation + real device execution + self-healing + cross-platform in one pipeline
- **Commercial tools** (Applitools, Testim, Katalon) each solve one piece — we built the full chain
- **BrowserStack + Appium alone** require significant expertise; adding AI generation and validation on top is novel
- **Self-healing** is a feature that enterprise tools (Healenium, Testim) charge premium pricing for — we built it with Claude Vision

---

## Summary

The time investment reflects the **breadth and depth** of what was built: a production-grade, AI-powered, cross-platform, self-healing mobile testing platform with 16 modules, 8 real devices, 7 external integrations, and a full dashboard — not a prototype or proof of concept.
