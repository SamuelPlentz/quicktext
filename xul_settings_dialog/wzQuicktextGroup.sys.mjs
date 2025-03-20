export class wzQuicktextGroup {
  constructor() {
    this.mName = "";
    this.mType = "";
  }

  get name() { return this.mName; }
  set name(aName) { if (typeof aName != 'undefined') return this.mName = aName; }

  get type() { return this.mType; }
  set type(aType) { if (typeof aType != 'undefined') return this.mType = aType; }

  clone() {
    const newGroup = new wzQuicktextGroup();
    newGroup.name = this.mName;
    newGroup.type = this.mType;

    return newGroup;
  }
}