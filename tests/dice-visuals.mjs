import {chromium,expect} from '@playwright/test';
import express from 'express';
import {mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';

const app=express();
app.get('/api/auth/me',(_req,res)=>res.status(401).json({error:'Entre para continuar.'}));
app.get('/api/site-content',(_req,res)=>res.json({}));
app.get('/api/home-feature',(_req,res)=>res.json({imageData:'/assets/grimorio-book.png',bookId:''}));
app.get('/api/content/permissions',(_req,res)=>res.json({canManageContent:false}));
app.get('/socket.io/socket.io.js',(_req,res)=>res.type('application/javascript').send(''));
app.get('/dice-preview',(_req,res)=>res.type('html').send(`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#151219;color:#ddd;font:16px sans-serif}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:20px}article{background:radial-gradient(ellipse,#42232a,#1a171b 70%);border:1px solid #574149;padding:12px}h2{margin:0;color:#d3ac8f}canvas{width:100%;height:290px}p{font-size:12px;line-height:1.6}</style><div class="grid">${[4,6,8,10,12,20,100].map(sides=>`<article><h2>D${sides}</h2><canvas id="die${sides}"></canvas><p id="label${sides}"></p></article>`).join('')}</div><script src="/dice-runtime.js"></script>`));
app.use(express.static('public'));
const server=await new Promise(resolve=>{const handle=app.listen(0,'127.0.0.1',()=>resolve(handle));});
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.GRIMORIO_TEST_BROWSER?{channel:process.env.GRIMORIO_TEST_BROWSER}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const origin=`http://127.0.0.1:${server.address().port}`,errors=[],page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>errors.push(error.message));
  mkdirSync('.tmp/screenshots',{recursive:true});
  await page.goto(origin+'/');await expect(page.locator('#homeDiceCanvas')).toHaveAttribute('data-state','ready');await expect(page.locator('#homeDiceCanvas')).toHaveAttribute('data-idle','true');
  await page.screenshot({path:'.tmp/screenshots/home-d20.png',animations:'disabled'});
  await page.locator('.home-scroll-cue').click();await expect(page.locator('#sobre')).toBeInViewport();await expect.poll(async()=>Number(await page.locator('#homeDiceCanvas').getAttribute('data-progress'))).toBeGreaterThan(.1);await expect(page.locator('#homeDiceCanvas')).toHaveAttribute('data-idle','true');
  assert.ok(await page.locator('#sobre').evaluate(element=>element.classList.contains('is-revealed')));
  await page.screenshot({path:'.tmp/screenshots/home-d20-scroll.png'});
  await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('#homeDiceCanvas')).toHaveAttribute('data-progress','0.0000');await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await expect(page.locator('#homeDiceCanvas')).toHaveAttribute('data-idle','true');assert.equal(await page.locator('#homeDiceCanvas').getAttribute('data-progress'),'0.0000');
  await page.setViewportSize({width:390,height:844});await page.goto(origin+'/');await expect(page.locator('#homeDiceCanvas')).toHaveAttribute('data-state','ready');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'.tmp/screenshots/home-d20-mobile.png'});
  await page.setViewportSize({width:1440,height:1100});await page.goto(origin+'/dice-preview');await page.clock.install();await page.clock.pauseAt(new Date());
  await page.evaluate(()=>{window.testDice={};for(const sides of [4,6,8,10,12,20,100]){const controller=GrimorioDice.create(document.getElementById('die'+sides),document.getElementById('label'+sides));window.testDice[sides]=controller;controller.play({id:'preview-'+sides,sides,value:sides,seed:8456,modifier:4,total:sides+4,player:'Aventureiro',label:'Teste',createdAt:new Date().toISOString()});}});
  for(const sides of [4,6,8,10,12,20,100]){await expect(page.locator('#die'+sides)).toHaveAttribute('data-model',new RegExp('GRIMUR_D'+sides));await expect(page.locator('#label'+sides)).toContainText(`D${sides}: ${sides}`);}
  await expect(page.locator('#die100')).toHaveAttribute('data-dice-count','2');await expect(page.locator('#label100')).toContainText('00 + 0 = 100');
  await page.clock.runFor(32);await page.screenshot({path:'.tmp/screenshots/dice-set.png',fullPage:true});
  // Reduced motion must drain the queue instead of scheduling frames forever.
  await page.evaluate(()=>testDice[6].play({id:'queued-six',sides:6,value:3,seed:923,modifier:0,total:3,player:'Outro jogador'}));
  await page.clock.runFor(1100);await expect(page.locator('#die6')).toHaveAttribute('data-roll-id','queued-six');await page.clock.runFor(1100);await expect(page.locator('.dice-visible')).toHaveCount(0,{timeout:15000});
  await page.evaluate(()=>Object.values(testDice).forEach(controller=>controller.destroy()));assert.deepEqual(errors,[]);
  console.log('Home 3D, scroll, mobile, reduced motion and all custom dice passed.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
