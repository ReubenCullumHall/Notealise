const { chromium } = require(process.env.HOME + '/.local/webtools/node_modules/playwright')
const S = process.env.S
;(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333'); const page = b.contexts()[0].pages()[0]
  await page.waitForTimeout(1000)
  if (process.env.DARK) { await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(600) }
  // What a dark space with a gold accent in tint mode writes inline on <html> (settings/model.ts applyAccent)
  if (process.env.GOLD) await page.evaluate(() => { const r = document.documentElement.style; r.setProperty('--ink-900', '245 236 214'); r.setProperty('--ink-plain-900', '245 236 214'); r.setProperty('--ink-acc-900', '232 196 110'); r.setProperty('--accent-500', '212 170 80'); r.setProperty('--accent-400', '190 150 70'); r.setProperty('--accent-600', '232 196 110') })
  const phys = page.locator('.tree-title', { hasText: /^Physics$/ }).first(); if (await phys.count()) await phys.click()
  await page.waitForTimeout(300)
  const row = page.locator('.tree-row', { has: page.locator('.tree-title', { hasText: new RegExp('^' + (process.env.NOTE || 'Waves') + '$') }) }).first()
  await row.click(); await page.waitForTimeout(700)
  await row.click({ button: 'right' }); await page.waitForTimeout(300)
  await page.getByText(process.env.ITEM || 'Save as…', { exact: true }).first().click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: S + '/ui-1.png' })
  if (process.env.CLICKS) for (const c of process.env.CLICKS.split(',')) {
    await page.locator('.saveas-choice', { hasText: c }).first().click(); await page.waitForTimeout(700)
    await page.screenshot({ path: S + '/ui-' + c.replace(/\W/g, '') + '.png' })
  }
  if (process.env.SAVE) { await page.locator('.saveas-foot button.primary').click(); await page.waitForTimeout(3500); await page.screenshot({ path: S + '/ui-after.png' }) }
  process.exit(0)
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
