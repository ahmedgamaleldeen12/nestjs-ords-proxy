// generate-nest-structure.js
// Creates ONE output file:
// PROJECT_STRUCTURE.md → full tree + file contents (NestJS aware)

const fs = require("fs");
const path = require("path");

// ----------------------
// CONFIG
// ----------------------

const ROOT_DIR = "./src";

const EXCLUDED_DIRS = [
  "node_modules",
  "dist",
  ".git",
  ".vscode",
];

const SKIP_CONTENT_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".svg",
  ".ico", ".woff", ".woff2", ".ttf",
  ".zip", ".lock",
];

const LANG_MAP = {
  ".ts": "typescript",
  ".js": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".html": "html",
  ".css": "css",
  ".env": "bash",
};

// Optional folder notes (NestJS-specific)
const folderComments = {
  auth: "# Authentication module (token + login logic)",
  proxy: "# ORDS API proxy layer",
  middleware: "# Request guards / CSRF protection",
  services: "# Shared services (DI providers)",
};

// ----------------------
// TREE GENERATOR
// ----------------------

function generateTree(dir, prefix = "") {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (e) =>
        !EXCLUDED_DIRS.includes(e.name)
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const lastIndex = entries.length - 1;

  return entries
    .map((entry, i) => {
      const isLast = i === lastIndex;
      const pointer = isLast ? "└── " : "├── ";
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const comment = folderComments[entry.name]
          ? `     ${folderComments[entry.name]}`
          : "";

        return (
          `${prefix}${pointer}${entry.name}/${comment}\n` +
          generateTree(fullPath, prefix + (isLast ? "    " : "│   "))
        );
      }

      return `${prefix}${pointer}${entry.name}\n`;
    })
    .join("");
}

// ----------------------
// COLLECT FILES
// ----------------------

function collectFiles(dir, list = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDED_DIRS.includes(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectFiles(fullPath, list);
    } else {
      list.push(fullPath);
    }
  }

  return list;
}

// ----------------------
// FILE CONTENTS
// ----------------------

function generateFileContents() {
  const files = collectFiles(ROOT_DIR);

  return files
    .map((filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const relativePath = path.relative(process.cwd(), filePath);

      if (SKIP_CONTENT_EXTENSIONS.includes(ext)) {
        return `### \`${relativePath}\`\n\n> skipped (binary/lock file)\n`;
      }

      let content = "";
      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch {
        return `### \`${relativePath}\`\n\n> could not read file\n`;
      }

      const lang = LANG_MAP[ext] || "";

      return `### \`${relativePath}\`\n\n\`\`\`${lang}\n${content}\n\`\`\`\n`;
    })
    .join("\n---\n\n");
}

// ----------------------
// MAIN
// ----------------------

function run() {
  const structure = generateTree(ROOT_DIR);
  const fileContents = generateFileContents();

  const output = `
# 📁 NestJS Project Structure (src/)

## Folder Tree
\`\`\`bash
src/
${structure}
\`\`\`

---

# 📄 File Contents

${fileContents}
`;

  const outPath = path.join(process.cwd(), "PROJECT_STRUCTURE.md");

  fs.writeFileSync(outPath, output, "utf8");

  console.log("✅ PROJECT_STRUCTURE.md generated successfully!");
}

run();