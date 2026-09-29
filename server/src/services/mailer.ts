/**
 * Outbound email seam.
 *
 * No mail provider has been chosen yet (an owner decision — see the AGENT 04
 * notes), so the application talks to this interface and never to a vendor.
 * Choosing SES / Resend / SendGrid later means writing one class here.
 *
 * Until then:
 *  - development: the link is printed to the server output, because without a
 *    mail provider that link is the only way to complete verification. This is
 *    the ONE place a token is allowed to appear in output, and only when
 *    NODE_ENV=development.
 *  - test: nothing is sent; tests inject a capturing Mailer.
 *  - production: nothing is sent, and a warning says so WITHOUT the link.
 */
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface Mailer {
  sendVerification(to: string, url: string): Promise<void>;
  sendPasswordReset(to: string, url: string): Promise<void>;
}

class DevConsoleMailer implements Mailer {
  async sendVerification(to: string, url: string): Promise<void> {
    logger.info(
      { to, url },
      'DEV ONLY: verification email not sent (no mail provider); open this link',
    );
  }
  async sendPasswordReset(to: string, url: string): Promise<void> {
    logger.info({ to, url }, 'DEV ONLY: reset email not sent (no mail provider); open this link');
  }
}

class UnconfiguredMailer implements Mailer {
  async sendVerification(): Promise<void> {
    logger.warn('no mail provider configured: verification email was NOT sent');
  }
  async sendPasswordReset(): Promise<void> {
    logger.warn('no mail provider configured: reset email was NOT sent');
  }
}

export function createDefaultMailer(): Mailer {
  return config.env === 'development' ? new DevConsoleMailer() : new UnconfiguredMailer();
}
