const fs = require("fs");
const files = fs.readdirSync("data/ssot-posts").filter(f => f.endsWith(".json") && f[0] !== "_");
let done = 0;
for (const f of files) {
  const d = JSON.parse(fs.readFileSync("data/ssot-posts/" + f, "utf8"));
  if (d.salesContext) done++;
}
console.log(done + "/" + files.length);
