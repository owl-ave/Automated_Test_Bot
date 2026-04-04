# Automated Testing Bot

## Instructions for Claude
- **Save tokens**: Keep responses short and concise. Don't repeat what's already known. Don't over-explain.
- **Don't read entire files** unnecessarily — read only the specific sections you need.
- **Write code directly** — don't describe what you're going to do, just do it.
- **No verbose comments** in code — only add comments where logic is non-obvious.
- **Batch work** — do multiple things in one response instead of spreading across many turns.
- **Skip confirmations** like "I'll now do X" — just do X.
- **Refer to plan.md** for module details instead of re-explaining them.

## Project Overview
A fully automated, zero human intervention testing bot for **Android and iOS mobile apps**. Triggers on GitHub PRs — reads the mobile app codebase, understands the app, generates BDD feature files, executes tests on **real devices via BrowserStack App Automate**, and reports results back on the PR.

**Target Platforms**: Android (native/React Native/Flutter) + iOS (native/React Native/Flutter)

## Architecture
The bot is built as a modular pipeline with 16 modules:

```
PR Raised → GitHub Action Triggers Bot
  → [0] App Builder        → builds .apk/.ipa → uploads to BrowserStack
  → [1] Code Reader        → [2] App Analyzer      → [3] Scenario Brain
  → [4] Test Writer         → [5] BrowserStack      → [6] AI Validator
  → [7] Self-Healer         → [8] PR Reporter       → [9] Accessibility
  → [10] Performance        → [11] API Tester       → [12] Security
  → [13] Visual Regression  → [14] Chaos Testing    → [15] Prioritizer
  → [16] Knowledge Base
```

## Tech Stack
- **Language**: Node.js / TypeScript
- **AI**: Claude API (code analysis, feature file generation, decision making, validation)
- **Test Framework**: Cucumber (Gherkin `.feature` files)
- **Mobile Automation**: Appium 2.0 (WebDriver protocol — controls Android + iOS)
- **Cloud Execution**: BrowserStack App Automate (real Android & iOS devices)
- **App Build**: Builds .apk (Android) / .ipa (iOS) from PR branch, uploads to BrowserStack
- **Accessibility**: Android Accessibility Scanner + iOS Accessibility Inspector (via Appium)
- **Performance**: Android Profiler metrics + iOS Instruments (via BrowserStack API)
- **API Testing**: Axios + swagger-parser + ajv (backend API validation)
- **Security**: MobSF (Mobile Security Framework) + Nuclei
- **Visual Regression**: BrowserStack Percy App SDK (mobile screenshot diffing)
- **Chaos Testing**: Appium network simulation + random gesture injection
- **Notifications**: GitHub PR comments + labels (integrated into reporter module)
- **Database**: PostgreSQL + pgvector (historical learning)
- **CI/CD**: GitHub Actions

## Project Structure
```
AutomatedTestingBot/
├── .claude/
│   └── CLAUDE.md                    # This file
├── .github/
│   └── workflows/
│       └── test-bot.yml             # GitHub Action — triggers on PR
├── src/
│   ├── index.ts                     # Entry point — orchestrates the pipeline
│   ├── modules/
│   │   ├── code-reader/             # Module 1: PR diff + repo scan
│   │   │   ├── diff-parser.ts       # Parses git diff output
│   │   │   ├── repo-scanner.ts      # Scans full repo structure
│   │   │   └── framework-detector.ts # Detects React Native/Flutter/Swift/Kotlin
│   │   ├── app-analyzer/            # Module 2: AI context engine
│   │   │   ├── industry-detector.ts # Classifies app industry
│   │   │   ├── screen-mapper.ts     # Maps all screens + navigation flows
│   │   │   ├── critical-path.ts     # Ranks flow importance
│   │   │   └── impact-analyzer.ts   # Change impact analysis from PR diff
│   │   ├── scenario-brain/          # Module 3: Feature file generator
│   │   │   ├── feature-generator.ts # Generates .feature files for mobile flows
│   │   │   ├── edge-case-engine.ts  # AI-powered edge case generation
│   │   │   ├── negative-tester.ts   # Invalid inputs, permission denials, back button
│   │   │   ├── jailbreak-tester.ts  # AI chatbot jailbreak testing (if app has AI)
│   │   │   └── i18n-tester.ts       # Multi-language + RTL test generation
│   │   ├── test-writer/             # Module 4: Feature → Appium code
│   │   │   ├── step-generator.ts    # Converts Gherkin → Appium actions
│   │   │   ├── element-finder.ts    # Smart element locator (accessibility ID, XPath, AI Vision)
│   │   │   ├── data-generator.ts    # Faker.js + AI test data
│   │   │   └── coverage-tracker.ts  # Code coverage per PR
│   │   ├── browserstack/            # Module 5: Execution engine
│   │   │   ├── app-uploader.ts      # Uploads .apk/.ipa to BrowserStack
│   │   │   ├── executor.ts          # Runs tests on BrowserStack App Automate
│   │   │   ├── device-matrix.ts     # iPhone 15, Pixel 8, Samsung S24, iPad, etc.
│   │   │   ├── network-conditions.ts # 4G, 3G, offline, airplane mode
│   │   │   └── gestures.ts          # Tap, swipe, pinch-zoom, long press, scroll
│   │   ├── ai-validator/            # Module 6: Output judgment
│   │   │   ├── comparator.ts        # Expected vs actual screen comparison
│   │   │   ├── visual-checker.ts    # AI Vision screenshot analysis
│   │   │   ├── decision-engine.ts   # Pass/Warn/Fail logic
│   │   │   ├── false-positive.ts    # Retry + cross-device verification
│   │   │   └── bug-reproducer.ts    # Appium log capture + minimal repro steps
│   │   ├── self-healer/             # Module 7: Auto-fix broken tests
│   │   │   ├── locator-healer.ts    # Alternative locator finder (ID, XPath, AI)
│   │   │   ├── flow-adapter.ts      # Handles unexpected screens/popups/alerts
│   │   │   └── feature-updater.ts   # Auto-updates outdated feature files
│   │   ├── reporter/                # Module 8: PR reporting
│   │   │   ├── pr-commenter.ts      # Posts results on GitHub PR
│   │   │   ├── label-manager.ts     # Adds pass/fail labels
│   │   │   ├── merge-blocker.ts     # Blocks merge on critical failure
│   │   │   └── (notifications removed — reporting via GitHub PR comments)
│   │   ├── accessibility/           # Module 9: Mobile accessibility
│   │   │   ├── android-a11y.ts      # Android Accessibility Scanner checks
│   │   │   ├── ios-a11y.ts          # iOS VoiceOver / Accessibility Inspector checks
│   │   │   └── fix-suggester.ts     # AI remediation suggestions
│   │   ├── performance/             # Module 10: Mobile performance
│   │   │   ├── app-metrics.ts       # App launch time, frame rate (FPS), jank detection
│   │   │   ├── memory-checker.ts    # RAM usage, memory leak detection
│   │   │   ├── battery-checker.ts   # Battery drain estimation
│   │   │   ├── app-size.ts          # APK/IPA size tracking per PR
│   │   │   └── regression-detector.ts # Baseline comparison
│   │   ├── api-tester/              # Module 11: API testing
│   │   │   ├── endpoint-discovery.ts # Finds API calls in mobile code
│   │   │   ├── schema-validator.ts  # OpenAPI/Swagger validation
│   │   │   ├── contract-tester.ts   # Request/response contract tests
│   │   │   └── rate-limiter.ts      # Rate limit verification
│   │   ├── security/                # Module 12: Mobile security
│   │   │   ├── mobsf-scanner.ts     # MobSF static + dynamic analysis
│   │   │   ├── ssl-pinning.ts       # SSL pinning validation
│   │   │   ├── data-storage.ts      # Insecure local storage checks
│   │   │   ├── pii-scanner.ts       # Sensitive data exposure detection
│   │   │   └── root-jailbreak.ts    # Root/jailbreak detection testing
│   │   ├── visual-regression/       # Module 13: Visual diffing
│   │   │   ├── percy-app.ts         # Percy App SDK screenshot upload
│   │   │   ├── dark-mode.ts         # Light/Dark theme testing
│   │   │   └── device-sizes.ts      # Multiple device screen size testing
│   │   ├── chaos/                   # Module 14: Resilience testing
│   │   │   ├── network-chaos.ts     # Airplane mode, WiFi off, slow network
│   │   │   ├── interrupt-tester.ts  # Incoming call, notification, app switch mid-flow
│   │   │   ├── orientation.ts       # Portrait/landscape rotation mid-flow
│   │   │   └── monkey-tester.ts     # Random gesture injection (like Android monkey)
│   │   ├── prioritizer/             # Module 15: ML test ordering
│   │   │   ├── risk-scorer.ts       # Predicts test failure probability
│   │   │   └── scheduler.ts         # Orders tests by risk score
│   │   └── knowledge-base/          # Module 16: Historical learning
│   │       ├── storage.ts           # PostgreSQL test run storage
│   │       ├── vector-search.ts     # pgvector similarity queries
│   │       ├── flaky-detector.ts    # Flaky test identification
│   │       └── feedback-loop.ts     # Developer feedback tracking
│   ├── ai/
│   │   ├── claude-client.ts         # Claude API wrapper
│   │   ├── prompts/                 # AI prompt templates
│   │   │   ├── code-analysis.ts     # Prompt for mobile code understanding
│   │   │   ├── feature-generation.ts # Prompt for .feature file creation
│   │   │   ├── validation.ts        # Prompt for output judgment
│   │   │   └── bug-report.ts        # Prompt for bug reproduction
│   │   └── vision.ts               # Claude Vision for screenshot analysis
│   ├── config/
│   │   ├── browserstack.ts          # BrowserStack App Automate config
│   │   ├── devices.ts               # Device matrix (Android + iOS devices)
│   │   ├── appium-caps.ts           # Appium desired capabilities
│   │   └── thresholds.ts            # Pass/warn/fail thresholds
│   └── utils/
│       ├── github.ts                # GitHub API helpers (PR, comments, labels)
│       ├── app-builder.ts           # Builds .apk/.ipa from PR branch
│       ├── logger.ts                # Structured logging
│       └── cache.ts                 # Repo scan caching
├── features/                        # Auto-generated .feature files go here
├── step-definitions/                # Auto-generated step definitions go here
├── test/                            # Unit tests for bot modules
├── plan.md                          # Detailed project plan
├── package.json
├── tsconfig.json
└── .env.example                     # Required env vars template
```

## Key Design Decisions
1. **Appium 2.0** (not Playwright/Selenium) — Appium is the standard for native mobile automation (Android + iOS)
2. **BrowserStack App Automate** (not BrowserStack Automate) — App Automate is specifically for mobile apps on real devices
3. **Claude API** as AI brain — best code understanding, vision capabilities for mobile screenshot analysis
4. **MobSF** for security (not ZAP) — MobSF is purpose-built for mobile app security analysis
5. **Percy App SDK** for visual regression — mobile-specific screenshot diffing from BrowserStack
6. **PostgreSQL + pgvector** for learning — keeps everything in one DB, vector search for similarity
7. **Modular pipeline** — each module is independent, can be enabled/disabled per repo via config

## Mobile-Specific Considerations
- **App Build Pipeline**: PR triggers a build (.apk for Android, .ipa for iOS) → uploads to BrowserStack
- **Element Locators**: accessibility ID (preferred), resource-id (Android), XPath, AI Vision fallback
- **Gestures**: tap, swipe, scroll, pinch-zoom, long press, drag-and-drop via Appium W3C Actions API
- **Platform Differences**: same feature file, different step definitions per platform (Android vs iOS)
- **Permissions**: handle OS-level permission popups (camera, location, notifications, etc.)
- **App Lifecycle**: test background/foreground, kill/restart, deep link resume
- **Push Notifications**: trigger via FCM (Android) / APNs (iOS) test API, verify in-app behavior
- **Offline Mode**: airplane mode, WiFi toggle, test data caching behavior
- **Interruptions**: incoming call, low battery, notification overlay mid-flow

## Environment Variables
```
GITHUB_APP_ID=              # GitHub App ID
GITHUB_APP_PRIVATE_KEY=     # GitHub App private key (PEM)
GITHUB_APP_INSTALLATION_ID= # GitHub App installation ID
GITHUB_WEBHOOK_SECRET=      # GitHub webhook secret
CLAUDE_AUTH_TOKEN=          # Claude auth token for Agent SDK
BROWSERSTACK_USERNAME=      # BrowserStack credentials
BROWSERSTACK_ACCESS_KEY=
PERCY_TOKEN=                # Percy App visual regression token
MOBSF_API_KEY=              # MobSF security scanner API key (optional)
DATABASE_URL=               # PostgreSQL connection string (for Module 16)
ANDROID_KEYSTORE_PATH=      # For signing debug APK (if needed)
IOS_PROVISIONING_PROFILE=   # For building IPA (if needed)
```

## Development Commands
```bash
npm install             # Install dependencies
npm run build           # Compile TypeScript
npm run dev             # Run locally (point to a test repo)
npm test                # Run unit tests for bot modules
npm run lint            # ESLint + Prettier check
```

## Coding Conventions
- TypeScript strict mode enabled
- Each module exports a single `run()` function that takes pipeline context and returns results
- All AI prompts are stored in `src/ai/prompts/` as template functions
- Use structured logging (JSON format) via `src/utils/logger.ts`
- Error handling: modules should never crash the pipeline — catch errors, log them, and continue
- BrowserStack sessions must always be properly closed (use try/finally)
- Appium element locators: always prefer `accessibility ID` over XPath for stability
- Platform-specific code should be in separate files (e.g., `android-a11y.ts`, `ios-a11y.ts`)

## Implementation Order
1. Phase 1 (Week 1-2): Foundation — project setup, GitHub Action, code reader, app build pipeline
2. Phase 2 (Week 3-4): AI Brain — app analyzer, feature generator, test writer (Appium steps)
3. Phase 3 (Week 5-6): Execution — BrowserStack App Automate, validator, self-healer, accessibility, visual regression, chaos
4. Phase 4 (Week 7-8): Security + Performance — MobSF, app metrics, API testing, bug reproduction, Slack/Teams
5. Phase 5 (Week 9-10): Intelligence — historical learning, ML prioritization, coverage, i18n
6. Phase 6 (Week 11-12): Polish + Deploy — optimization, feedback loop, cost tracking, deploy as GitHub App
