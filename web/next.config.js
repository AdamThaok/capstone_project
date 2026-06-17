const path = require("path");

/** @type {import('next').NextConfig} */
module.exports = {
  // The repo root is one level up (this app lives in web/, opm/ is a sibling
  // it imports from). Point Next's file tracing at the repo root so server
  // bundles correctly include code pulled in from ../opm.
  outputFileTracingRoot: path.join(__dirname, ".."),
  allowedDevOrigins: [
    "10.110.0.177",   // current LAN IP (update if DHCP reassigns it)
    "10.110.6.245",
    "localhost",
    "127.0.0.1",
  ],
};
