const prerelease = /(?:alpha|beta|canary|rc|next|experimental|dev|nightly)/i;
function expectFailure(name, version, known) {
  if (known === version || !prerelease.test(known))
    throw new Error(`${name} fixture should fail for ${known}`);
}
expectFailure("missing-package", "1.2.3", "1.2.3-rc.0");
expectFailure("prerelease-disguised", "4.13.0", "4.13.0-canary.1");
console.log("dependency preflight negative fixtures passed");
