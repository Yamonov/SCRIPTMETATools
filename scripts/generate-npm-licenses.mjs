import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const appRoot = path.resolve(process.argv[2]);
const lock = JSON.parse(await readFile(path.join(appRoot, "package-lock.json"), "utf8"));
const packageEntries = Object.entries(lock.packages)
  .filter(([packagePath, metadata]) => packagePath && metadata.dev !== true)
  .sort(([left], [right]) => left.localeCompare(right));

const sections = [];
for (const [packagePath, metadata] of packageEntries) {
  const packageRoot = path.join(appRoot, packagePath);
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const entries = await readdir(packageRoot);
  const licenseName = entries.find((entry) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(entry));
  const licenseText = licenseName
    ? await readFile(path.join(packageRoot, licenseName), "utf8")
    : `License text was not bundled. Declared license: ${metadata.license ?? packageJson.license ?? "unknown"}`;
  const repository = typeof packageJson.repository === "string"
    ? packageJson.repository
    : packageJson.repository?.url;
  sections.push([
    `### ${packageJson.name} ${packageJson.version}`,
    "",
    `Declared license: \`${metadata.license ?? packageJson.license ?? "unknown"}\``,
    ...(repository ? [`Repository: ${repository}`] : []),
    "",
    "```text",
    licenseText.trim(),
    "```",
    "",
  ].join("\n"));
}

process.stdout.write(sections.join("\n"));
