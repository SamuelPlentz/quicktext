export class wzQuicktextScript {
  constructor() {
    this.mName        = "";
    this.mScript      = "";
    this.mType        = 0;
  }

  get name() { return this.mName; }
  set name(aName) { if (typeof aName != 'undefined') return this.mName = aName; }

  get script() { return this.mScript; }
  set script(aScript) { if (typeof aScript != 'undefined') return this.mScript = aScript; }

  get type() { return this.mType; }
  set type(aType) { if (typeof aType != 'undefined') return this.mType = aType; }

  clone() {
    const newScript = new wzQuicktextScript();
    newScript.name = this.mName;
    newScript.script = this.mScript;
    newScript.type = this.mType;

    return newScript;
  }
}