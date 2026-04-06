# Bot Test Auth Config — `bot-test-config.json`

## Problem

The bot is designed for zero human intervention. When testing a new repo where the app requires login, where do the credentials come from?

- Putting credentials in the bot's `.env` = manual work for every new repo → defeats the purpose of automation
- Using synthetic credentials (fake email/password) = account doesn't exist in the real app → login fails

## Solution

**The repo being tested places a file called `bot-test-config.json` in its root.**

At the start of the pipeline, the code-reader module looks for this file. If found, it uses the credentials. If not found, it follows the fallback chain below.

---

## File Location

```
their-mobile-app/               ← repo being tested
├── android/
├── ios/
├── src/
├── bot-test-config.json        ← repo owner places this file
└── ...
```

---

## Schema

### Type 1: Email + Password Login

```json
{
  "auth": {
    "type": "email_password",
    "email": "testuser@theirapp.com",
    "password": "TestPass123!"
  }
}
```

### Type 2: Phone + OTP Login

```json
{
  "auth": {
    "type": "phone_otp",
    "phone": "+919876543210"
  }
}
```

> Note: For OTP flows, the bot will use `123456` as a hardcoded value until real OTP interception is implemented.

### Type 3: Username + Password Login

```json
{
  "auth": {
    "type": "username_password",
    "username": "test_user_01",
    "password": "TestPass123!"
  }
}
```

### Type 4: Guest / Skip Login

```json
{
  "auth": {
    "type": "guest"
  }
}
```

> The bot will look for a "Continue as Guest" or "Skip" button and click it.

### Type 5: No Auth Required

```json
{
  "auth": {
    "type": "none"
  }
}
```

> No login screen exists — the bot proceeds directly into the app.

---

## Fallback Chain (If File Not Found)

```
bot-test-config.json not found
        ↓
Look for a signup flow → create a new test account (using data-generator credentials)
        ↓
Signup not found / failed
        ↓
Look for guest mode → click "Continue as Guest"
        ↓
Guest mode not available
        ↓
Skip auth tests + post PR comment:
"Auth tests skipped — add bot-test-config.json to repo with test credentials"
```

---

## Pipeline Integration

### Step 1: Read in Code Reader

`src/modules/code-reader/repo-scanner.ts` — while scanning the repo, look for `bot-test-config.json` and save it into `PipelineContext`:

```typescript
context.authConfig = {
  type: 'email_password',
  email: 'testuser@app.com',
  password: 'TestPass123!'
}
```

### Step 2: Inject in Step Generator

`src/modules/test-writer/step-generator.ts` — when generating login steps, pull credentials from `context.authConfig` instead of using synthetic data:

```typescript
// Before: hardcoded / synthetic
return this.findAndType('email_input', 'test.abc123@testmail.com');

// After: from config
const email = context.authConfig?.email ?? dataGenerator.generateEmail();
return this.findAndType('email_input', email);
```

### Step 3: Inform Scenario Brain

`src/modules/scenario-brain/index.ts` — if `authConfig.type === 'none'`, skip generating login scenarios. If `guest`, only generate guest flow tests.

---

## Security Note

**Never put real production credentials in `bot-test-config.json`** — use dedicated test accounts only.

Repo owners should:
- Create a separate staging/test environment account
- Or use app test mode credentials

Adding this file to `.gitignore` is optional but recommended for public repos:

```gitignore
# For public repos
bot-test-config.json
```

If the file is in `.gitignore`, the bot cannot read it via the GitHub API. In that case, the repo owner can add a GitHub Secret named `BOT_TEST_CONFIG` containing the JSON string as a fallback.

---

## Summary

| Scenario | Behavior |
|----------|----------|
| `bot-test-config.json` found, type = `email_password` | Login using config credentials |
| `bot-test-config.json` found, type = `guest` | Test via guest mode |
| `bot-test-config.json` found, type = `none` | Skip login, test app directly |
| File not found | Try signup → try guest → skip auth tests |
| File is in `.gitignore` | Fallback to GitHub Secret `BOT_TEST_CONFIG` |
