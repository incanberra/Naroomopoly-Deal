import { test, expect } from '@playwright/test';
test.skip(
  process.env.DEAL_ONLINE_BROWSER !== '1',
  'Enable explicitly for the configured live Supabase project.',
);
test('two private browsers join, start, receive private hands and reconnect', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90000);
  const host = await browser.newContext({baseURL}),
    guest = await browser.newContext({baseURL});
  const a = await host.newPage(),
    b = await guest.newPage();
  try {
    await a.goto('/');
    await a.getByRole('button', { name: 'Play with Friends' }).click();
    await a.getByPlaceholder('What should we call you?').fill('Browser host');
    await a.getByRole('button', { name: 'Create a private room' }).click();
    await expect(a.locator('.room-code')).toBeVisible({ timeout: 30000 });
    const code = (await a.locator('.room-code').innerText()).trim();
    await b.goto(`/?room=${code}`);
    await b.getByRole('button', { name: 'Play with Friends' }).click();
    await b.getByPlaceholder('What should we call you?').fill('Browser guest');
    await b.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(b.locator('.lobby-seats').getByText('Browser host', { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(a.locator('.lobby-seats').getByText('Browser guest', { exact: true })).toBeVisible(
      { timeout: 30000 },
    );
    await a.getByRole('button', { name: 'Start the game' }).click();
    await expect(a.locator('.hand .game-card')).toHaveCount(5, { timeout: 30000 });
    await expect(b.locator('.hand .game-card')).toHaveCount(5, { timeout: 30000 });
    const turn = (await a.getByRole('button', { name: 'Draw 2 cards', exact: true }).count())
      ? a
      : b;
    await turn.getByRole('button', { name: 'Draw 2 cards', exact: true }).click();
    await expect(turn.locator('.hand .game-card')).toHaveCount(7);
    await turn.reload();
    await expect(turn.locator('.hand .game-card')).toHaveCount(7, { timeout: 30000 });
    await expect(a.locator('.log').getByText(/drew 2 cards/)).toBeVisible({timeout:30000});
    await a.getByRole('button', { name: 'Leave table', exact: true }).click();
    await a.getByRole('button', { name: 'End game for everyone' }).click();
    await expect(b.getByRole('heading', { name: 'This table has ended' })).toBeVisible({
      timeout: 30000,
    });
  } finally {
    await host.close();
    await guest.close();
  }
});
