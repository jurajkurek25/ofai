const SPAM_PATTERNS = [
  /\b(earn|make)\s+\$[\d,]+\s+(a day|per day|daily|weekly)/i,
  /click\s+here\s+to\s+(claim|get|win)/i,
  /congratulations.*you.*(won|selected|chosen)/i,
  /free\s+(iphone|gift card|money|cash)/i,
  /\bbitcoin\b.*\binvest/i,
  /whatsapp.*\+\d{7,}/i,
  /(dm|text|call|contact)\s+me\s+(on|at|via)\s+\+?\d/i,
  /(.)\1{8,}/,                          // e.g. "aaaaaaaaaaa"
  /(https?:\/\/[^\s]+\s*){3,}/i,       // 3+ links in one message
];

const SENSITIVE_REQUEST_PATTERNS = [
  /\b(nude|naked|explicit|xxx|porn|sex\s+video|onlyfans\s+free)\b/i,
  /\b(meet\s+in\s+person|where\s+do\s+you\s+live|your\s+address)\b/i,
  /send\s+me\s+(your\s+)?(number|phone|snapchat|whatsapp|telegram)\b/i,
  /\b(hack|ddos|dox|swat)\b/i,
];

export function isSpam(message: string): boolean {
  return SPAM_PATTERNS.some((p) => p.test(message));
}

export function containsSensitiveRequest(message: string): boolean {
  return SENSITIVE_REQUEST_PATTERNS.some((p) => p.test(message));
}

export function sanitizeForLog(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').slice(0, 200);
}
