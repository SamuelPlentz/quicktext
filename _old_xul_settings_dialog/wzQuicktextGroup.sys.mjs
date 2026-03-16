export class wzQuicktextGroup {
  constructor(config) {
    this.mName = config?.mName || config?.name || "";
    this.mProtected = config?.mProtected || config?.protected || false;
  }

  get name() { return this.mName; }
  set name(aName) { if (typeof aName != 'undefined') return this.mName = aName; }

  get protected() { return this.mProtected; }
  set protected(aProtected) { if (typeof aProtected != 'undefined') return this.mProtected = aProtected; }

  clone() {
    return new wzQuicktextGroup(this);
  }
}