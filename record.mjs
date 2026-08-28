import { chromium } from "playwright";
const out = "/tmp/claude-0/-home-user-bubble-sheet/2c53669f-48c0-57a2-a38d-ae1155cdf01c/scratchpad/rec";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const context = await browser.newContext({
  viewport: { width: 860, height: 560 },
  recordVideo: { dir: out, size: { width: 860, height: 560 } },
});
const page = await context.newPage();
await page.goto("http://localhost:5180/", { waitUntil: "networkidle" });
// a clean sheet, scrolled to the header
await page.click("#erase");
await page.evaluate(() => window.scrollTo(0, 40));
await page.waitForTimeout(700);

// name, typed at human speed — bubbles fill under each box
await page.click('#name-field .bs-cell[data-cell="1"] .bs-box');
await page.keyboard.type("LOVELACE ADA", { delay: 130 });
await page.waitForTimeout(350);

// student id
await page.click('#id-field .bs-cell[data-cell="1"] .bs-box');
await page.keyboard.type("18151210", { delay: 110 });
await page.waitForTimeout(350);

// masked date: digits only, slashes are printed
await page.click('#date-field .bs-cell[data-cell="1"] .bs-box');
await page.keyboard.type("12101815", { delay: 110 });
await page.waitForTimeout(500);

// answers: scroll to the grid, click once, then type
await page.evaluate(() => document.querySelector(".grid-hold, .hold").scrollIntoView({ block: "start" }));
await page.waitForTimeout(400);
await page.click('.bs-row[data-question="1"] input[value="A"]');
await page.keyboard.type("caebd", { delay: 200 });
await page.waitForTimeout(250);
// digit jump to 12, answer it
await page.keyboard.press("1");
await page.keyboard.press("2");
await page.waitForTimeout(300);
await page.keyboard.type("b", { delay: 150 });
await page.waitForTimeout(600);
// backspace erases and steps back
await page.keyboard.press("Backspace");
await page.waitForTimeout(700);

await context.close(); // flushes the video
await browser.close();
