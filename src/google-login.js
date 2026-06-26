export const GOOGLE_LOGIN_CONFIG = {
  authUrl: "",
  headed: false,
  googleButtonSelector: 'button:has-text("Google"), a:has-text("Google")',
  emailInputSelector: 'input[type="email"]',
  emailNextSelector: "#identifierNext",
  passwordInputSelector: 'input[type="password"]',
  passwordNextSelector: "#passwordNext",
  workspaceUrlPattern: /\/workspace\/(wrk_[A-Za-z0-9]+)/,
  authCookieName: "auth",
  navTimeoutMs: 45000,
  stepTimeoutMs: 20000,
};

const ERROR_MESSAGES = {
  patchright_not_installed: "patchright не установлен. Выполните: bun add patchright и bunx patchright install chromium",
  auth_url_missing: "Не задан authUrl в GOOGLE_LOGIN_CONFIG (src/google-login.js)",
  no_google_button: "Не найдена кнопка входа через Google на странице авторизации",
  google_email_missing: "Не найдено поле ввода email на Google",
  google_password_missing: "Не найдено поле ввода пароля на Google",
  wrong_password: "Неверный пароль",
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
  { code: "needs_2fa", re: /2-step|двухэтап|verification code|код подтверждения|2fa/i },
  { code: "captcha", re: /captcha|recaptcha|hcaptcha/i },
  { code: "unusual_activity", re: /unusual activity|verify it.s you|подозрительн|подтвердите|this device|challenge/i },
  { code: "wrong_password", re: /wrong password|incorrect password|неправильн|couldn.t sign you in|не удалось войти/i },
];

async function detectGoogleError(page) {
  let text = "";
  try {
    text = await page.content();
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
  try {
    await page.waitForURL(config.workspaceUrlPattern, { timeout: config.navTimeoutMs });
  } catch {
    throw new GoogleLoginError((await detectGoogleError(page)) || "unusual_activity");
  }
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

  const browser = await chromium.launch({ headless: !config.headed });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(config.stepTimeoutMs);

  try {
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
    throw new GoogleLoginError("unknown");
  } finally {
    await browser.close().catch(() => {});
  }
}
