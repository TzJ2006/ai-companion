export interface VerificationItem {
  name: string;
  command: string;
  expect?: string;
}

export interface FeatureEntry {
  feature: string;
  description: string;
  purpose: string;
  implementation: {
    key_files: string[];
    approach: string;
    constraints: string[];
  };
  verification: VerificationItem[];
}

export function parseEclYaml(content: string): FeatureEntry[] {
  const features: FeatureEntry[] = [];
  const featureBlocks = content.split(/^  - feature:/m).slice(1);

  for (const block of featureBlocks) {
    const fullBlock = "  - feature:" + block;
    const feature = extractYamlValue(fullBlock, "feature");
    const description = extractYamlValue(fullBlock, "description");
    const purpose = extractYamlValue(fullBlock, "purpose");
    const approach = extractYamlValue(fullBlock, "approach");

    const keyFiles = extractYamlList(fullBlock, "key_files");
    const constraints = extractYamlList(fullBlock, "constraints");
    const verification = extractVerificationItems(fullBlock);

    if (feature && description && purpose) {
      features.push({
        feature,
        description,
        purpose,
        implementation: {
          key_files: keyFiles,
          approach: approach ?? "",
          constraints,
        },
        verification,
      });
    }
  }

  return features;
}

function extractYamlValue(block: string, key: string): string | null {
  const doubleQuote = new RegExp(`${key}:\\s*"([^"]*)"`, "m");
  const singleQuote = new RegExp(`${key}:\\s*'([^']*)'`, "m");
  const match = block.match(doubleQuote) ?? block.match(singleQuote);
  return match ? match[1] : null;
}

function extractYamlList(block: string, key: string): string[] {
  const keyIndex = block.indexOf(`${key}:`);
  if (keyIndex === -1) return [];

  const afterKey = block.slice(keyIndex);
  const lines = afterKey.split("\n").slice(1);
  const items: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- \"") || trimmed.startsWith("- '")) {
      items.push(trimmed.slice(3, -1));
    } else if (trimmed.startsWith("- ")) {
      const value = trimmed.slice(2).replace(/^["']|["']$/g, "");
      items.push(value);
    } else if (trimmed === "" || (!trimmed.startsWith("-") && trimmed.includes(":"))) {
      break;
    }
  }

  return items;
}

function extractVerificationItems(block: string): VerificationItem[] {
  const items: VerificationItem[] = [];
  const verificationIndex = block.indexOf("verification:");
  if (verificationIndex === -1) return items;

  const afterVerification = block.slice(verificationIndex);
  const itemBlocks = afterVerification.split(/^\s*- name:/m).slice(1);

  for (const itemBlock of itemBlocks) {
    const fullItem = "- name:" + itemBlock;
    const nameMatch = fullItem.match(/- name:\s*(?:"([^"]*)"|'([^']*)')/);
    const commandMatch = fullItem.match(/command:\s*(?:"([^"]*)"|'([^']*)')/);
    const expectMatch = fullItem.match(/expect:\s*(?:"([^"]*)"|'([^']*)')/);

    if (nameMatch && commandMatch) {
      items.push({
        name: nameMatch[1] ?? nameMatch[2],
        command: commandMatch[1] ?? commandMatch[2] ?? "",
        expect: expectMatch ? (expectMatch[1] ?? expectMatch[2]) : undefined,
      });
    }
  }

  return items;
}
