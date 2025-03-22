export class QuicktextTemplate {
  constructor(config) {
    this.name = config.mName || config.name || "";
    this.text = config.mText || config.text || "";
    this.shortcut = config.mShortcut || config.shortcut || "";
    this.type = config.mType || config.type || "text/plain";
    this.keyword = config.mKeyword || config.keyword || "";
    this.subject = config.mSubject || config.subject || "";
    this.attachments = config.mAttachments || config.attachments || "";
  }
}
