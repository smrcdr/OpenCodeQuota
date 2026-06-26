export const GOOGLE_LOGIN_CONFIG = {
  authUrl: "https://opencode.ai/auth",
  headed: true,
  googleButtonSelector: 'a:has-text("Continue with Google")',
  emailInputSelector: '#identifierId, input[name="identifier"]',
  emailNextSelector: '#identifierNext, button:has-text("Next")',
  passwordInputSelector: 'input[type="password"], input[name="Passwd"]',
  passwordNextSelector: '#passwordNext, button:has-text("Next")',
  consentButtonSelector: 'button:has-text("Allow"), button:has-text("Continue"), button:has-text("Разрешить")',
  workspaceUrlPattern: /\/workspace\/(wrk_[A-Za-z0-9]+)/,
  authCookieName: "auth",
  navTimeoutMs: 60000,
  stepTimeoutMs: 25000,
};

const ERROR_MESSAGES = {
  patchright_not_installed: "patchright не установлен. Выполните: bun add patchright и bunx patchright install chromium",
  auth_url_missing: "Не задан authUrl в GOOGLE_LOGIN_CONFIG (src/google-login.js)",
  no_google_button: "Не найдена кнопка входа через Google на странице авторизации",
  google_email_missing: "Не найдено поле ввода email на Google",
  google_password_missing: "Не найдено поле ввода пароля на Google",
  wrong_password: "Неверный пароль",
  account_not_found: "Аккаунт Google не найден",
  unusual_activity: "Google заподозрил подозрительную активность — нужен ручной вход",
  captcha: "Google показал капчу/проверку — нужен ручной вход",
  needs_2fa: "На аккаунте включена 2FA — автоматический вход невозможен",
  no_workspace: "После входа не найден workspace в URL",
  no_auth_cookie: "После входа не получен auth cookie",
  timeout: "Превышено время ожидания при входе",
  unknown: "Неизвестная ошибка входа",
};

export class GoogleLoginError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.unknown);
    this.code = code;
    this.name = "GoogleLoginError";
  }
}

const ERROR_PATTERNS = [
  { code: "account_not_found", re: /couldn.t find|не удалось найти аккаунт|couldn.t find your google account/i },
  { code: "wrong_password", re: /wrong password|incorrect password|неправильн|couldn.t sign you in|не удалось войти/i },
  { code: "needs_2fa", re: /2-step verification|двухэтапн|verification code|код подтверждения/i },
  { code: "captcha", re: /captcha|recaptcha|hcaptcha/i },
  { code: "unusual_activity", re: /unusual activity|verify it.s you|подозрительн|подтвердите|browser or app may not be secure|может быть небезопасн/i },
];

async function detectGoogleError(page) {
  let text = "";
  try {
    text = await page.evaluate(() => document.body?.innerText || "");
  } catch {
    return null;
  }
  for (const { code, re } of ERROR_PATTERNS) {
    if (re.test(text)) {
      return code;
    }
  }
  return null;
}

async function clickGoogleButton(page, config) {
  try {
    await page.locator(config.googleButtonSelector).first().click({ timeout: config.stepTimeoutMs });
  } catch {
    throw new GoogleLoginError("no_google_button");
  }
}

async function fillEmail(page, email, config) {
  try {
    await page.waitForSelector(config.emailInputSelector, { timeout: config.stepTimeoutMs });
  } catch {
    throw new GoogleLoginError("google_email_missing");
  }
  await page.locator(config.emailInputSelector).first().fill(email);
  await page.locator(config.emailNextSelector).first().click().catch(() => {});
  try {
    await page.waitForSelector(config.passwordInputSelector, { timeout: config.stepTimeoutMs });
  } catch {
    throw new GoogleLoginError((await detectGoogleError(page)) || "unusual_activity");
  }
}

async function fillPassword(page, password, config) {
  await page.locator(config.passwordInputSelector).first().fill(password);
  await page.locator(config.passwordNextSelector).first().click().catch(() => {});
  const deadline = Date.now() + config.navTimeoutMs;
  while (Date.now() < deadline) {
    if (new RegExp(config.workspaceUrlPattern).test(page.url())) {
      return;
    }
    const consent = page.locator(config.consentButtonSelector).first();
    if (await consent.isVisible().catch(() => false)) {
      await consent.click().catch(() => {});
    }
    await page.waitForTimeout(500);
  }
  throw new GoogleLoginError((await detectGoogleError(page)) || "unusual_activity");
}

export async function loginWithGoogle({ email, password }, config = GOOGLE_LOGIN_CONFIG) {
  if (!config.authUrl) {
    throw new GoogleLoginError("auth_url_missing");
  }
  if (!email || !password) {
    throw new GoogleLoginError("unknown");
  }

  const patchright = await import("patchright").catch(() => {
    throw new GoogleLoginError("patchright_not_installed");
  });
  const chromium = patchright.chromium || patchright.default?.chromium;

  let browser;
  const deadline = Date.now() + (config.navTimeoutMs + config.stepTimeoutMs * 4 + 15000);
  const watchdog = new Promise((resolve) => {
    const ms = Math.max(0, deadline - Date.now());
    setTimeout(() => resolve(new GoogleLoginError("timeout")), ms);
  });

  const run = (async () => {
    try {
      browser = await chromium.launch({ headless: !config.headed });
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(config.stepTimeoutMs);

      await page.goto(config.authUrl, { timeout: config.navTimeoutMs, waitUntil: "domcontentloaded" });
      await clickGoogleButton(page, config);
      await fillEmail(page, email, config);
      await fillPassword(page, password, config);

      const match = page.url().match(config.workspaceUrlPattern);
      if (!match) {
        throw new GoogleLoginError("no_workspace");
      }
      const workspaceId = match[1];
      const cookies = await context.cookies();
      const auth = cookies.find((cookie) => cookie.name === config.authCookieName);
      if (!auth) {
        throw new GoogleLoginError("no_auth_cookie");
      }
      return { workspaceId, authCookie: auth.value, email };
    } catch (error) {
      if (error instanceof GoogleLoginError) {
        throw error;
      }
      if (error?.name === "TimeoutError") {
        throw new GoogleLoginError("timeout");
      }
      if (/ENOENT|spawn|executable|browser.*not.*found/i.test(error?.message || "")) {
        throw new GoogleLoginError("patchright_not_installed");
      }
      throw new GoogleLoginError("unknown");
    }
  })();

  try {
    const result = await Promise.race([run, watchdog]);
    if (result instanceof GoogleLoginError) {
      throw result;
    }
    return result;
  } finally {
    try {
      const proc = browser?._process || browser?._browserProcess;
      if (proc && typeof proc.kill === "function") {
        try { proc.kill("SIGKILL"); } catch {}
      }
    } catch {}
    await browser?.close().catch(() => {});
  }
}
