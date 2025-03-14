var { wzQuicktextHeader } = ChromeUtils.importESModule("chrome://quicktext/content/modules/wzQuicktextHeader.sys.mjs");

export class wzQuicktextTemplate {
  constructor() {
    this.mName        = "";
    this.mText        = "";
    this.mShortcut    = "";
    this.mType        = "";
    this.mKeyword     = "";
    this.mSubject     = "";
    this.mAttachments = "";
    this.mHeaders     = [];
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

  getHeader(aIndex) {
    return this.mHeaders[aIndex];
  }

  addHeader(aType, aValue) {
    const tmp = new wzQuicktextHeader();
    tmp.type = aType;
    tmp.value = aValue;
    this.mHeaders.push(tmp);
  }

  removeHeader (aIndex) {
    this.mHeaders.splice(aIndex, 0);
  }

  removeHeaders() {
    this.mHeaders = [];
  }

  getHeaderLength() {
    return this.mHeaders.length;
  }

  clone() {
    const newTemplate = new wzQuicktextTemplate();
    newTemplate.name = this.mName;
    newTemplate.text = this.mText;
    newTemplate.shortcut = this.mShortcut;
    newTemplate.type = this.mType;
    newTemplate.keyword = this.mKeyword;
    newTemplate.subject = this.mSubject;
    newTemplate.attachments = this.mAttachments;

    for (let i = 0; i < this.mHeaders.length; i++)
      newTemplate.addHeader(this.mHeaders[i].type, this.mHeaders[i].value);

    return newTemplate;
  }
}