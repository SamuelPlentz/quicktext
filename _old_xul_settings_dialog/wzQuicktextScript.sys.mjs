export class wzQuicktextScript {
  constructor(config) {
    this.mName = config?.mName || config?.name || "";
    this.mScript = config?.mScript || config?.script || "";
    this.mProtected = config?.mProtected || config?.protected || false;
  }

  get name() { return this.mName; }
  set name(aName) { if (typeof aName != 'undefined') return this.mName = aName; }

  get script() { return this.mScript; }
  set script(aScript) { if (typeof aScript != 'undefined') return this.mScript = aScript; }

  get protected() { return this.mProtected; }
  set protected(aProtected) { if (typeof aProtected != 'undefined') return this.mProtected = aProtected; }

  clone() {
    return new wzQuicktextScript(this);
  }
}