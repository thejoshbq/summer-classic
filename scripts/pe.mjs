// Minimal PE reader/patcher for the Windows packaging steps.
//
// pkg does not put its payload in a PE section: producer.js writes the base
// Node binary, records `payloadPosition = <base binary length>`, then appends
// the payload and prelude as a raw overlay past the last section and patches
// that absolute offset into the binary. Anything that rewrites the PE after
// packaging (rcedit, signtool, upx) drops the overlay and produces an exe that
// dies on launch before running a line of app code. readPe() exists so the
// build can assert the overlay is still there.

import fs from 'fs';

const SUBSYSTEM_CUI = 3;
const SUBSYSTEM_GUI = 2;

// Offset of Subsystem within the optional header. Identical for PE32 and
// PE32+: the extra 8 bytes of a 64-bit ImageBase are offset by the missing
// BaseOfData field, so the Windows-specific fields realign at 32.
const SUBSYSTEM_OFFSET_IN_OPTIONAL_HEADER = 68;

function readPe(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error(`${file}: not a PE file (no MZ header)`);

  const peHeader = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(peHeader) !== 0x00004550) throw new Error(`${file}: not a PE file (no PE signature)`);

  const coffHeader = peHeader + 4;
  const sectionCount = buf.readUInt16LE(coffHeader + 2);
  const optionalHeaderSize = buf.readUInt16LE(coffHeader + 16);
  const optionalHeader = coffHeader + 20;

  const subsystemOffset = optionalHeader + SUBSYSTEM_OFFSET_IN_OPTIONAL_HEADER;
  const sectionTable = optionalHeader + optionalHeaderSize;

  const sections = [];
  let endOfLastSection = 0;
  for (let i = 0; i < sectionCount; i++) {
    const row = sectionTable + i * 40;
    const rawSize = buf.readUInt32LE(row + 16);
    const rawOffset = buf.readUInt32LE(row + 20);
    sections.push({
      name: buf.subarray(row, row + 8).toString('latin1').replace(/\0+$/, ''),
      rawOffset,
      rawSize
    });
    endOfLastSection = Math.max(endOfLastSection, rawOffset + rawSize);
  }

  return {
    file,
    fileSize: buf.length,
    subsystem: buf.readUInt16LE(subsystemOffset),
    subsystemOffset,
    sections,
    endOfLastSection,
    overlayBytes: buf.length - endOfLastSection
  };
}

function setSubsystem(file, subsystem) {
  const { subsystemOffset } = readPe(file);
  const fd = fs.openSync(file, 'r+');
  try {
    const value = Buffer.alloc(2);
    value.writeUInt16LE(subsystem);
    fs.writeSync(fd, value, 0, 2, subsystemOffset);
  } finally {
    fs.closeSync(fd);
  }
}

export { readPe, setSubsystem, SUBSYSTEM_CUI, SUBSYSTEM_GUI };
