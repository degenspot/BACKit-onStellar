import { test, expect } from '@playwright/test';

test.describe('App Smoke Test', () => {
    test('should load landing page correctly', async ({ page }) => {
        // Navigate to landing page
        await page.goto('/');

        // Check title
        await expect(page).toHaveTitle(/BACKit/i);

        // Check if main header is present
        const header = page.locator('h1');
        await expect(header).toContainText('Predict With');

        // Check for main CTA or navigation elements
        const sampleProfileLink = page.getByRole('link', { name: /View Sample Profile/i });
        await expect(sampleProfileLink).toBeVisible();
    });

    test('should navigate to sample profile', async ({ page }) => {
        await page.goto('/');

        // Click on sample profile link
        await page.getByRole('link', { name: /View Sample Profile/i }).click();

        // Verify navigation to profile page
        await expect(page).toHaveURL(/\/profile\//);

        // Check if profile specific elements are present (even if skeleton)
        await expect(page.locator('body')).toBeVisible();
    });
});
