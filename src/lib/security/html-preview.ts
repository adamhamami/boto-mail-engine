/** Sanitize défensif pour aperçu HTML (Étape 4) — ne remplace pas un sanitizer HTML complet. */
export function sanitizePreviewHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<\/?iframe\b[^>]*>/gi, "")
    .replace(/<\/?object\b[^>]*>/gi, "")
    .replace(/<\/?embed\b[^>]*>/gi, "")
    .replace(/<\/?link\b[^>]*>/gi, "")
    .replace(/<\/?meta\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/vbscript:/gi, "")
    .replace(/data:text\/html/gi, "data:blocked");
}
