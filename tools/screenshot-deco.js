const puppeteer = require('C:\\Users\\PandaDecSt\\AppData\\Roaming\\npm\\node_modules\\puppeteer');
const path = require('path');

const SCREENSHOT_DIR = path.join(__dirname, '..', '.workbuddy', 'memory');

async function run(){
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu'],
  });

  // 1. Atlas test
  console.log('Testing: deco-atlas-test');
  let page = await browser.newPage();
  await page.setViewport({width:1400, height:900});
  await page.goto('http://localhost:8091/elin-h5/tools/deco-atlas-test.html', {waitUntil:'networkidle0', timeout:30000});
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({path: path.join(SCREENSHOT_DIR, 'deco-atlas-test.png')});
  await page.close();

  // 2. Sprite test
  console.log('Testing: deco-sprite-test');
  page = await browser.newPage();
  await page.setViewport({width:1400, height:900});
  await page.goto('http://localhost:8091/elin-h5/tools/deco-sprite-test.html', {waitUntil:'networkidle0', timeout:30000});
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({path: path.join(SCREENSHOT_DIR, 'deco-sprite-test.png')});
  await page.close();

  // 3. Extract sprites - click analyze button
  console.log('Testing: extract-sprites');
  page = await browser.newPage();
  await page.setViewport({width:1400, height:1200});
  page.on('console', msg => console.log('  PAGE:', msg.text()));
  await page.goto('http://localhost:8091/elin-h5/tools/extract-sprites.html', {waitUntil:'networkidle0', timeout:30000});
  await new Promise(r => setTimeout(r, 2000));
  // click analyze button
  await page.evaluate(()=>{
    if(typeof analyzeAtlas === 'function') analyzeAtlas();
  });
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({path: path.join(SCREENSHOT_DIR, 'extract-sprites.png'), fullPage: true});
  // get sprite data
  const spriteData = await page.evaluate(()=>{
    return sprites || [];
  });
  console.log(`Found ${spriteData.length} sprites`);
  // save sprite data
  const fs = require('fs');
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'sprite-data.json'), JSON.stringify(spriteData, null, 2));
  await page.close();

  // 4. Main game
  console.log('Testing: game');
  page = await browser.newPage();
  await page.setViewport({width:1280, height:720});
  const errors = [];
  page.on('console', msg => { if(msg.type()==='error') errors.push(msg.text()); });
  await page.goto('http://localhost:8091/elin-h5/', {waitUntil:'networkidle0', timeout:30000});
  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({path: path.join(SCREENSHOT_DIR, 'deco-game-test.png')});
  if(errors.length) console.log('Game errors:', errors);
  await page.close();

  await browser.close();
  console.log('Done!');
}

run().catch(e => { console.error(e); process.exit(1); });
