// API text fields accept plain text, not HTML. This validation does not replace
// escaping at render time, and intentionally never rewrites stored input.
const HTML_MARKUP = /<\s*(?:\/?[a-z][a-z0-9:-]*(?=[\s/>])[^>]*>|![^>]*>|\?[^>]*>)/i;
const ACTIVE_URL = /^\s*(?:j[\s\x00-\x1f]*a[\s\x00-\x1f]*v[\s\x00-\x1f]*a[\s\x00-\x1f]*script\s*:|vbscript\s*:|data\s*:\s*(?:text\/html|application\/xhtml\+xml|image\/svg\+xml))/i;
const PASSWORD_FIELDS = new Set(['password', 'currentPassword', 'newPassword', 'confirmPassword']);
const PASSWORD_ROUTES = new Set(['/auth/login', '/auth/register', '/auth/reset-password', '/auth/me/password']);

function inputError(message, code = 'UNSAFE_INPUT') {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

function inspect(value, allowPasswords = false) {
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop();
    if (++count > 10000 || item.depth > 32) {
      throw inputError('Input terlalu kompleks.', 'INVALID_INPUT_STRUCTURE');
    }
    if (typeof item.value === 'string') {
      if (HTML_MARKUP.test(item.value) || ACTIVE_URL.test(item.value)) {
        throw inputError('Input harus berupa teks biasa tanpa tag HTML atau URL aktif yang berbahaya.');
      }
    } else if (item.value && typeof item.value === 'object') {
      for (const [key, child] of Object.entries(item.value)) {
        if (allowPasswords && item.depth === 0 && PASSWORD_FIELDS.has(key)) continue;
        if (HTML_MARKUP.test(key) || ACTIVE_URL.test(key)) {
          throw inputError('Nama field input tidak valid.');
        }
        pending.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
}

function inputSafetyMiddleware(req, res, next) {
  try {
    // req.path is relative to /api because this middleware is mounted there.
    const path = req.path.replace(/\/+$/, '');
    inspect(req.body, PASSWORD_ROUTES.has(path));
    inspect(req.query);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = inputSafetyMiddleware;
