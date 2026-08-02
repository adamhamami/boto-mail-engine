import type {
  MailProvider,
  SendMailOptions,
  SendMailResult,
} from "./types";

/**
 * Fournisseur de test — aucun réseau, aucun Nodemailer.
 */
export class FakeMailProvider implements MailProvider {
  readonly name = "fake";
  readonly sent: SendMailOptions[] = [];
  failNext = false;
  verifyResult = true;

  async verifyConnection(): Promise<boolean> {
    return this.verifyResult;
  }

  async send(options: SendMailOptions): Promise<SendMailResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("FakeMailProvider forced failure");
    }
    this.sent.push(options);
    return {
      messageId: `fake-${this.sent.length}-${Date.now()}`,
      accepted: [options.to],
      rejected: [],
    };
  }

  reset(): void {
    this.sent.length = 0;
    this.failNext = false;
    this.verifyResult = true;
  }
}
