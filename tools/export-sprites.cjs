const { chromium } = require('playwright')
;(async () => {
  const b = await chromium.launch()
  const p = await b.newPage({ viewport: { width: 1000, height: 800 }, acceptDownloads: true })
  const errs = []
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  await new Promise((r) => setTimeout(r, 1500))
  await p.goto('http://localhost:5173/export.html')
  await p.waitForFunction(() => window.__export || document.getElementById('log').textContent.includes('FEHLER'), null, { timeout: 300000 })
  console.log(await p.evaluate(() => document.getElementById('log').textContent.split('\n').slice(-3).join(' | ')))
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#dl')])
  await dl.saveAs(process.argv[2] || 'pixelfront_sprites.zip')
  
  console.log(errs.length ? errs.join('\n') : 'no errors')
  await b.close()
})()
