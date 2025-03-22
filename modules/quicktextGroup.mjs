export class QuicktextGroup {
  constructor(config) {
    this.name = config.mName || config.name || "";
    this.protected = config.mProtected || config.protected || false;
  }
}
