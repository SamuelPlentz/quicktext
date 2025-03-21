export class wzQuicktextGroup {
  constructor(config) {
    this.mName = config?.mName || config?.name || "";
    this.mType = config?.mType || config?.type || 0;
  }

  get name() { return this.mName; }
  set name(aName) { if (typeof aName != 'undefined') return this.mName = aName; }

  get type() { return this.mType; }
  set type(aType) { if (typeof aType != 'undefined') return this.mType = aType; }

  clone() {
    return new wzQuicktextGroup(this);
  }
}