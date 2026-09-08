import { test, expect } from '@playwright/test';
import { mount, post, move, activate, back, rect } from './fixtures/timeline.mjs';

function postWithLinks({ id = '101', cardUrl = 'https://somethingbig.ai/p/future-ai', textUrl = 'https://github.com/deeloo/tvx' } = {}) {
    const cardHtml = `
      <div data-testid="card.wrapper">
        <a href="${cardUrl}">
          <div data-testid="article-cover-image"><img alt="Card cover" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='60'%3E%3C/svg%3E"></div>
          <div><div><span dir="auto">Something Big: The Future of AI Agents</span></div><div dir="auto"><span>somethingbig.ai</span></div></div>
        </a>
      </div>`;
    const textHtml = `Check this out: <a href="${textUrl}">${textUrl}</a> and read the article.`;
    return post({ id, text: 'FIXTURE_PLACEHOLDER' })
        .replace('FIXTURE_PLACEHOLDER', textHtml)
        .replace('<div role="group">', cardHtml + '<div role="group">');
}

test('Right-click menu extracts all external links into a dedicated external links section', async ({ page }) => {
    await mount(page, [postWithLinks()]);
    await move(page, 'down');
    await page.keyboard.press('m');

    const menu = page.getByRole('dialog', { name: '帖子操作' });
    await expect(menu).toBeVisible();

    // 1. Dedicated external links section header exists
    const sectionTitle = menu.locator('.tv-action-section-title');
    await expect(sectionTitle).toBeVisible();
    await expect(sectionTitle).toHaveText('外链文章');

    // 2. Contains link buttons for each external link
    const linkButtons = menu.locator('button.tv-action-btn-link');
    await expect(linkButtons).toHaveCount(2);

    // First button: Web Card
    const btn1 = linkButtons.nth(0);
    await expect(btn1).toContainText('Something Big: The Future of AI Agents');
    await expect(btn1.locator('.tv-action-link-domain')).toHaveText('somethingbig.ai');

    // Second button: Text Link
    const btn2 = linkButtons.nth(1);
    await expect(btn2).toContainText('https://github.com/deeloo/tvx');
    await expect(btn2.locator('.tv-action-link-domain')).toHaveText('github.com');

    // 3. Navigation cycles through comment -> like -> link1 -> link2 -> comment
    const commentBtn = page.getByRole('button', { name: '评论', exact: true });
    const likeBtn = page.getByRole('button', { name: '喜欢', exact: true });

    await expect(commentBtn).toBeFocused();
    await move(page, 'down');
    await expect(likeBtn).toBeFocused();
    await move(page, 'down');
    await expect(btn1).toBeFocused();
    await move(page, 'down');
    await expect(btn2).toBeFocused();
    await move(page, 'down');
    await expect(commentBtn).toBeFocused();

    // Moving up cycles backwards
    await move(page, 'up');
    await expect(btn2).toBeFocused();
});

test('Activating an external link from the menu opens the built-in browsing session, scrolls and returns', async ({ page }) => {
    await mount(page, [post({ id: '100' }), postWithLinks({ id: '101' })]);
    await move(page, 'down');
    await page.keyboard.press('m');

    const menu = page.getByRole('dialog', { name: '帖子操作' });
    await expect(menu).toBeVisible();

    // Navigate to the first external link (card)
    await move(page, 'down'); // to like
    await move(page, 'down'); // to link1
    const btn1 = menu.locator('button.tv-action-btn-link').nth(0);
    await expect(btn1).toBeFocused();

    // Activate the link
    await activate(page);

    // Action menu should close, and built-in article session opens
    await expect(menu).toHaveCount(0);
    const session = page.locator('#tv-article-session');
    await expect(session).toBeVisible();
    await expect(session.locator('#tv-article-domain')).toHaveText('somethingbig.ai');
    await expect(session.locator('#tv-article-title')).toContainText('Something Big');

    // Iframe has target URL
    const frame = session.locator('#tv-article-frame');
    await expect(frame).toHaveAttribute('src', 'https://somethingbig.ai/p/future-ai');

    // Direction down scrolls the session
    const scrollContainer = session.locator('#tv-article-scroll');
    await move(page, 'down');
    await expect.poll(async () => scrollContainer.evaluate(el => el.scrollTop)).toBeGreaterThanOrEqual(0);

    // Back key closes session and restores timeline position
    await back(page);
    await expect(session).toHaveCount(0);
    await expect(page).toHaveURL('https://x.com/home');
    await expect(page.locator('article.tv-focused')).toHaveAttribute('data-fixture-id', '101');
});

test('Post with zero external links does not render the external links section', async ({ page }) => {
    await mount(page, [post({ id: '102', text: 'Pure text post with no links.' })]);
    await move(page, 'down');
    await page.keyboard.press('m');

    const menu = page.getByRole('dialog', { name: '帖子操作' });
    await expect(menu).toBeVisible();
    await expect(menu.locator('.tv-action-section-title')).toHaveCount(0);
    await expect(menu.locator('button.tv-action-btn-link')).toHaveCount(0);
    expect((await rect(menu)).height).toBe(296);
});

test('Post with 3 external links renders all 3 in the menu external links section', async ({ page }) => {
    const cardHtml = `
      <div data-testid="card.wrapper">
        <a href="https://somethingbig.ai/p/future-ai">
          <div data-testid="article-cover-image"><img alt="Card cover" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='60'%3E%3C/svg%3E"></div>
          <div><div><span dir="auto">Something Big Article</span></div><div dir="auto"><span>somethingbig.ai</span></div></div>
        </a>
      </div>`;
    const textHtml = `Check <a href="https://github.com/project">github.com/project</a> and <a href="https://news.ycombinator.com">news.ycombinator.com</a>`;
    const html = post({ id: '103', text: 'PLACEHOLDER' })
        .replace('PLACEHOLDER', textHtml)
        .replace('<div role="group">', cardHtml + '<div role="group">');

    await mount(page, [html]);
    await move(page, 'down');
    await page.keyboard.press('m');

    const menu = page.getByRole('dialog', { name: '帖子操作' });
    await expect(menu).toBeVisible();
    const linkButtons = menu.locator('button.tv-action-btn-link');
    await expect(linkButtons).toHaveCount(3);
    await expect(linkButtons.nth(0).locator('.tv-action-link-domain')).toHaveText('somethingbig.ai');
    await expect(linkButtons.nth(1).locator('.tv-action-link-domain')).toHaveText('github.com');
    await expect(linkButtons.nth(2).locator('.tv-action-link-domain')).toHaveText('news.ycombinator.com');
});

test('Spatial D-pad does not focus card directly; external links are accessed via action menu', async ({ page }) => {
    await mount(page, [post({ id: '100' }), postWithLinks({ id: '101' })]);
    await move(page, 'down');

    // Remote right does not focus card
    await move(page, 'right');
    const card = page.locator('[data-testid="card.wrapper"]');
    await expect(card).not.toHaveClass(/tv-card-focused/);

    // Guidance remains standard timeline guidance
    const guidance = page.locator('#tv-reading-guidance');
    await expect(guidance).toContainText('切换帖子');
    await expect(guidance).not.toContainText('阅读文章');

    // External links are opened via action menu ('m')
    await page.keyboard.press('m');
    const menu = page.getByRole('dialog', { name: '帖子操作' });
    await expect(menu).toBeVisible();
    const linkBtn = menu.locator('button.tv-action-btn-link').first();
    await expect(linkBtn).toBeVisible();

    // Select link and activate opens session
    await move(page, 'down'); // like
    await move(page, 'down'); // link1
    await expect(linkBtn).toBeFocused();
    await activate(page);

    const session = page.locator('#tv-article-session');
    await expect(session).toBeVisible();
    await expect(session.locator('#tv-article-frame')).toHaveAttribute('src', 'https://somethingbig.ai/p/future-ai');

    // Back closes session
    await back(page);
    await expect(session).toHaveCount(0);
});

