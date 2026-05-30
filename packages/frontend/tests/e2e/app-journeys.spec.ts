import { test, expect } from '@playwright/test';

const TEST_WALLET_ADDRESS = 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ';

test.describe('BACKit Critical Journeys', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept/mock feed API
    await page.route('**/api/feed*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              id: 'call-1',
              creator: TEST_WALLET_ADDRESS,
              token: { symbol: 'BTC', price: 67420 },
              condition: 'BTC > $70k by June 2026',
              description: 'Will BTC exceed $70,000?',
              thesis: 'Bitcoin will reach $70,000 by June 2026.',
              stakes: { yes: 12000, no: 8000 },
              participants: 12,
              resolved: false,
              endTime: new Date(Date.now() + 86400000).toISOString(),
              createdAt: new Date().toISOString()
            }
          ],
          hasMore: false,
          nextCursor: null
        })
      });
    });

    // Intercept/mock call details API
    await page.route('**/api/calls/call-1', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'call-1',
          creator: TEST_WALLET_ADDRESS,
          token: { symbol: 'BTC', price: 67420 },
          condition: 'BTC > $70k by June 2026',
          description: 'Will BTC exceed $70,000?',
          thesis: 'Bitcoin will reach $70,000 by June 2026.',
          stakes: { yes: 12000, no: 8000 },
          participants: [],
          resolved: false,
          endTime: new Date(Date.now() + 86400000).toISOString(),
          createdAt: new Date().toISOString()
            }
          )
        });
      });

    // Intercept/mock call odds API
    await page.route('**/api/calls/call-1/odds', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ yes: 1.8, no: 2.2 })
      });
    });

    // Intercept/mock profile API
    await page.route(`**/api/users/${TEST_WALLET_ADDRESS}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            address: TEST_WALLET_ADDRESS,
            displayName: 'Freighter Tester',
            bio: 'Mock user for testing Freighter wallet connection.',
            avatarUrl: null,
            winRate: 80,
            totalCalls: 10,
            followers: 100,
            following: 50
          },
          createdCalls: [],
          participatedCalls: [],
          resolvedCalls: []
        })
      });
    });

    // Intercept/mock user stakes API
    await page.route(`**/api/users/${TEST_WALLET_ADDRESS}/stakes*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          total: 0
        })
      });
    });
  });

  test('should load landing page correctly and have a clickable CTA', async ({ page }) => {
    await page.goto('/');
    // Check title contains BACKit
    await expect(page).toHaveTitle(/BACKit/i);
    // Check main heading is visible
    const heading = page.locator('h1');
    await expect(heading).toContainText('Predict With');
    
    // Launch App / Connect Wallet CTA should be visible
    const launchCta = page.getByRole('button', { name: /Launch App/i });
    await expect(launchCta).toBeVisible();
  });

  test('should connect wallet using mocked window.freighterApi and navigate to profile', async ({ page }) => {
    // Inject mock Freighter wallet API
    await page.addInitScript(() => {
      const mockFreighter = {
        isConnected: async () => true,
        getPublicKey: async () => 'GD5DQ6KQZYZ2JY5YKZ7XQYBZQZQZQZQZQZQZQZQZQZQZQZQZQZQZQ',
        signMessage: async () => ({ signedMessage: 'mock_signed', signature: 'mock_sig_123' }),
        getNetwork: async () => ({ network: 'PUBLIC', networkPassphrase: 'Public Global Stellar Network' })
      };
      // Mock both freighter and freighterApi on window object
      (window as any).freighter = mockFreighter;
      (window as any).freighterApi = mockFreighter;
    });

    await page.goto('/');

    // Click on Connect Wallet in the navbar
    const connectBtn = page.getByRole('button', { name: /Connect Wallet/i }).first();
    await expect(connectBtn).toBeVisible();
    await connectBtn.click();

    // Click on Freighter wallet option in the selector modal
    const freighterOption = page.getByRole('button', { name: /Freighter/i });
    await expect(freighterOption).toBeVisible();
    await freighterOption.click();

    // Wait for wallet connection to establish (button displays connected displayName)
    const connectedBtn = page.getByRole('button', { name: /Freighter Tester/i });
    await expect(connectedBtn).toBeVisible();

    // Click on the connected profile menu and click "My Profile"
    await connectedBtn.click();
    const myProfileLink = page.getByRole('link', { name: /My Profile/i });
    await expect(myProfileLink).toBeVisible();
    await myProfileLink.click();

    // Verify navigating to profile page
    await expect(page).toHaveURL(new RegExp(`/profile/${TEST_WALLET_ADDRESS}`));
    await expect(page.getByText('Freighter Tester')).toBeVisible();
    await expect(page.getByText('Mock user for testing Freighter wallet connection.')).toBeVisible();
  });

  test('should load feed page and display market cards', async ({ page }) => {
    await page.goto('/feed');
    // Verify feed page elements
    await expect(page.getByRole('heading', { name: /Prediction Feed/i })).toBeVisible();
    // Check if the mocked call appears
    await expect(page.getByText('BTC > $70k by June 2026')).toBeVisible();
  });

  test('should navigate to market detail page and show correct data', async ({ page }) => {
    await page.goto('/feed');
    // Click on market card
    await page.getByText('BTC > $70k by June 2026').click();
    
    // Verify navigating to market detail
    await expect(page).toHaveURL(/\/calls\/call-1/);
    await expect(page.getByRole('heading', { name: /BTC > \$70k by June 2026/i })).toBeVisible();
    await expect(page.getByText('Bitcoin will reach $70,000 by June 2026.')).toBeVisible();
  });

  test('should support back and forth navigation correctly', async ({ page }) => {
    await page.goto('/');
    
    // Go to feed
    await page.goto('/feed');
    await expect(page.getByRole('heading', { name: /Prediction Feed/i })).toBeVisible();

    // Go to market detail
    await page.getByText('BTC > $70k by June 2026').click();
    await expect(page).toHaveURL(/\/calls\/call-1/);

    // Navigate back to feed
    await page.goBack();
    await expect(page.getByRole('heading', { name: /Prediction Feed/i })).toBeVisible();
    await expect(page.getByText('BTC > $70k by June 2026')).toBeVisible();
  });
});
