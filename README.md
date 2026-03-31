# Automated Testing Bot (Enterprise Edition)

[![CI/CD](https://github.com/AutomatedTestingBot/actions/workflows/test-bot.yml/badge.svg)](https://actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue.svg)](https://www.typescriptlang.org/)
[![Appium](https://img.shields.io/badge/Appium-w3c-magenta.svg)](https://appium.io/)

A fully automated, zero-human-intervention testing pipeline for Android and iOS mobile applications. It integrates directly into your GitHub Pull Requests, analyzes your codebase, dynamically generates Gherkin BDD test scenarios using advanced LLMs (Claude), executes tests across real device matrices on BrowserStack, and provides intelligent visual validation and chaos testing.

---

## 🚀 Key Features

*   **Self-Healing AI Generation (`scenario-brain`)**: Generates exact Appium-ready Gherkin scenarios based precisely on the changed code diff via LLM intelligence.
*   **Intelligent Execution Polling**: Production-ready Appium interactions leveraging dynamic gatekeeping, exponential backoff, and robust `waitForElement` logic to eliminate flaky UI test timeouts.
*   **Orchestrator Resilience**: The core pipeline utilizes a hardened state machine that segregates critical modules (Build, PR Parsing, Brain) from peripheral data-collection modules (Chaos, Accessibility). Unstable external networks trigger robust, automated retries.
*   **Real Device Matrix**: Natively connects to BrowserStack AppAutomate to run payloads concurrently on high-end device pools like Pixel 8 and iPhone 15 Pro.
*   **Smart App Building**: Automatically detects `xcode workspace`, `gradle`, `react-native`, or `flutter` paths, triggering platform-specific builds during CI runs dynamically.

---

## 🛠 Prerequisites

*   **Node.js**: v18 or strictly higher.
*   **TypeScript**: v5+ globally or via `npx`.
*   **API Keys**: You will need provisioning for Claude Opus, active BrowserStack App Automate Hub access, and GitHub access tokens.

---

## ⚙️ Local Development & Execution

### 1. Installation
Clone the enterprise repository and install strict dependencies:
```bash
git clone https://github.com/your-org/AutomatedTestingBot.git
cd AutomatedTestingBot
npm install
npm run build
```

### 2. Configure Environment Context
The system expects production credentials to securely trigger testing runs. Copy the template and fill it precisely.
```bash
cp .env.example .env
```
Ensure you provide:
*   `GITHUB_TOKEN`: For injecting PR reports and fetching accurate git diffs.
*   `CLAUDE_API_KEY`: The LLM execution context for screen classification and generation.
*   `BROWSERSTACK_USERNAME` / `BROWSERSTACK_ACCESS_KEY`: Required to create Appium sessions.

### 3. Emulate GitHub Event
To test locally, you must provide the repository and branch context just as GitHub Actions would trigger it:
```bash
export GITHUB_REPOSITORY="your-company/your-app"
export GITHUB_HEAD_REF="feature/payment-gate"
```

### 4. Kickstart the Pipeline
Trigger the bot by supplying your target PR argument:
```bash
npm run dev -- <PR_NUMBER>
# OR Production build:
npm run start -- <PR_NUMBER>
```

---

## 🧠 System Architecture Overview

The system runs a **16-module progressive pipeline**.
1.  **Phase 1 (Setup & Build)**: `app-builder`, `code-reader`. Compiles the mobile payload dynamically and establishes a git context.
2.  **Phase 2 (AI Intelligence)**: `app-analyzer`, `scenario-brain`, `test-writer`. Segments screens, predicts impact graphs, and translates LLM intelligence into Gherkin step instructions safely.
3.  **Phase 3 (Physical App Execution)**: `browserstack`. Manages multi-device execution concurrently with gesture engines and dynamic polling.
4.  **Phase 4 (Reporting & Aux Testing)**: Evaluates accessibility standards, tests network anomalies (Chaos), vectorizes failure histories to pgvector, and publishes a structured markdown summary back to your repository PR.

---

## 🛡 Fault Tolerance & Reliability
The enterprise iteration implements hard-stops only on `Critical` pipeline elements. Flakiness inside third-party REST connections or Appium Node loops are absorbed through `runWithRetry(delayMs * 2)`.

*For detailed insights on Phase planning, refer to \`plan.md\`.*
