export type PlaybookGuardResult = {
  valid: boolean;
  errors: string[];
  sanitizedProcedure?: string;
};

const FORBIDDEN_PATTERNS = [
  /eval\s*\(/i,
  /exec\s*\(/i,
  /__import__\s*\(/i,
  /import\s+os\s*/i,
  /import\s+sys\s*/i,
  /subprocess\./i,
  /child_process\.exec/i,
  /process\.env\.\w+/i,
  /process\.cwd\(\)/i,
  /fs\.(read|write)(File|Sync)?/i,
  /require\s*\(\s*['"]fs['"]/i,
  /require\s*\(\s*['"]child_process['"]/i,
  /rm\s+-rf/i,
  /chmod\s+777/i,
  /curl\s+.*\|\s*sh/i,
];

const DANGEROUS_PATTERNS = [
  /delete\s+.*from\s+.*where/i,
  /drop\s+table/i,
  /truncate\s+table/i,
  /\.ssh\//i,
  /\/etc\/passwd/i,
  /\/etc\/shadow/i,
  /\.env\s*=/i,
  /api[_-]?key\s*=/i,
  /secret\s*=/i,
  /password\s*=/i,
  /token\s*=\s*['"][^'"]+['"]/i,
];

const MAX_LINE_LENGTH = 500;
const MAX_LINES = 200;

export function guardPlaybookProcedure(procedure: string): PlaybookGuardResult {
  const errors: string[] = [];
  const lines = procedure.split("\n");
  const sanitizedLines: string[] = [];

  if (procedure.length > 2000) {
    errors.push(`Procedure too long: ${procedure.length} chars (max 2000)`);
  }

  if (procedure.length < 20) {
    errors.push(`Procedure too short: ${procedure.length} chars (min 20)`);
  }

  if (lines.length > MAX_LINES) {
    errors.push(`Too many lines: ${lines.length} (max ${MAX_LINES})`);
  }

  for (const line of lines) {
    if (line.length > MAX_LINE_LENGTH) {
      errors.push(`Line too long: ${line.length} chars (max ${MAX_LINE_LENGTH})`);
    }

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(line)) {
        errors.push(`Forbidden pattern detected: ${pattern.source}`);
      }
    }

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(line)) {
        errors.push(`Dangerous pattern detected: ${pattern.source}`);
      }
    }

    sanitizedLines.push(line.replace(/\$\{[^}]+\}/g, "[variable]").replace(/\$[A-Z_][A-Z0-9_]*/g, "[env_var]"));
  }

  const sanitized = sanitizedLines.join("\n");

  return {
    valid: errors.length === 0,
    errors,
    sanitizedProcedure: sanitized,
  };
}

export function guardPlaybookName(name: string): PlaybookGuardResult {
  const errors: string[] = [];

  if (name.length < 3) {
    errors.push("Name too short (min 3 chars)");
  }

  if (name.length > 80) {
    errors.push("Name too long (max 80 chars)");
  }

  if (!/^[a-zA-Z0-9\s\-_.,!?'"()]+$/.test(name)) {
    errors.push("Name contains invalid characters");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function guardPlaybookTags(tags: string[]): PlaybookGuardResult {
  const errors: string[] = [];

  if (tags.length > 10) {
    errors.push(`Too many tags: ${tags.length} (max 10)`);
  }

  for (const tag of tags) {
    if (!/^[a-z0-9\-_]+$/.test(tag)) {
      errors.push(`Invalid tag format: "${tag}" (use lowercase letters, numbers, hyphens, underscores)`);
    }
    if (tag.length > 30) {
      errors.push(`Tag too long: "${tag}" (max 30 chars)`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
