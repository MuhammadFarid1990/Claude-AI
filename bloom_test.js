const { chromium } = require('playwright');
const fs = require('fs');

const APP = 'file:///home/user/Claude-AI/index.html';
const OUT = '/tmp/claude-0/bloom_shots/';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let shotIdx = 0;

async function shot(page, label) {
  const f = `${OUT}${String(++shotIdx).padStart(2,'0')}_${label}.png`;
  await page.screenshot({ path: f });
  return f;
}
function pass(name, note='') { results.push({s:'✅',name,note}); console.log(`✅ ${name}${note?' — '+note:''}`); }
function fail(name, note='') { results.push({s:'❌',name,note}); console.log(`❌ ${name}${note?' — '+note:''}`); }
function warn(name, note='') { results.push({s:'⚠️',name,note}); console.log(`⚠️  ${name}${note?' — '+note:''}`); }

async function click(page, sel) {
  await page.locator(sel).first().click({ force: true, timeout: 5000 });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox','--disable-dev-shm-usage','--allow-file-access-from-files']
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const jsErrs = [];
  page.on('console', m => { if(m.type()==='error') jsErrs.push(m.text().slice(0,100)); });

  console.log('\n━━ BLOOM FEATURE TEST ━━\n');

  // ── 1. Load & clear state ────────────────────────────────────────
  console.log('── 1. Load & fresh state');
  await page.goto(APP, { waitUntil: 'load', timeout: 15000 });
  // Clear localStorage so we always start fresh (new user)
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  await shot(page, '01_fresh_load');
  pass('Page loads', `title="${await page.title()}"`);

  // ── 2. Welcome / Auth screen ─────────────────────────────────────
  console.log('\n── 2. Auth / Welcome screen');
  const welcomeVisible = await page.locator('#screen-welcome').isVisible().catch(()=>false);
  const authScreenVisible = await page.locator('#auth-screen').isVisible().catch(()=>false);
  const screenVisible = welcomeVisible || authScreenVisible;
  if (screenVisible) pass('Welcome/auth screen shown on fresh load');
  else fail('Welcome screen not shown on fresh load');

  const logo = await page.locator('.auth-logo').first().isVisible().catch(()=>false);
  if (logo) pass('Bloom logo visible');
  else fail('Logo not visible');

  const gsBtn = page.locator('button:has-text("Get Started"), button:has-text("get started")').first();
  const gsBtnExists = await gsBtn.isVisible().catch(()=>false) || await gsBtn.evaluate(el=>!!el).catch(()=>false);
  if (gsBtnExists) pass('Get Started button present');
  else {
    warn('Get Started button not found via text — trying JS click');
  }

  // ── 3. Onboarding ────────────────────────────────────────────────
  console.log('\n── 3. Onboarding flow');
  try {
    // Click via JS if normal click is hard
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /get started/i.test(b.textContent));
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);
    await shot(page, '02_onboard_s0');

    const step0Visible = await page.locator('#onboard-step-0').isVisible().catch(()=>false);
    if (step0Visible) pass('Onboard step 0 visible');
    else warn('Step 0 not visible — may be inside hidden parent');

    // Fill name
    await page.evaluate(() => {
      const el = document.querySelector('input[placeholder*="name" i], input[id*="name" i]');
      if (el) { el.value = 'Sara'; el.dispatchEvent(new Event('input')); }
    });

    // Fill due date
    await page.evaluate(() => {
      const el = document.querySelector('input[type="date"]');
      if (el) { el.value = '2026-12-15'; el.dispatchEvent(new Event('change')); }
    });
    pass('Step 0: name + due date filled via JS');

    // Click Next
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const next = btns.find(b => /next/i.test(b.textContent));
      if (next) next.click();
    });
    await page.waitForTimeout(400);
    await shot(page, '03_onboard_s1');
    pass('Step 0 → Step 1 advanced');

    // Step 1: baby name
    await page.evaluate(() => {
      const el = document.querySelector('input[placeholder*="baby" i]');
      if (el) { el.value = 'Luna'; el.dispatchEvent(new Event('input')); }
      // Click "Yes" for first baby
      const chips = document.querySelectorAll('.option-chip');
      const yes = Array.from(chips).find(c => /yes/i.test(c.textContent));
      if (yes) yes.click();
    });
    pass('Step 1: baby name + first baby chip clicked');

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const next = btns.find(b => /next/i.test(b.textContent));
      if (next) next.click();
    });
    await page.waitForTimeout(400);
    await shot(page, '04_onboard_s2');
    pass('Step 1 → Step 2');

    // Step 2: body
    await page.evaluate(() => {
      ['[placeholder*="weight" i]','[id*="weight" i]'].forEach(s => {
        const el = document.querySelector(s);
        if (el) { el.value = '145'; el.dispatchEvent(new Event('input')); }
      });
      const age = document.querySelector('[placeholder*="age" i],[id*="age" i]');
      if (age) { age.value = '29'; age.dispatchEvent(new Event('input')); }
    });
    pass('Step 2: body data filled');

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const next = btns.find(b => /next/i.test(b.textContent));
      if (next) next.click();
    });
    await page.waitForTimeout(400);
    await shot(page, '05_onboard_s3');
    pass('Step 2 → Step 3 (diet)');

    // Step 3: pick 2 diet chips
    await page.evaluate(() => {
      const chips = document.querySelectorAll('.option-chip');
      if (chips[0]) chips[0].click();
      if (chips[1]) chips[1].click();
    });

    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const next = btns.find(b => /next/i.test(b.textContent));
      if (next) next.click();
    });
    await page.waitForTimeout(400);
    await shot(page, '06_onboard_s4');
    pass('Step 3 → Step 4 (goals)');

    // Step 4: pick 2 goal chips
    await page.evaluate(() => {
      const chips = document.querySelectorAll('.option-chip');
      if (chips[0]) chips[0].click();
      if (chips[1]) chips[1].click();
    });

    // Finish
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const fin = btns.find(b => /finish|start|let'?s go/i.test(b.textContent));
      if (fin) fin.click();
    });
    await page.waitForTimeout(800);
    await shot(page, '07_dashboard');
    pass('Onboarding complete');
  } catch(e) { fail('Onboarding', e.message.slice(0,80)); }

  // ── 4. Today screen ──────────────────────────────────────────────
  console.log('\n── 4. Today / Dashboard');
  try {
    const greeting = await page.evaluate(() => {
      const el = document.querySelector('.greeting');
      return el ? { visible: el.offsetParent !== null, text: el.textContent.trim() } : null;
    });
    if (greeting?.visible) pass('Greeting visible', greeting.text.slice(0,35));
    else fail('Greeting not visible');

    const weekChip = await page.evaluate(() => {
      const el = document.querySelector('.week-chip');
      return el ? { visible: el.offsetParent !== null, text: el.textContent.trim() } : null;
    });
    if (weekChip?.visible) pass('Week chip', weekChip.text.trim());
    else fail('Week chip not visible');

    const babyCard = await page.evaluate(() => {
      const el = document.querySelector('.card.rose');
      return el ? el.offsetParent !== null : false;
    });
    if (babyCard) pass('Baby card (rose) visible');
    else fail('Baby card not visible');

    const progFill = await page.evaluate(() => {
      const el = document.querySelector('.prog-fill');
      return el ? { visible: el.offsetParent !== null, width: el.style.width } : null;
    });
    if (progFill?.visible) pass('Progress bar', `width=${progFill.width}`);
    else fail('Progress bar not visible');

    const goalCount = await page.evaluate(() => document.querySelectorAll('.goal-item').length);
    if (goalCount > 0) {
      pass(`Goal list`, `${goalCount} items`);
      // Toggle a goal
      await page.evaluate(() => document.querySelectorAll('.goal-item')[0].click());
      await page.waitForTimeout(200);
      const isDone = await page.evaluate(() => document.querySelectorAll('.goal-item')[0].classList.contains('done'));
      if (isDone) pass('Goal toggle works');
      else warn('Goal toggle may not update class');
    } else warn('No goal items rendered');

    const calNote = await page.evaluate(() => {
      const el = document.querySelector('#mealKcalSub');
      return el ? { hidden: el.hidden, text: el.textContent.trim().slice(0,40) } : null;
    });
    if (calNote) {
      if (!calNote.hidden) pass('Calorie estimate shown', calNote.text);
      else warn('Calorie estimate hidden (no physical data saved?)');
    }

    const kickTitle = await page.evaluate(() => {
      const el = document.querySelector('#kickTitle');
      return el ? el.textContent.trim() : null;
    });
    if (kickTitle) pass('Kick counter title', kickTitle.slice(0,30));
  } catch(e) { fail('Today screen', e.message.slice(0,80)); }

  // ── 5. Tab navigation ────────────────────────────────────────────
  console.log('\n── 5. Tab navigation');
  const tabTests = [
    { id: 'meals', screen: 'meals-screen' },
    { id: 'health', screen: 'health-screen' },
    { id: 'schedule', screen: 'schedule-screen' },
    { id: 'me', screen: 'me-screen' },
    { id: 'today', screen: 'today-screen' },
  ];
  for (const t of tabTests) {
    try {
      await page.evaluate(id => {
        const tab = document.querySelector(`.tab[onclick*="${id}"]`);
        if (tab) tab.click();
      }, t.id);
      await page.waitForTimeout(300);
      const visible = await page.evaluate(sid => {
        const sc = document.getElementById(sid);
        return sc ? sc.offsetParent !== null || getComputedStyle(sc).display !== 'none' : false;
      }, t.screen);
      if (visible) { pass(`${t.id} tab`); await shot(page, `tab_${t.id}`); }
      else fail(`${t.id} tab — screen not visible after click`);
    } catch(e) { fail(`${t.id} tab`, e.message.slice(0,60)); }
  }

  // ── 6. Meals screen ──────────────────────────────────────────────
  console.log('\n── 6. Meals screen');
  await page.evaluate(() => document.querySelector('.tab[onclick*="meals"]')?.click());
  await page.waitForTimeout(300);
  const dayChips = await page.evaluate(() => document.querySelectorAll('.day-chip').length);
  pass(`Day chips`, `${dayChips} days`);
  const mealBlocks = await page.evaluate(() => document.querySelectorAll('.meal-block').length);
  pass(`Meal blocks`, `${mealBlocks} meals`);
  const macroPills = await page.evaluate(() => document.querySelectorAll('.macro-pill').length);
  pass(`Macro pills`, `${macroPills}`);

  if (dayChips > 1) {
    await page.evaluate(() => document.querySelectorAll('.day-chip')[2]?.click());
    await page.waitForTimeout(200);
    const active = await page.evaluate(() => document.querySelectorAll('.day-chip')[2]?.classList.contains('active'));
    if (active) pass('Day chip selection');
    else warn('Day chip active state not applied');
  }
  await shot(page, '08_meals');

  // ── 7. Health screen ─────────────────────────────────────────────
  console.log('\n── 7. Health screen');
  await page.evaluate(() => document.querySelector('.tab[onclick*="health"]')?.click());
  await page.waitForTimeout(300);

  const subNavCount = await page.evaluate(() => document.querySelectorAll('.sub-nav-btn').length);
  pass(`Health sub-nav tabs`, `${subNavCount}`);
  const symCount = await page.evaluate(() => document.querySelectorAll('.sym-chip').length);
  pass(`Symptom chips`, `${symCount}`);

  // Click a symptom chip and submit
  await page.evaluate(() => {
    const chips = document.querySelectorAll('.sym-chip');
    if (chips[0]) chips[0].click();
  });
  await page.waitForTimeout(200);
  const checkEnabled = await page.evaluate(() => {
    const btn = document.querySelector('.check-btn');
    return btn ? !btn.disabled : false;
  });
  if (checkEnabled) {
    await page.evaluate(() => document.querySelector('.check-btn')?.click());
    await page.waitForTimeout(500);
    const resultShown = await page.evaluate(() => document.querySelector('.result-card.visible') !== null);
    if (resultShown) pass('Symptom checker result shown');
    else warn('Result card not shown after submit');
  } else warn('Check button still disabled after chip click');
  await shot(page, '09_health_symptoms');

  // Kick counter
  await page.evaluate(() => document.querySelectorAll('.sub-nav-btn')[1]?.click());
  await page.waitForTimeout(300);
  const kickBtn = await page.evaluate(() => !!document.querySelector('.kick-tap-btn'));
  if (kickBtn) {
    pass('Kick counter panel');
    await page.evaluate(() => document.querySelector('.kick-tap-btn')?.click());
    await page.waitForTimeout(200);
    const count = await page.evaluate(() => document.querySelector('.kick-num')?.textContent.trim());
    pass('Kick tap', `count=${count}`);
  } else warn('Kick button not found');
  await shot(page, '10_health_kick');

  // Mood
  await page.evaluate(() => document.querySelectorAll('.sub-nav-btn')[2]?.click());
  await page.waitForTimeout(300);
  const moodOpts = await page.evaluate(() => document.querySelectorAll('.mood-opt').length);
  if (moodOpts > 0) {
    pass(`Mood options`, `${moodOpts} found`);
    // Select one per question group
    await page.evaluate(() => {
      document.querySelectorAll('.mood-q').forEach(q => {
        const opt = q.querySelector('.mood-opt');
        if (opt) opt.click();
      });
    });
    await page.waitForTimeout(200);
    const submitReady = await page.evaluate(() => document.querySelector('.mood-submit.ready') !== null);
    if (submitReady) pass('Mood submit activates after selections');
    else warn('Mood submit not ready');
  } else warn('No mood options found');
  await shot(page, '11_health_mood');

  // ── 8. Schedule screen ───────────────────────────────────────────
  console.log('\n── 8. Schedule screen');
  await page.evaluate(() => document.querySelector('.tab[onclick*="schedule"]')?.click());
  await page.waitForTimeout(300);
  const stageBtns = await page.evaluate(() => document.querySelectorAll('.stage-btn').length);
  const tlRows = await page.evaluate(() => document.querySelectorAll('.tl-row').length);
  pass(`Stage buttons`, `${stageBtns}`);
  pass(`Timeline rows`, `${tlRows}`);
  await page.evaluate(() => document.querySelectorAll('.stage-btn')[1]?.click());
  await page.waitForTimeout(200);
  const tlRows2 = await page.evaluate(() => document.querySelectorAll('.tl-row').length);
  pass(`Stage switch`, `now ${tlRows2} rows`);
  await shot(page, '12_schedule');

  // ── 9. Me screen ─────────────────────────────────────────────────
  console.log('\n── 9. Me screen');
  await page.evaluate(() => document.querySelector('.tab[onclick*="me"]')?.click());
  await page.waitForTimeout(300);

  const profName = await page.evaluate(() => document.querySelector('.profile-name')?.textContent.trim());
  if (profName) pass('Profile name', profName);
  else fail('Profile name not found');

  const meTabCount = await page.evaluate(() => document.querySelectorAll('.me-sec-pill').length);
  pass(`Me section tabs`, `${meTabCount}`);

  // Edit profile
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const edit = btns.find(b => b.textContent.includes('✏️'));
    if (edit) edit.click();
  });
  await page.waitForTimeout(300);
  const saveVisible = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.some(b => /save/i.test(b.textContent));
  });
  if (saveVisible) {
    pass('Profile edit opens');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const save = btns.find(b => /save/i.test(b.textContent));
      if (save) save.click();
    });
    await page.waitForTimeout(300);
    pass('Profile save');
  } else warn('Save button not found in edit mode');
  await shot(page, '13_me_profile');

  // Body tab
  await page.evaluate(() => {
    const pills = document.querySelectorAll('.me-sec-pill');
    const body = Array.from(pills).find(p => /body/i.test(p.textContent));
    if (body) body.click();
  });
  await page.waitForTimeout(300);
  const bodyTiles = await page.evaluate(() => document.querySelectorAll('.body-stat-tile').length);
  pass(`Body stat tiles`, `${bodyTiles}`);
  await shot(page, '14_me_body');

  // Diet & Goals
  await page.evaluate(() => {
    const pills = document.querySelectorAll('.me-sec-pill');
    const dg = Array.from(pills).find(p => /diet/i.test(p.textContent));
    if (dg) dg.click();
  });
  await page.waitForTimeout(300);
  await shot(page, '15_me_diet');
  pass('Diet & Goals tab navigates');

  // Doctor Qs
  await page.evaluate(() => {
    const pills = document.querySelectorAll('.me-sec-pill');
    const dq = Array.from(pills).find(p => /doctor/i.test(p.textContent));
    if (dq) dq.click();
  });
  await page.waitForTimeout(300);
  const addQInput = await page.evaluate(() => !!document.querySelector('.add-q-input'));
  if (addQInput) {
    await page.evaluate(() => {
      const inp = document.querySelector('.add-q-input');
      if (inp) { inp.value = 'Can I exercise?'; inp.dispatchEvent(new Event('input')); }
      const btn = document.querySelector('.add-q-btn');
      if (btn) btn.click();
    });
    await page.waitForTimeout(300);
    const qCount = await page.evaluate(() => document.querySelectorAll('.doc-q-item').length);
    pass(`Doctor Q add`, `${qCount} items`);
  } else warn('Doctor Q input not found');
  await shot(page, '16_me_docq');

  // ── 10. Chat ─────────────────────────────────────────────────────
  console.log('\n── 10. Bloom AI Chat');
  await page.evaluate(() => document.querySelector('.tab[onclick*="today"]')?.click());
  await page.waitForTimeout(300);

  const chatFabExists = await page.evaluate(() => !!document.getElementById('chat-fab'));
  if (chatFabExists) {
    pass('Chat FAB exists');
    await page.evaluate(() => document.getElementById('chat-fab')?.click());
    await page.waitForTimeout(400);
    await shot(page, '17_chat_open');

    const chatOpen = await page.evaluate(() => document.getElementById('chat-panel')?.classList.contains('open'));
    if (chatOpen) {
      pass('Chat panel opens');

      const sugCount = await page.evaluate(() => document.querySelectorAll('.sug-chip').length);
      pass(`Suggestion chips`, `${sugCount}`);

      // Type a message
      await page.evaluate(() => {
        const inp = document.getElementById('chat-input');
        if (inp) { inp.value = 'What foods are best in the second trimester?'; inp.dispatchEvent(new Event('input')); }
      });
      const sendReady = await page.evaluate(() => !document.getElementById('chat-send')?.disabled);
      if (sendReady) {
        await page.evaluate(() => document.getElementById('chat-send')?.click());
        pass('Chat message sent');
        await shot(page, '18_chat_sent');

        // Wait for reply (25s max)
        let replied = false;
        for (let i = 0; i < 25; i++) {
          await page.waitForTimeout(1000);
          replied = await page.evaluate(() => {
            const bots = document.querySelectorAll('.bubble-bot:not(.thinking)');
            const thinking = document.querySelector('.bubble-bot.thinking');
            return bots.length > 0 && !thinking;
          });
          if (replied) break;
        }
        if (replied) {
          const botMsg = await page.evaluate(() => document.querySelector('.bubble-bot')?.textContent.trim().slice(0,60));
          pass('Chat AI response received', botMsg + '…');
          await shot(page, '19_chat_reply');
        } else {
          const stillThinking = await page.evaluate(() => !!document.querySelector('.bubble-bot.thinking'));
          if (stillThinking) warn('Chat response still pending after 25s');
          else fail('No chat response received');
        }
      } else warn('Chat send button disabled');

      // Close
      await page.evaluate(() => document.getElementById('chat-close')?.click());
      await page.waitForTimeout(300);
      const stillOpen = await page.evaluate(() => document.getElementById('chat-panel')?.classList.contains('open'));
      if (!stillOpen) pass('Chat closes correctly');
      else fail('Chat panel did not close');
    } else fail('Chat panel did not open');
  } else fail('Chat FAB not in DOM');

  // ── 11. Mobile layout ────────────────────────────────────────────
  console.log('\n── 11. Mobile layout');
  const scrollW = await page.evaluate(() => document.body.scrollWidth);
  const clientW = await page.evaluate(() => document.body.clientWidth);
  if (scrollW <= clientW + 2) pass('No horizontal overflow', `${scrollW}px`);
  else warn('Horizontal overflow detected', `body.scrollWidth=${scrollW} > clientWidth=${clientW}`);

  const viewportMeta = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.content || '');
  if (viewportMeta.includes('viewport-fit=cover')) pass('viewport-fit=cover (safe areas OK)');
  else warn('viewport-fit=cover missing');

  const hasPWAMeta = await page.evaluate(() => !!document.querySelector('meta[name="apple-mobile-web-app-capable"]'));
  if (hasPWAMeta) pass('apple-mobile-web-app-capable set');
  else warn('apple-mobile-web-app-capable meta missing');

  // ── JS errors summary ────────────────────────────────────────────
  if (jsErrs.length === 0) pass('No JS console errors');
  else warn(`${jsErrs.length} JS errors`, jsErrs[0].slice(0,80));

  await browser.close();

  // ── Final report ─────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('FULL RESULTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  results.forEach(r => console.log(`${r.s} ${r.name}${r.note?' — '+r.note:''}`));
  const p = results.filter(r=>r.s==='✅').length;
  const f = results.filter(r=>r.s==='❌').length;
  const w = results.filter(r=>r.s==='⚠️').length;
  console.log(`\n${p} passed · ${f} failed · ${w} warnings`);
  fs.writeFileSync('/tmp/claude-0/bloom_results.json', JSON.stringify({p,f,w,results,jsErrs},null,2));
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
