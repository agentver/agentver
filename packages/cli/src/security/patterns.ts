import type { ScanRule } from './types.js'

export const SCAN_RULES: ScanRule[] = [
  // --- DANGEROUS_COMMAND (HIGH) ---
  {
    id: 'DC001',
    category: 'DANGEROUS_COMMAND',
    severity: 'HIGH',
    pattern: /\brm\s+-rf\b/,
    message: 'Recursive force delete detected (rm -rf)',
  },
  {
    id: 'DC002',
    category: 'DANGEROUS_COMMAND',
    severity: 'HIGH',
    pattern: /\bsudo\s+/,
    message: 'Elevated privilege command detected (sudo)',
  },
  {
    id: 'DC003',
    category: 'DANGEROUS_COMMAND',
    severity: 'HIGH',
    pattern: /\bchmod\s+777\b/,
    message: 'World-writable permission detected (chmod 777)',
  },
  {
    id: 'DC004',
    category: 'DANGEROUS_COMMAND',
    severity: 'HIGH',
    pattern: /\bcurl\b.*\|.*\bbash\b/,
    message: 'Piped remote script execution detected (curl | bash)',
  },
  {
    id: 'DC005',
    category: 'DANGEROUS_COMMAND',
    severity: 'HIGH',
    pattern: /\beval\s*\(/,
    message: 'Dynamic code evaluation detected (eval())',
  },
  {
    id: 'DC006',
    category: 'DANGEROUS_COMMAND',
    severity: 'HIGH',
    pattern: /(?<!\.)\bexec\s*\(/,
    message: 'Process execution detected (exec())',
  },
  {
    id: 'DC007',
    category: 'DANGEROUS_COMMAND',
    severity: 'HIGH',
    pattern: /\bsystem\s*\(/,
    message: 'System command execution detected (system())',
  },
  {
    id: 'DC016',
    category: 'DANGEROUS_COMMAND',
    severity: 'HIGH',
    pattern: /\bos\.system\s*\(/,
    message: 'Python system command execution detected (os.system())',
  },
  {
    id: 'DC017',
    category: 'DANGEROUS_COMMAND',
    severity: 'HIGH',
    pattern: /\bsubprocess\.run\s*\(/,
    message: 'Python subprocess execution detected (subprocess.run())',
  },

  // --- DATA_EXFILTRATION (CRITICAL) ---
  {
    id: 'DE001',
    category: 'DATA_EXFILTRATION',
    severity: 'CRITICAL',
    pattern: /\bcurl\b.*-X\s*POST\b/,
    message: 'Outbound POST request via curl detected',
  },
  {
    id: 'DE002',
    category: 'DATA_EXFILTRATION',
    severity: 'CRITICAL',
    pattern: /\bfetch\s*\([^)]*body\s*:/,
    message: 'Outbound fetch with body payload detected',
  },
  {
    id: 'DE003',
    category: 'DATA_EXFILTRATION',
    severity: 'CRITICAL',
    pattern: /\bwebhook\.site\b/,
    message: 'Known data exfiltration domain detected (webhook.site)',
  },
  {
    id: 'DE004',
    category: 'DATA_EXFILTRATION',
    severity: 'CRITICAL',
    pattern: /\bngrok\b/,
    message: 'Tunnelling service detected (ngrok)',
  },
  {
    id: 'DE005',
    category: 'DATA_EXFILTRATION',
    severity: 'CRITICAL',
    pattern: /\brequestbin\b/i,
    message: 'Known data exfiltration service detected (requestbin)',
  },

  // --- OBFUSCATED_CODE (HIGH) ---
  {
    id: 'OC001',
    category: 'OBFUSCATED_CODE',
    severity: 'HIGH',
    pattern: /[A-Za-z0-9+/=]{200,}/,
    message: 'Long base64-like string detected (>200 characters)',
  },
  {
    id: 'OC002',
    category: 'OBFUSCATED_CODE',
    severity: 'HIGH',
    pattern: /(\\x[0-9a-fA-F]{2}){10,}/,
    message: 'Hex escape chain detected (>10 sequences)',
  },
  {
    id: 'OC003',
    category: 'OBFUSCATED_CODE',
    severity: 'HIGH',
    pattern: /String\.fromCharCode\s*\([^)]*,/,
    message: 'Character code construction chain detected (String.fromCharCode)',
  },
  {
    id: 'OC004',
    category: 'OBFUSCATED_CODE',
    severity: 'MEDIUM',
    pattern: /\\u00[0-9a-fA-F]{2}/,
    message: 'Unicode escape sequence detected — potential code obfuscation',
  },
  {
    id: 'OC005',
    category: 'OBFUSCATED_CODE',
    severity: 'MEDIUM',
    pattern: /\batob\s*\(/,
    message: 'Base64 decode detected (atob()) — potential obfuscated payload',
  },
  {
    id: 'OC006',
    category: 'OBFUSCATED_CODE',
    severity: 'MEDIUM',
    pattern: /\bbtoa\s*\(/,
    message: 'Base64 encode detected (btoa()) — potential data exfiltration encoding',
  },

  // --- SUSPICIOUS_URL (MEDIUM) ---
  {
    id: 'SU001',
    category: 'SUSPICIOUS_URL',
    severity: 'MEDIUM',
    pattern: /\bpastebin\.com\b/,
    message: 'Suspicious URL detected (pastebin.com)',
  },
  {
    id: 'SU002',
    category: 'SUSPICIOUS_URL',
    severity: 'MEDIUM',
    pattern: /\bdiscord\.com\/api\/webhooks\b/,
    message: 'Discord webhook URL detected',
  },
  {
    id: 'SU003',
    category: 'SUSPICIOUS_URL',
    severity: 'MEDIUM',
    pattern: /\bbit\.ly\//,
    message: 'URL shortener detected (bit.ly)',
  },
  {
    id: 'SU004',
    category: 'SUSPICIOUS_URL',
    severity: 'MEDIUM',
    pattern: /\bt\.ly\//,
    message: 'URL shortener detected (t.ly)',
  },

  // --- DATA_EXFILTRATION: process.env (HIGH) ---
  {
    id: 'DE006',
    category: 'DATA_EXFILTRATION',
    severity: 'HIGH',
    pattern: /\bprocess\.env\.[A-Z_]{2,}\b/,
    message: 'Environment variable access detected (process.env.VAR)',
  },
  {
    id: 'DE007',
    category: 'DATA_EXFILTRATION',
    severity: 'HIGH',
    pattern: /\bprocess\.env\s*\[/,
    message: 'Dynamic environment variable access detected (process.env[...])',
  },
  {
    id: 'DE008',
    category: 'DATA_EXFILTRATION',
    severity: 'HIGH',
    pattern: /\bprocess\s*\[\s*['"]env['"]\s*\]/,
    message: "Obfuscated environment variable access detected (process['env'])",
  },

  // --- DATA_EXFILTRATION: wget (HIGH) ---
  {
    id: 'DE009',
    category: 'DATA_EXFILTRATION',
    severity: 'HIGH',
    pattern: /\bwget\s/,
    message: 'File download via wget detected',
  },
  {
    id: 'DE010',
    category: 'DATA_EXFILTRATION',
    severity: 'HIGH',
    pattern: /\bwget\s*\(/,
    message: 'Programmatic wget invocation detected',
  },

  // --- DATA_EXFILTRATION: nc/netcat (CRITICAL) ---
  {
    id: 'DE011',
    category: 'DATA_EXFILTRATION',
    severity: 'CRITICAL',
    pattern: /\bnc\s+-[A-Za-z]*[elp]/,
    message: 'Netcat usage detected (nc) — potential reverse shell or data exfiltration',
  },
  {
    id: 'DE012',
    category: 'DATA_EXFILTRATION',
    severity: 'CRITICAL',
    pattern: /\bnetcat\b/,
    message: 'Netcat usage detected — potential reverse shell or data exfiltration',
  },
  {
    id: 'DE013',
    category: 'DATA_EXFILTRATION',
    severity: 'CRITICAL',
    pattern: /\bncat\b/,
    message: 'Ncat usage detected — potential reverse shell or data exfiltration',
  },

  // --- DATA_EXFILTRATION: DNS exfiltration (HIGH) ---
  {
    id: 'DE014',
    category: 'DATA_EXFILTRATION',
    severity: 'HIGH',
    pattern: /\bnslookup\s/,
    message: 'DNS lookup detected (nslookup) — potential DNS exfiltration',
  },
  {
    id: 'DE015',
    category: 'DATA_EXFILTRATION',
    severity: 'HIGH',
    pattern: /\bdig\s+(@\S+\s+)?\S+\.\S+/,
    message: 'DNS query detected (dig) — potential DNS exfiltration',
  },
  {
    id: 'DE016',
    category: 'DATA_EXFILTRATION',
    severity: 'HIGH',
    pattern: /\bhost\s+\S+\.\S+/,
    message: 'DNS resolution detected (host) — potential DNS exfiltration',
  },

  // --- DANGEROUS_COMMAND: child_process (CRITICAL) ---
  {
    id: 'DC008',
    category: 'DANGEROUS_COMMAND',
    severity: 'CRITICAL',
    pattern: /\brequire\s*\(\s*['"`]child_process['"`]\s*\)/,
    message: 'Child process module import detected (require child_process)',
  },
  {
    id: 'DC009',
    category: 'DANGEROUS_COMMAND',
    severity: 'CRITICAL',
    pattern: /\bfrom\s+['"]child_process['"]/,
    message: 'Child process module import detected (from child_process)',
  },
  {
    id: 'DC010',
    category: 'DANGEROUS_COMMAND',
    severity: 'CRITICAL',
    pattern: /(?<!\.)\bspawn\s*\(/,
    message: 'Process spawn detected (spawn())',
  },
  {
    id: 'DC011',
    category: 'DANGEROUS_COMMAND',
    severity: 'CRITICAL',
    pattern: /\bexecSync\s*\(/,
    message: 'Synchronous command execution detected (execSync())',
  },
  {
    id: 'DC012',
    category: 'DANGEROUS_COMMAND',
    severity: 'CRITICAL',
    pattern: /\bexecFile\s*\(/,
    message: 'File execution detected (execFile())',
  },
  {
    id: 'DC013',
    category: 'DANGEROUS_COMMAND',
    severity: 'CRITICAL',
    pattern: /(?<!\.)\bfork\s*\(/,
    message: 'Process fork detected (fork())',
  },

  // --- DANGEROUS_COMMAND: Function constructor (HIGH) ---
  {
    id: 'DC014',
    category: 'DANGEROUS_COMMAND',
    severity: 'HIGH',
    pattern: /\bnew\s+Function\s*\(/,
    message: 'Function constructor detected (new Function()) — dynamic code execution',
  },
  {
    id: 'DC015',
    category: 'DANGEROUS_COMMAND',
    severity: 'HIGH',
    pattern: /(?<!\w)Function\s*\(\s*['"`]/,
    message: 'Function constructor invocation detected (Function()) — dynamic code execution',
  },

  // --- CREDENTIAL_EXPOSURE (HIGH) ---
  {
    id: 'CE001',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'HIGH',
    pattern: /\bsk-[a-zA-Z0-9]{20,}\b/,
    message: 'Potential OpenAI/Stripe API key detected (sk-...)',
  },
  {
    id: 'CE002',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'HIGH',
    pattern: /\bAKIA[A-Z0-9]{16}\b/,
    message: 'AWS access key ID detected (AKIA...)',
  },
  {
    id: 'CE003',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'HIGH',
    pattern: /\bghp_[a-zA-Z0-9]{36}\b/,
    message: 'GitHub personal access token detected (ghp_...)',
  },
  {
    id: 'CE004',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'HIGH',
    pattern: /\bpassword\s*=\s*['"][^'"]{8,}['"]/i,
    message: 'Hardcoded password assignment detected',
  },
  {
    id: 'CE005',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'HIGH',
    pattern: /\bgithub_pat_[a-zA-Z0-9_]{20,}\b/,
    message: 'GitHub fine-grained personal access token detected (github_pat_...)',
  },
  {
    id: 'CE006',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'HIGH',
    pattern: /["']private_key["']\s*:\s*["']-----BEGIN/,
    message: 'GCP service account private key detected',
  },

  // --- CREDENTIAL_EXPOSURE: generic token/secret assignments (HIGH) ---
  {
    id: 'CE007',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'HIGH',
    pattern: /\btoken\s*=\s*['"][A-Za-z0-9\-_.]{8,}['"]/,
    message: 'Hardcoded token assignment detected',
  },
  {
    id: 'CE008',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'HIGH',
    pattern: /\bapi_key\s*=\s*['"][A-Za-z0-9\-_.]{8,}['"]/,
    message: 'Hardcoded API key assignment detected (api_key)',
  },
  {
    id: 'CE009',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'HIGH',
    pattern: /\bapiKey\s*=\s*['"][A-Za-z0-9\-_.]{8,}['"]/,
    message: 'Hardcoded API key assignment detected (apiKey)',
  },
  {
    id: 'CE010',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'HIGH',
    pattern: /\bsecret\s*=\s*['"][A-Za-z0-9\-_.]{8,}['"]/,
    message: 'Hardcoded secret assignment detected',
  },

  // --- CREDENTIAL_EXPOSURE: GCP service account key (CRITICAL) ---
  {
    id: 'CE011',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'CRITICAL',
    pattern: /"type"\s*:\s*"service_account"/,
    message: 'GCP service account key file detected',
  },

  // --- CREDENTIAL_EXPOSURE: Slack token (CRITICAL) ---
  {
    id: 'CE012',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'CRITICAL',
    pattern: /xox[bpras]-[a-zA-Z0-9-]+/,
    message: 'Slack token detected (xox[bpras]-...)',
  },
  {
    id: 'CE013',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'HIGH',
    pattern: /\bsk-ant-[A-Za-z0-9\-_]{20,}\b/,
    message: 'Anthropic API key detected (sk-ant-...)',
  },
  {
    id: 'CE014',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'HIGH',
    pattern: /\bglpat-[A-Za-z0-9\-_]{20,}\b/,
    message: 'GitLab personal access token detected (glpat-...)',
  },
  {
    id: 'CE015',
    category: 'CREDENTIAL_EXPOSURE',
    severity: 'HIGH',
    pattern: /\bnpm_[A-Za-z0-9]{20,}\b/,
    message: 'npm access token detected (npm_...)',
  },

  // --- CREDENTIAL_FILE: path-based credential detection (CRITICAL) ---
  {
    id: 'CF001',
    category: 'CREDENTIAL_FILE',
    severity: 'CRITICAL',
    pattern: /\.aws\/credentials/,
    message: 'AWS credentials file detected',
  },
  {
    id: 'CF002',
    category: 'CREDENTIAL_FILE',
    severity: 'CRITICAL',
    pattern: /\.ssh\/id_rsa/,
    message: 'SSH private key file reference detected (id_rsa)',
  },
  {
    id: 'CF003',
    category: 'CREDENTIAL_FILE',
    severity: 'CRITICAL',
    pattern: /\.ssh\/id_ed25519/,
    message: 'SSH private key file reference detected (id_ed25519)',
  },
  {
    id: 'CF004',
    category: 'CREDENTIAL_FILE',
    severity: 'CRITICAL',
    pattern: /\.kube\/config/,
    message: 'Kubernetes config file reference detected',
  },
  {
    id: 'CF005',
    category: 'CREDENTIAL_FILE',
    severity: 'CRITICAL',
    pattern: /\.npmrc\b.*_authToken/,
    message: 'NPM auth token in .npmrc detected',
  },

  // --- PATH_TRAVERSAL (HIGH) ---
  {
    id: 'PT001',
    category: 'PATH_TRAVERSAL',
    severity: 'HIGH',
    pattern: /(^|[\s"'`])\.\.(?:\/|\\)/,
    message: 'Path traversal sequence detected (../ or ..\\)',
  },
  {
    id: 'PT002',
    category: 'PATH_TRAVERSAL',
    severity: 'HIGH',
    pattern: /\bpath\.(?:join|resolve)\s*\([^)]*\.\./,
    message: 'Path traversal via path.join/path.resolve detected',
  },

  // --- PROMPT_INJECTION (MEDIUM) ---
  {
    id: 'PI001',
    category: 'PROMPT_INJECTION',
    severity: 'MEDIUM',
    pattern: /\bignore\s+previous\s+instructions\b/i,
    message: 'Prompt injection pattern detected (ignore previous instructions)',
  },
  {
    id: 'PI002',
    category: 'PROMPT_INJECTION',
    severity: 'MEDIUM',
    pattern: /\byou\s+are\s+now\b/i,
    message: 'Prompt injection pattern detected (you are now)',
  },
  {
    id: 'PI003',
    category: 'PROMPT_INJECTION',
    severity: 'MEDIUM',
    pattern: /\bdisregard\s+all\s+prior\b/i,
    message: 'Prompt injection pattern detected (disregard all prior)',
  },
  {
    id: 'PI004',
    category: 'PROMPT_INJECTION',
    severity: 'MEDIUM',
    pattern: /\bforget\s+your\s+instructions\b/i,
    message: 'Prompt injection pattern detected (forget your instructions)',
  },
  {
    id: 'PI005',
    category: 'PROMPT_INJECTION',
    severity: 'MEDIUM',
    pattern: /\bact\s+as\s+(if\s+you\s+are|a\s+|an\s+)/i,
    message: 'Prompt injection pattern detected (act as)',
  },
  {
    id: 'PI006',
    category: 'PROMPT_INJECTION',
    severity: 'MEDIUM',
    pattern: /\bnew\s+persona\b/i,
    message: 'Prompt injection pattern detected (new persona)',
  },
  {
    id: 'PI007',
    category: 'PROMPT_INJECTION',
    severity: 'HIGH',
    pattern: /\bjailbreak\b/i,
    message: 'Prompt injection pattern detected (jailbreak)',
  },
  {
    id: 'PI008',
    category: 'PROMPT_INJECTION',
    severity: 'MEDIUM',
    pattern: /\boverride\s+(your\s+)?(previous\s+|prior\s+|all\s+)?instructions\b/i,
    message: 'Prompt injection pattern detected (override instructions)',
  },

  // --- UNICODE_OBFUSCATION (HIGH/MEDIUM) ---
  // Non-printing and invisible Unicode codepoints that render as blank in editors
  // and never enter standard scanner token streams — classic evasion technique.
  {
    id: 'UO001',
    category: 'UNICODE_OBFUSCATION',
    severity: 'HIGH',
    // Zero-width space, non-joiner, joiner, no-break space (BOM)
    // Alternation required — \u200D (ZWJ) in a character class misleads some regex engines
    pattern: /\u200B|\u200C|\u200D|\uFEFF/,
    message: 'Zero-width Unicode character detected — invisible content that may hide instructions',
  },
  {
    id: 'UO002',
    category: 'UNICODE_OBFUSCATION',
    severity: 'HIGH',
    // Right-to-left override/embedding — reverses rendered text to disguise payloads
    pattern: /[\u202E\u202B\u202D]/,
    message:
      'Right-to-left override character detected — may disguise text direction to hide payloads',
  },
  {
    id: 'UO003',
    category: 'UNICODE_OBFUSCATION',
    severity: 'MEDIUM',
    // Soft hyphen, word joiner, function application — render as nothing in most editors
    pattern: /[\u00AD\u2060\u2061\u2062\u2063\u2064]/,
    message: 'Invisible formatting character detected — may be used to evade pattern matching',
  },
  {
    id: 'UO004',
    category: 'UNICODE_OBFUSCATION',
    severity: 'HIGH',
    // Unicode tag block (U+E0000–U+E007F) — designed for invisible tagging, widely used in prompt injection
    // Must use \u{} notation with the u flag for code points above U+FFFF
    pattern: /[\u{E0000}-\u{E007F}]/u,
    message:
      'Unicode tag character detected (U+E0000 block) — known vector for invisible prompt injection',
  },
  {
    id: 'UO005',
    category: 'UNICODE_OBFUSCATION',
    severity: 'MEDIUM',
    // BMP variation selectors (U+FE00–U+FE0F) — alter glyph appearance invisibly, used in homoglyph attacks
    pattern: /[\uFE00-\uFE0F]/u,
    message:
      'Unicode variation selector detected — may alter character appearance to evade detection',
  },
  {
    id: 'UO006',
    category: 'UNICODE_OBFUSCATION',
    severity: 'MEDIUM',
    // Interlinear annotation characters and other invisible separators
    pattern: /[\u2028\u2029\u180E\uFFA0]/,
    message: 'Invisible Unicode separator detected — may be used to bypass line-based scanning',
  },

  // --- REMOTE_CODE_EXECUTION (CRITICAL) ---
  {
    id: 'RCE001',
    category: 'REMOTE_CODE_EXECUTION',
    severity: 'CRITICAL',
    pattern: /\bimport\s*\(\s*['"`]https?:/,
    message: 'Dynamic remote import detected (import() with URL)',
  },
  {
    id: 'RCE002',
    category: 'REMOTE_CODE_EXECUTION',
    severity: 'CRITICAL',
    pattern: /\brequire\s*\(\s*['"`]https?:/,
    message: 'Remote require detected (require() with URL)',
  },
  {
    id: 'RCE003',
    category: 'REMOTE_CODE_EXECUTION',
    severity: 'CRITICAL',
    pattern: /\beval\s*\(\s*.*\bfetch\s*\(/,
    message: 'Remote code execution detected (eval(fetch()))',
  },
]
