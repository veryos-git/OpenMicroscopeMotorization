// BASE_URL=http://127.0.0.1:18894 PLAYWRIGHT_PATH=/path/to/playwright-core/index.mjs node tests/motor_calibration_browser_smoke.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8000');
    await page.getByRole('button', { name: 'Setup', exact: true }).click();
    await page.locator('.panel-setup.visible').waitFor();
    const cards = page.locator('.hardware-motor');
    assert.equal(await cards.count(), 3);
    assert.equal(await page.locator('.panel-backlash, .panel-calibration').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Calib', exact: true }).count(), 0);
    for(let i = 0; i < 3; i++) {
        assert.equal(await cards.nth(i).getByRole('button', { name: 'Calibrate', exact: true }).isDisabled(), true);
        assert.equal(await cards.nth(i).locator('.hardware-calibration-advanced').evaluate(el => el.open), false);
    }
    // Stub the run handler: verify routing without issuing any motor commands.
    await page.evaluate(() => {
        window.calibrationCalls = [];
        for(const el of document.querySelectorAll('.hardware-calibration')) {
            const component = el.__vueParentComponent.proxy;
            component.f_run = () => { window.calibrationCalls.push(component.f_n_motor()); };
        }
        o_state.b_connected__esp = true;
        o_state.b_streaming__webcam = true;
        o_state.b_scanning = false;
        o_state.b_flashing = false;
        o_state.a_o_motor.forEach(o => o.b_running = false);
    });
    for(let i = 0; i < 3; i++) await cards.nth(i).getByRole('button', { name: 'Calibrate', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.calibrationCalls), [0, 1, 2]);
    await cards.nth(1).getByText('Advanced calibration settings & results', { exact: true }).click();
    assert.equal(await cards.nth(1).locator('.hardware-calibration-advanced').evaluate(el => el.open), true);
    assert.equal(await cards.nth(0).locator('.hardware-calibration-advanced').evaluate(el => el.open), false);
    await page.getByText('Calibration checklist & optical settings', { exact: true }).click();
    assert.equal(await page.locator('.panel-setup .hardware-calibration-checklist-body').isVisible(), true);
    await page.getByRole('button', { name: 'show motor calibration', exact: true }).click();
    assert.equal(await cards.nth(0).locator('.hardware-calibration-advanced').evaluate(el => el.open), true);
    await page.evaluate(() => { o_state.b_connected__esp = false; o_state.b_streaming__webcam = false; });
    await page.screenshot({ path: '/tmp/omm-motor-calibration.png' });
    assert.deepEqual(errors, []);
    console.log('Three motor calibration buttons, routing, readiness, inline advanced settings and checklist passed.');
} finally {
    await browser.close();
}
