var { ExtensionParent } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionParent.sys.mjs"
);
var extension = ExtensionParent.GlobalManager.getExtension(
  "{8845E3B3-E8FB-40E2-95E9-EC40294818C4}"
);

export class wzQuicktextTemplate {
  constructor(config) {
    this.mName = config?.mName || config?.name || "";
    this.mText = config?.mText || config?.text || "";
    this.mShortcut = config?.mShortcut || config?.shortcut || "";
    this.mType = config?.mType || config?.type || "text/plain";
    this.mKeyword = config?.mKeyword || config?.keyword || "";
    this.mSubject = config?.mSubject || config?.subject || "";
    this.mAttachments = config?.mAttachments || config?.attachments || "";
    //this.mHeaders = [];
  }

  get name() { return this.mName; }
  set name(aName) { if (typeof aName != 'undefined') return this.mName = aName; }

  get text() { return this.mText; }
  set text(aText) { if (typeof aText != 'undefined') return this.mText = aText; }

  get shortcut() { return this.mShortcut; }
  set shortcut(aShortcut) { if (typeof aShortcut != 'undefined') return this.mShortcut = aShortcut; }

  get type() { return this.mType; }
  set type(aType) { if (typeof aType != 'undefined') return this.mType = aType; }

  get keyword() { return this.mKeyword; }
  set keyword(aKeyword) { if (typeof aKeyword != 'undefined') return this.mKeyword = aKeyword; }

  get subject() { return this.mSubject; }
  set subject(aSubject) { if (typeof aSubject != 'undefined') return this.mSubject = aSubject; }

  get attachments() { return this.mAttachments; }
  set attachments(aAttachments) { if (typeof aAttachments != 'undefined') return this.mAttachments = aAttachments; }

  clone() {
    return newTemplate = new wzQuicktextTemplate(this);
  }
}