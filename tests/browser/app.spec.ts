import { test, expect } from '@playwright/test';
import { createGame } from '../../src/game/engine';
import { DECK } from '../../src/game/catalogue';
import type { GameState } from '../../src/game/types';

async function loadTable(page: import('@playwright/test').Page, state: GameState) {
  const occupied = state.players.flatMap((p) => [
    ...p.hand,
    ...p.bank,
    ...p.groups.flatMap((g) => g.cards),
  ]);
  state.deck = DECK.map((c) => c.id).filter((id) => !occupied.includes(id));
  await page.addInitScript((s) => {
    localStorage.setItem('naroomopoly-deal.practice.v1', JSON.stringify(s));
    localStorage.setItem(
      'naroomopoly-deal.session.v1',
      JSON.stringify({ mode: 'local', gameId: s.id, playerId: 'p0', code: 'LOCAL' }),
    );
  }, state);
  await page.goto('/');
}
function table() {
  const s = createGame('fixture', 'LOCAL', [
    { id: 'p0', name: 'You', avatar: '🦭' },
    { id: 'p1', name: 'A mate', avatar: '🐋' },
  ]);
  s.stage = 'play';
  return s;
}
test('home, rules, settings and online configuration messaging', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /A little coastal cunning/ })).toBeVisible();
  await page.screenshot({ path: `previews/home-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'How to play', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('A few digital conventions')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Mute sound' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Enable sound' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Play with Friends' }).click();
  await expect(page.getByText('Online rooms need a Supabase connection.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create a private room' })).toBeDisabled();
  expect(errors).toEqual([]);
});
test('practice supports guided plays, refresh and resuming a saved table', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Math.random = () => 0.1;
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Practice with Bots', exact: true }).click();
  await page.getByPlaceholder('What should we call you?').fill('Coastal Tester');
  await page.getByLabel('Computer opponents').selectOption('1');
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await expect(page.getByText('PRACTICE TABLE', { exact: true })).toBeVisible();
  // Wait for the first human draw; the seeded turn order is intentionally random.
  await expect(page.getByRole('button', { name: /Draw [25] cards/ })).toBeVisible({
    timeout: 60000,
  });
  await page.getByRole('button', { name: /Draw [25] cards/ }).click();
  const hand = page.locator('.hand');
  await expect(hand.locator('.game-card')).toHaveCount(7);
  await hand.locator('.game-card').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const bank = page.getByRole('button', { name: /^Bank \d+M$/ });
  const collect = page.getByRole('button', { name: 'Collect property', exact: true });
  if (await bank.count()) await bank.click();
  else await collect.click();
  await page.getByRole('button', { name: 'Review move' }).click();
  await page.getByRole('button', { name: 'Confirm move' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(hand.locator('.game-card')).toHaveCount(6);
  const version = await page.evaluate(
    () => JSON.parse(localStorage.getItem('naroomopoly-deal.practice.v1')!).version,
  );
  await page.reload();
  await expect(page.getByText('PRACTICE TABLE', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('naroomopoly-deal.practice.v1')!).version,
    ),
  ).toBe(version);
  await expect(page.locator('.hand .game-card')).toHaveCount(6);
  await page.screenshot({ path: `previews/table-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Leave table', exact: true }).click();
  await page.getByRole('button', { name: 'Return home', exact: true }).click();
  await page.getByRole('button', { name: 'Resume practice' }).click();
  await expect(page.getByText('PRACTICE TABLE', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('mobile table has no page-wide horizontal overflow and opponent collections expand', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Practice with Bots', exact: true }).click();
  await page.getByPlaceholder('What should we call you?').fill('Broulee');
  await page.getByLabel('Computer opponents').selectOption('4');
  await page.getByRole('button', { name: 'Let’s play' }).click();
  await expect(page.locator('.opponent')).toHaveCount(4);
  await page.locator('.opponent summary').first().click();
  await expect(page.locator('.opponent').first()).toHaveAttribute('open', '');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('payment selection enforces the amount and transfers assets', async ({ page }) => {
  const s = table();
  const a = DECK.find((c) => c.kind === 'money' && c.value === 1)!.id,
    b = DECK.find((c) => c.kind === 'money' && c.value === 5)!.id;
  s.players[0].bank = [a, b];
  s.stage = 'payment';
  s.pending = {
    actor: 'p1',
    effect: 'debt',
    targets: ['p0'],
    index: 0,
    responder: 'p0',
    blocked: false,
    amount: 5,
  };
  await loadTable(page, s);
  await expect(page.getByRole('heading', { name: 'Choose your payment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay 0M', exact: true })).toBeDisabled();
  await page.locator('.asset-options label').filter({ hasText: '5M' }).click();
  await page.getByRole('button', { name: 'Pay 5M', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose your payment' })).not.toBeVisible();
  await expect(page.getByText('You paid 5M to A mate.', { exact: true })).toBeVisible();
});
test('response blocks are playable and wait for the counterparty', async ({ page }) => {
  const s = table();
  s.turn = 1;
  const no = DECK.filter((c) => c.effect === 'no');
  s.players[0].hand = [no[0].id];
  s.players[1].hand = [no[1].id];
  s.stage = 'response';
  s.pending = {
    actor: 'p1',
    effect: 'debt',
    targets: ['p0'],
    index: 0,
    responder: 'p0',
    blocked: false,
    amount: 5,
  };
  await loadTable(page, s);
  await page.getByRole('button', { name: 'Yeah, Nah!', exact: true }).click();
  await expect(page.getByText('You: Yeah, Nah!', { exact: true })).toBeVisible();
  await expect(page.getByText('A block is waiting for a counter.', { exact: false })).toBeVisible();
});
test('end-turn discard enforces seven cards', async ({ page }) => {
  const s = table();
  s.players[0].hand = DECK.filter((c) => c.kind === 'money')
    .slice(0, 8)
    .map((c) => c.id);
  await loadTable(page, s);
  await page.getByRole('button', { name: 'End turn', exact: true }).click();
  await expect(page.getByText('Discard 1 cards to finish your turn.')).toBeVisible();
  await page.locator('.hand .game-card').first().click();
  await page.getByRole('button', { name: 'Discard 1 selected cards' }).click();
  await expect(page.getByText('A mate is making a move.', { exact: true })).toBeVisible();
  await expect(page.locator('.hand .game-card')).toHaveCount(7);
});
