const fs = require("fs");
const path = require("path");
const os = require("os");

const dir = path.join(os.tmpdir(), "opm-users");
if (fs.existsSync(dir)) {
  fs.readdirSync(dir).forEach(f => fs.unlinkSync(path.join(dir, f)));
  console.log("✅ All users cleared from:", dir);
} else {
  console.log("ℹ️  No user store found at:", dir);
}
