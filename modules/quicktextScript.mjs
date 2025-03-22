export class QuicktextScript {
  constructor(config) {
    this.name = config.mName || config.name || "";
    this.script = config.mScript || config.script || "";
    this.protected = config.mProtected || config.protected || false;
  }
}
