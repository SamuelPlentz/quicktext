export class wzQuicktextHeader {
  constructor() {
    this.mType        = "";
    this.mValue     = "";
  }
  
  get type() { return this.mType; }
  set type(aType) { if (typeof aType != 'undefined') return this.mType = aType; }

  get value() { return this.mValue; }
  set value(aValue) { if (typeof aValue != 'undefined') return this.mValue = aValue; }

  clone() {
    const newHeader = new wzQuicktextHeader();
    newHeader.type = this.mType;
    newHeader.value = this.mValue;

    return newHeader;
  }
}