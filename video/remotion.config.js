const { Config } = require("@remotion/cli/config");
const path = require("path");

Config.setPublicDir(path.join(__dirname, "public"));
