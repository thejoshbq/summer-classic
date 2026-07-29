// Builds the Windows executable: branded icon, no console window, payload intact.
//
// The icon MUST be applied to pkg's base Node binary before packaging, never to
// the finished exe. rcedit rebuilds the PE to fit the enlarged .rsrc and drops
// the appended pkg payload, leaving a bootstrap whose PAYLOAD_POSITION points
// past EOF — it flashes a console and dies. See scripts/pe.mjs.
//
// PKG_NODE_PATH is how pkg-fetch is told to use our modified base binary: its
// localPlace() returns the env var verbatim, and need() skips the SHA check
// when it is set. Overwriting the ~/.pkg-cache copy instead does not work —
// need() hashes it, finds a mismatch, and re-downloads a pristine copy.
//
// Usage: node scripts/build-win.mjs [--version 1.2.3] [--require-icon]

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { need } from '@yao-pkg/pkg-fetch';
import { readPe, setSubsystem, SUBSYSTEM_GUI } from './pe.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const requireIcon = argv.includes('--require-icon');
const versionArg = argv[argv.indexOf('--version') + 1];
const version =
  (argv.includes('--version') && versionArg) || require(path.join(ROOT, 'package.json')).version;

const OUTPUT = path.join(ROOT, 'dist', 'summer-classic-win-x64.exe');
const BASE_COPY = path.join(ROOT, 'dist', '.win-base.exe');
const ICON = path.join(ROOT, 'installer', 'icons', 'summer-classic.ico');

function fail(message) {
  console.error(`build-win: ${message}`);
  process.exit(1);
}

// Branding requires a Windows host, and not just because rcedit drives a
// Windows PE editor: PKG_NODE_PATH overrides base-binary resolution for every
// target pkg resolves, including the fabricator it executes to generate V8
// bytecode. When host and target match that is harmless, but pointing a Linux
// host's fabricator at a Windows binary makes bytecode generation fail for
// every module — pkg then ships those files without bytecode and only warns.
// So off Windows, build unbranded rather than silently degraded.
async function makeBrandedBase() {
  if (process.platform !== 'win32') {
    const message = 'the branded exe can only be built on a Windows host';
    if (requireIcon) fail(message);
    console.warn(`build-win: ${message} — building without icon or version info`);
    return null;
  }

  // Resolve the pristine base binary before PKG_NODE_PATH is anywhere in the
  // environment, or need() would hand back the path we are about to create.
  const basePath = await need({ nodeRange: 'node22', platform: 'win', arch: 'x64' });
  fs.copyFileSync(basePath, BASE_COPY);

  const { rcedit } = await import('rcedit');
  const options = {
    icon: ICON,
    'version-string': {
      ProductName: 'Summer Classic',
      CompanyName: "Lumber Jill's",
      FileDescription: 'Summer Classic operator toolkit',
      LegalCopyright: `Copyright (c) ${new Date().getFullYear()} Lumber Jill's`
    }
  };
  // rcedit rejects anything that isn't a plain dotted numeric version.
  if (/^\d+(\.\d+){0,3}$/.test(version)) {
    options['file-version'] = version;
    options['product-version'] = version;
  }
  await rcedit(BASE_COPY, options);

  return BASE_COPY;
}

function runPkg(baseBinary) {
  const pkgPackageJson = require.resolve('@yao-pkg/pkg/package.json');
  const pkgBin = path.join(path.dirname(pkgPackageJson), require(pkgPackageJson).bin.pkg);

  const env = { ...process.env };
  // Applies to every target pkg resolves, so this must stay a single-target run.
  if (baseBinary) env.PKG_NODE_PATH = baseBinary;

  const result = spawnSync(
    process.execPath,
    [pkgBin, '.', '--targets', 'node22-win-x64', '--output', OUTPUT],
    { cwd: ROOT, stdio: 'inherit', env }
  );
  if (result.status !== 0) fail(`pkg exited with ${result.status}`);
}

// The check that would have caught the original bug. A zero-byte overlay means
// the payload never made it into the exe, which only shows up at launch time.
function verify() {
  const pe = readPe(OUTPUT);
  console.log(
    `build-win: ${path.basename(OUTPUT)} — ${pe.fileSize} bytes, ` +
      `${pe.overlayBytes} bytes of pkg payload, subsystem ${pe.subsystem}`
  );
  if (pe.overlayBytes <= 0) {
    fail('packaged exe has no pkg payload — something rewrote the PE after packaging');
  }
  if (pe.subsystem !== SUBSYSTEM_GUI) {
    fail(`packaged exe subsystem is ${pe.subsystem}, expected ${SUBSYSTEM_GUI} (GUI)`);
  }
}

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });

const baseBinary = await makeBrandedBase();
runPkg(baseBinary);

// Console-subsystem exes pop a terminal for the app's lifetime, which is wrong
// on a venue laptop. Safe to do after packaging, unlike rcedit: this rewrites
// two bytes of the optional header in place and moves nothing.
setSubsystem(OUTPUT, SUBSYSTEM_GUI);

verify();

fs.rmSync(BASE_COPY, { force: true });
