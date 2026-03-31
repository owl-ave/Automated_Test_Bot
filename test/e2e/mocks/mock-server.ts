import * as http from 'http';
import { Logger } from '../../../src/utils/logger';

const logger = new Logger('MockServer');

const MOCK_APP_URL = 'bs://mock-app-id-12345';
const MOCK_SESSION_ID = 'mock-session-abc123';

function jsonResponse(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function createMockServer(port: number): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url || '';
      const method = req.method || 'GET';
      let body = '';

      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        logger.log(`[MOCK] ${method} ${url}`);

        // --- BrowserStack App Upload ---
        if (url.includes('/app-automate/upload')) {
          return jsonResponse(res, { app_url: MOCK_APP_URL, custom_id: 'mock-custom-id', shareable_id: 'mock/share' });
        }

        // --- BrowserStack WebDriver Hub ---
        if (url.includes('/wd/hub/session') && method === 'POST') {
          return jsonResponse(res, {
            value: { sessionId: MOCK_SESSION_ID, capabilities: { platformName: 'Android', deviceName: 'Google Pixel 8' } },
          });
        }
        if (url.includes('/wd/hub/session') && method === 'DELETE') {
          return jsonResponse(res, { value: null });
        }
        // Element find
        if (url.includes('/element') && method === 'POST') {
          return jsonResponse(res, { value: { ELEMENT: 'mock-element-001' } });
        }
        // Element click
        if (url.includes('/click') && method === 'POST') {
          return jsonResponse(res, { value: null });
        }
        // Screenshot
        if (url.includes('/screenshot')) {
          return jsonResponse(res, { value: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' });
        }
        // Page source
        if (url.includes('/source')) {
          return jsonResponse(res, {
            value: '<hierarchy><android.widget.Button resource-id="com.app:id/login_button" text="Login" content-desc="login-button"/><android.widget.EditText resource-id="com.app:id/email_input" content-desc="email-input"/></hierarchy>',
          });
        }

        // --- GitHub API ---
        if (url.includes('/repos/') && url.includes('/pulls/') && method === 'GET') {
          return jsonResponse(res, {
            number: 42,
            title: 'Add cart feature',
            head: { ref: 'feature/cart', sha: 'abc123def456' },
            base: { ref: 'main' },
            changed_files: 3,
          });
        }
        if (url.includes('/comments') && method === 'POST') {
          logger.log('[MOCK] PR comment posted');
          return jsonResponse(res, { id: 1, body: 'comment posted' }, 201);
        }
        if (url.includes('/labels') && method === 'POST') {
          return jsonResponse(res, [{ name: 'tests-passed' }]);
        }
        if (url.includes('/check-runs') && method === 'POST') {
          return jsonResponse(res, { id: 1, status: 'completed' }, 201);
        }
        if (url.includes('/installations') && method === 'GET') {
          return jsonResponse(res, [{ id: 12345 }]);
        }
        if (url.includes('/access_tokens') && method === 'POST') {
          return jsonResponse(res, { token: 'ghs_mock_installation_token_123' });
        }

        // --- Git diff (simulated) ---
        if (url.includes('/compare/')) {
          return jsonResponse(res, {
            files: [
              { filename: 'src/screens/CartScreen.tsx', status: 'added', additions: 40, deletions: 0, patch: '+export default function CartScreen' },
              { filename: 'src/screens/LoginScreen.tsx', status: 'modified', additions: 5, deletions: 2, patch: '@@ -10,7 +10,10 @@\n+const handleLogin = async () => {' },
            ],
          });
        }

        // --- Percy ---
        if (url.includes('percy.io')) {
          return jsonResponse(res, { data: { id: 'mock-percy-build', attributes: { state: 'finished', 'web-url': 'https://percy.io/mock' } } });
        }

        // --- Default ---
        logger.log(`[MOCK] Unhandled: ${method} ${url}`);
        jsonResponse(res, { message: 'mock ok' });
      });
    });

    server.listen(port, () => {
      logger.log(`Mock server running on port ${port}`);
      resolve(server);
    });
  });
}
