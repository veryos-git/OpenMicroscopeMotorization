// BASE_URL=http://127.0.0.1:18895 PLAYWRIGHT_PATH=/path/to/playwright-core/index.mjs node tests/manual_speed_browser_smoke.mjs
// Use an isolated server/database: this test changes saved speed settings.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:18895');
    await page.waitForFunction(() => window.o_state?.b_connected__server);
    const bar = page.locator('.toolbar-row--speed');
    await bar.locator('#toolbar-speed-z').waitFor();
    await page.evaluate(() => { o_state.o_panel_visibility.setup = false; o_state.o_panel_visibility.gamepad = false; });
    await bar.getByRole('button', { name: 'Fast', exact: true }).click();
    assert.equal(await bar.locator('#toolbar-speed-xy').inputValue(), '10');
    assert.equal(await bar.locator('#toolbar-speed-z').inputValue(), '1.5');
    await bar.locator('#toolbar-speed-z').fill('0.25');
    await bar.locator('#toolbar-speed-z').press('Tab');
    await page.waitForFunction(() => JSON.parse(o_state.a_o_setting.find(s => s.s_key === 'o_rpm__manual')?.s_value || '{}').z === 0.25);
    await bar.locator('.manual-speeds').evaluate(el => el.__vueParentComponent.proxy.f_save());
    await page.reload();
    await page.waitForFunction(() => window.o_state?.n_rpm__focus_jog === 0.25);
    assert.equal(await bar.locator('#toolbar-speed-xy').inputValue(), '10');
    await bar.getByRole('slider', { name: 'XY speed slider', exact: true }).fill('7.5');
    await page.waitForFunction(() => JSON.parse(o_state.a_o_setting.find(s => s.s_key === 'o_rpm__manual')?.s_value || '{}').xy === 7.5);
    assert.equal(await bar.locator('#toolbar-speed-z').inputValue(), '0.25');
    await page.evaluate(() => { o_state.o_panel_visibility.setup = false; o_state.o_panel_visibility.gamepad = false; });
    await page.getByRole('button', { name: 'Setup', exact: true }).click();
    assert.equal(await page.locator('#setup-speed-z').inputValue(), '0.25');
    assert.equal(await page.locator('#setup-speed-xy').inputValue(), '7.5');
    await page.getByRole('button', { name: 'Close Setup', exact: true }).click();
    await page.getByRole('button', { name: 'Gamepad', exact: true }).click();
    assert.equal(await page.locator('#gamepad-speed-z').inputValue(), '0.25');
    await page.getByRole('button', { name: 'Close Gamepad', exact: true }).click();
    // Bounds/invalid input, consistent paired presets, and unassigned focus.
    await bar.locator('#toolbar-speed-xy').fill('99');
    await bar.locator('#toolbar-speed-xy').press('Tab');
    assert.equal(await bar.locator('#toolbar-speed-xy').inputValue(), '15');
    await bar.locator('#toolbar-speed-z').fill('');
    await bar.locator('#toolbar-speed-z').press('Tab');
    assert.equal(await bar.locator('#toolbar-speed-z').inputValue(), '0.25');
    await bar.getByRole('button', { name: 'Slow', exact: true }).click();
    await bar.getByRole('button', { name: 'Normal', exact: true }).click();
    await page.waitForFunction(() => JSON.parse(o_state.a_o_setting.find(s => s.s_key === 'o_rpm__manual')?.s_value || '{}').z === 0.5);
    await page.evaluate(() => { o_state.o_motor__axis.z = null; });
    assert.equal(await bar.locator('#toolbar-speed-z').isDisabled(), true);
    for(const width of [1920, 3440]) {
        await page.setViewportSize({ width, height: 1080 });
        const bounds = await bar.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
        assert.ok(await bar.getByRole('button', { name: 'Fast', exact: true }).isVisible());
    }
    assert.deepEqual(errors, []);
    console.log('Speed controls: presets, independent values, persistence, bounds, shared panels and desktop layouts passed.');
} finally { await browser.close(); }
