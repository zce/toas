export class Provider {
  constructor ({ id, manifest }) {
    this.id = id
    this.manifest = manifest
  }

  resolve () {
    throw new Error(`${this.id}.resolve() is not implemented`)
  }

  create () {
    throw new Error(`${this.id}.create() is not implemented`)
  }
}
