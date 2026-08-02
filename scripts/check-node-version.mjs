import process from 'node:process';

const requiredMajorVersion = 24;
const actualMajorVersion = Number(process.versions.node.split('.')[0]);

if (actualMajorVersion !== requiredMajorVersion) {
  process.stderr.write(
    `Node.js ${requiredMajorVersion}.x is required; detected ${process.versions.node}. Use the version in .nvmrc.\n`,
  );
  process.exitCode = 1;
}
