const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'publish-ready', 'html');

// HTML 파일 안에서 실제 문자열: C:\\Users\\Chtat GPT\\...
// JS 소스에서 이를 표현하려면 각 \를 \\로 이스케이프
const find = 'C:\\\\Users\\\\Chtat GPT\\\\Desktop\\\\Python\\\\260302_Playwright_MCP\\\\output\\\\images\\\\';
const repl = '..\\\\images\\\\';

const findNoTrail = 'C:\\\\Users\\\\Chtat GPT\\\\Desktop\\\\Python\\\\260302_Playwright_MCP\\\\output\\\\images';
const replNoTrail = '..\\\\images';

const files = fs.readdirSync(dir).filter(f => f.startsWith('cnt_') && f.endsWith('.html'));
let count = 0;
files.forEach(f => {
  const fp = path.join(dir, f);
  let c = fs.readFileSync(fp, 'utf8');
  const had = c.includes(find) || c.includes(findNoTrail);
  c = c.split(find).join(repl);
  c = c.split(findNoTrail).join(replNoTrail);
  if (had) {
    fs.writeFileSync(fp, c);
    count++;
    console.log('✅', f);
  }
});
console.log(count + ' files fixed');
